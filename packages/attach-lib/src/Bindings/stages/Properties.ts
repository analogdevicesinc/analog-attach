import { DtBindingSchema, entries_of, is_schema, value_at } from "../schema/Schema.js";
import { SchemaContext } from "../Context.js";
import { dereference, ResolvedBinding } from "./References.js";
import { definitions_by_name } from "./Redefinitions.js";
import { Result } from "../../result.js";

/**
 * Whether the node of the `true` at `path` (`properties/reg`, `allOf/1/properties/reg`) defines the property elsewhere:
 * in its own `properties` or in those of its `allOf` entries. The merger (`Redefinitions.ts`) takes that one, which
 * is the property of this node; a definition of the same name found anywhere else may be a child node's (a PCI
 * device's `reg` for its bus's).
 */
function defined_in_its_node(binding: unknown, path: string[]): boolean {
    let node_path = path.slice(0, -2);
    while (node_path.at(-2) === "allOf") {
        node_path = node_path.slice(0, -2);
    }

    const node = node_path.length === 0 ? binding : value_at(binding, node_path);
    const name = path.at(-1);
    if (!is_schema(node) || name === undefined) {
        return false;
    }

    return (definitions_by_name(node).get(name) ?? []).some(definition => is_schema(definition));
}

/**
 * Whether `definition` is a node that holds the placeholder of its own name (rk3399-pcie's INTx node
 * `interrupt-controller: {type: object, properties: {interrupt-controller: true}}`): the node the `true` sits in, not
 * what it stands for.
 */
function holds_own_placeholder(definition: unknown, name: string): boolean {
    const properties = is_schema(definition) ? definition["properties"] : undefined;
    return is_schema(properties) && properties[name] === true;
}

/**
 * The first definition of `name` in `schema`, depth first: one in a `properties` table, at any depth, and not in an
 * `if` / `then` / `else`, nor a node holding a `true` of the name (`holds_own_placeholder`). Undefined when there is
 * none.
 */
function first_definition(schema: unknown, name: string, in_properties = false): unknown {
    if (typeof schema !== "object" || schema === null) { return undefined; }

    const own = in_properties && Object.hasOwn(schema, name) ? (schema as Record<string, unknown>)[name] : undefined;
    if (own !== undefined && typeof own !== "boolean" && !holds_own_placeholder(own, name)) { return own; }

    for (const [key, entry] of Object.entries(schema)) {
        if (key === "if" || key === "then" || key === "else") { continue; }
        const found = first_definition(entry, name, in_properties || key === "properties");
        if (found !== undefined) { return found; }
    }
    return undefined;
}

/**
 * A copy of `value` with the definitions of `definitions` (by `JSON.stringify` of their path) in place of the `true`s
 * they stand for. A copy of each object at each place: the dereferencing shares the definitions a `$ref` names among
 * the places that name it, and the stages after this one see a tree.
 */
function with_definitions(value: unknown, definitions: Map<string, unknown>, path: string[] = []): unknown {
    if (Array.isArray(value)) {
        return value.map((entry, index) => with_definitions(entry, definitions, [...path, String(index)]));
    }
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, with_definitions(entry, definitions, [...path, key])]));
    }
    return definitions.has(JSON.stringify(path)) ? definitions.get(JSON.stringify(path)) : value;
}

/**
 * The binding with each `properties: { name: true }` its node doesn't define otherwise replaced by the first
 * definition of the name in the files it references (in their order), dereferenced again. A `true` none defines stays,
 * for the `dt_type` fixup to type by its name (`interrupt-controller` a `flag`).
 */
export async function resolve_properties(
    reference_resolved: ResolvedBinding,
    ctx: SchemaContext,
): Promise<Result<DtBindingSchema, string>> {
    const binding = reference_resolved.root_binding;
    const definitions = new Map<string, unknown>();

    // The `true`s that stand for a property (`properties: { reg: true }`)
    const placeholders = [...entries_of(binding)].filter(([entry, path]) => entry === true && path.at(-2) === "properties");

    for (const [, path] of placeholders) {
        const name = path.at(-1) ?? "";
        if (defined_in_its_node(binding, path)) { continue; }

        const definition = reference_resolved.refs
            .map(reference => first_definition(reference, name))
            .find(found => found !== undefined);
        if (definition === undefined) { continue; }

        const resolved = await dereference(ctx, definition as object);
        if (Result.is_err(resolved)) { return Result.Err(resolved.error); }
        definitions.set(JSON.stringify(path), resolved.value);
    }

    return Result.Ok(with_definitions(binding, definitions) as DtBindingSchema);
}
