import { FixupContext } from "./Walker.js";
import { DT_TYPE } from "../stages/References.js";
import { is_schema, Schema, PropertySchema } from "../schema/Schema.js";

const is_deprecated = (branch: Schema): boolean => branch["deprecated"] === true;

/** A number of one of the integer types (`$ref: uint32`, dereferenced), not an array of them. */
function is_number_type(branch: Schema): boolean {
    const dt_type = branch[DT_TYPE];
    return typeof dt_type === "string" ? /^u?int(8|16|32|64)$/.test(dt_type) : branch["type"] === "integer";
}

/** A list (`type: array`, as the walk has made each branch that bounds or lists items, or a `dtType` of one). */
function is_list(branch: Schema): boolean {
    const dt_type = branch[DT_TYPE];
    return branch["type"] === "array" || (typeof dt_type === "string" && /-(array|matrix)$/.test(dt_type));
}

type Form = "node" | "flag" | "number" | "list";

/** What a branch is a value of; undefined for one that names no form (`description: Any name allowed`, a `const`). */
function form_of(branch: Schema): Form | undefined {
    if (branch["type"] === "object" || "properties" in branch) { return "node"; }
    if (branch["type"] === "boolean") { return "flag"; }
    if (is_list(branch)) { return "list"; }
    if (is_number_type(branch)) { return "number"; }
    return undefined;
}

/** The property as the one branch it is: its own keywords and the branch's, its description kept. */
function as_branch(schema: Schema, key: string, branch: Schema): Schema {
    const { [key]: _branches, ...rest } = schema;
    const { deprecated: _deprecated, ...form } = branch;
    return { ...rest, ...form, ...("description" in rest ? { description: rest["description"] } : {}) };
}

/**
 * Ours. A property a `oneOf` / `anyOf` gives several forms of is read as the one to write, as we have no union of types:
 * - when every branch but one is `deprecated`, that one: `fixed-link` is the child node, not the five cells of old
 *   (ethernet-controller.yaml), `drive-open-drain` a flag, not the `uint32` 1 (pincfg-node.yaml). Only when each
 *   branch names a form: a `$nodename` whose old branch allows any name keeps it. Not when they are all lists (a
 *   `compatible`, a `reg`): their counts and options hold the old ones too, which are still valid;
 * - a flag or a number (`bias-pull-up: oneOf: [{type: boolean}, {$ref: uint32}]`, the pull strength in Ohm) is the
 *   flag, as nearly every devicetree writes it. A value is still written as given.
 *
 * dt-validate takes any of the branches. Before the other property fixups, which then see the form.
 */
export function fixup_one_form(schema: PropertySchema, _context: FixupContext): PropertySchema {
    if (typeof schema === "boolean") { return schema; }

    for (const key of ["oneOf", "anyOf"]) {
        const branches = schema[key];
        if (!Array.isArray(branches) || branches.length < 2 || !branches.every(branch => is_schema(branch))) { continue; }

        const live = branches.filter(branch => !is_deprecated(branch));
        const forms = branches.map(branch => form_of(branch));
        if (live.length === 1 && !forms.includes(undefined) && !forms.every(form => form === "list")) { return as_branch(schema, key, live[0]!); }

        const flag = live.find(branch => branch["type"] === "boolean");
        if (live.length === 2 && flag !== undefined && live.some(branch => branch !== flag && is_number_type(branch))) {
            return as_branch(schema, key, flag);
        }
    }
    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const fixuped = (schema: PropertySchema) => fixup_one_form(schema, { path: ["properties", "x"], name: "x" });
    const uint32 = { type: "integer", typeSize: 32, minimum: 0, maximum: 0xFF_FF_FF_FF, [DT_TYPE]: "uint32" };

    test("every branch but one deprecated: the property is that one, its description kept", () => {
        const node = { type: "object", additionalProperties: false, properties: { speed: { enum: [10, 100] }, "full-duplex": { type: "boolean" } } };
        expect(fixuped({ oneOf: [{ type: "array", items: [{ maximum: 31 }], deprecated: true }, node] })).toStrictEqual(node);
        expect(fixuped({ oneOf: [{ type: "boolean" }, { ...uint32, const: 1, deprecated: true }], description: "drive with open drain" }))
            .toStrictEqual({ type: "boolean", description: "drive with open drain" });
    });

    test("a flag or a number is the flag", () => {
        expect(fixuped({ oneOf: [{ type: "boolean" }, uint32], description: "pull up the pin" }))
            .toStrictEqual({ type: "boolean", description: "pull up the pin" });
    });

    test("several forms to write are left to the other readers", () => {
        const compatible = { oneOf: [{ items: [{ const: "a" }] }, { items: [{ const: "b" }] }, { items: [{ const: "c" }], deprecated: true }] };
        expect(fixuped(structuredClone(compatible))).toStrictEqual(compatible);
        // lists of one kind, one of them old: the counts and options hold both
        const reg = { oneOf: [{ type: "array", minItems: 2, maxItems: 2 }, { type: "array", minItems: 1, maxItems: 1, deprecated: true }] };
        expect(fixuped(structuredClone(reg))).toStrictEqual(reg);
        // an old branch that allows anything (fixed-clock.yaml's `$nodename`)
        const name = { anyOf: [{ type: "array", items: [{ pattern: "^clock-" }] }, { deprecated: true, description: "Any name allowed" }] };
        expect(fixuped(structuredClone(name))).toStrictEqual(name);
        const two = { oneOf: [{ type: "boolean" }, { type: "array", [DT_TYPE]: "uint32-array" }] };
        expect(fixuped(structuredClone(two))).toStrictEqual(two);
        const pins = { oneOf: [{ type: "array", [DT_TYPE]: "uint32-array" }, { type: "array", [DT_TYPE]: "string-array" }] };
        expect(fixuped(structuredClone(pins))).toStrictEqual(pins);
        expect(fixuped({ oneOf: [{ type: "boolean" }, true] })).toStrictEqual({ oneOf: [{ type: "boolean" }, true] });
    });
}
