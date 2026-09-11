/**
 * Our workfile model, expressed in attach-meta's tree.
 *
 * Three mismatches are resolved here, and they are the whole reason this file exists:
 *
 *  - **A flat symbol table is not a tree.** attach-meta addresses everything by a path
 *    resolved from a single root, so the workfile becomes a root node whose children are
 *    the symbols. Nothing nests further: paths are `[]`, `[node]`, `[node, property]`.
 *
 *  - **A property value can never be an object.** `PropertyValue` is
 *    `null | string | number | boolean | array`. Our union properties are stored as
 *    `{member: value}`, so they are flattened to a two-element tuple
 *    `[member, member_value]` — which is also what makes them completable, since a tuple
 *    position is a thing attach-meta can ask for suggestions about.
 *
 *  - **`Property` is closed.** `{kind, key, type, value}` and nothing else: no
 *    description, no `required`, no default, no numeric bounds. Those reach the user
 *    through the human rendering and through `suggest`, not through `read`.
 */

import {
    error,
    is_float_symbol,
    ok,
    ruleset_type_token,
    type ArrayProperty,
    type IncludeProperty,
    type MinimalWorkfile,
    type Property,
    type Result,
    type Ruleset,
    type Workfile,
} from "attach-no-os-lib";
import type {
    Node as ProtocolNode,
    Property as ProtocolProperty,
    PropertyType,
    PropertyValue,
} from "./responses";

/**
 * Marks a workfile key as ours rather than a field of the C struct a node generates.
 *
 * It is also the one character a shell will not pass through: unquoted, `$init_param`
 * expands to nothing. So every command that takes a property name accepts the bare
 * spelling too — see `resolve_property_name` in commands/shared.ts.
 */
export const RESERVED_PREFIX = "$";

/**
 * Property key carrying the schema a node was created from.
 *
 * `Node` has no field for it — `key` is the node's address and there is nowhere else to
 * put it — but "which device is this?" is the first thing anyone reading a node wants to
 * know, so it is surfaced as a property under the name the workfile itself uses. It is
 * not settable; `update` refuses it.
 */
export const COMPATIBLE_KEY = `${RESERVED_PREFIX}compatible`;

/** Root-level properties describing the workfile as a whole. Fixed at creation time. */
export const PLATFORM_KEY = "platform";
export const BOARD_KEY = "board";

/** Properties that describe rather than configure, and so cannot be updated. */
export const READONLY_KEYS = new Set([COMPATIBLE_KEY, PLATFORM_KEY, BOARD_KEY]);

// --- Types ---

function array_element_type(property: ArrayProperty): PropertyType {
    return property_type(property.element as Property);
}

export function property_type(property: Property): PropertyType {
    switch (property._t) {
        case "NumberProperty": {
            return { kind: "number", subtype: is_float_symbol(property.type) ? "float" : "int" };
        }
        case "BooleanProperty": {
            return { kind: "bool" };
        }
        case "EnumProperty": {
            return { kind: "enum", options: property.values.map(value => ({ value })) };
        }
        case "UnionProperty": {
            // [which member, that member's value]. The member list is closed, so it is an
            // enum; the member's value names another node, so it is a string.
            return {
                kind: "tuple",
                items: [
                    {
                        kind: "enum",
                        options: property.members.map(member => ({
                            value: member.name,
                            display_string: `${member.name} (${include_target(member)})`,
                        })),
                    },
                    { kind: "string" },
                ],
            };
        }
        case "ArrayProperty": {
            return { kind: "array", items: array_element_type(property) };
        }
        default: {
            // IncludeProperty holds the name of another node; StringProperty, RawProperty,
            // PlatformOpsProperty and PlatformExtraProperty hold text. Which names or
            // tokens are acceptable is what `suggest` answers — the protocol has no way to
            // say "a reference", so all of them are strings here.
            return { kind: "string" };
        }
    }
}

/** What an include accepts: a schema `$id`, or any node of a kind for a `void *` field. */
export function include_target(property: IncludeProperty): string {
    return property.include ?? `any ${ruleset_type_token(property.include_type)}`;
}

// --- Values ---

/**
 * The two-element form of a union value: `["maxim", "max_spi_ip"]`.
 *
 * A member selected without a value keeps the tuple's shape and nulls the second slot, so
 * "which member" and "no member chosen at all" stay distinguishable — the latter is a
 * null value, not a tuple.
 */
export function union_value_to_tuple(value: unknown): PropertyValue {
    if (typeof value !== "object" || value === null) {
        // eslint-disable-next-line unicorn/no-null
        return null;
    }

    const entry = Object.entries(value as Record<string, unknown>)[0];
    if (!entry) {
        // eslint-disable-next-line unicorn/no-null
        return null;
    }

    return [entry[0], scalar_value(entry[1])];
}

/** Coerce anything our model may hold into a legal PropertyValue scalar. */
function scalar_value(value: unknown): PropertyValue {
    if (value === undefined || value === null) {
        // eslint-disable-next-line unicorn/no-null
        return null;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(item => scalar_value(item));
    }

    // An object would violate PropertyValue. Nothing but a union should reach this, and a
    // union is handled before we get here, so stringifying is a last resort rather than a
    // representation anyone should rely on.
    return String(value);
}

export function property_value(property: Property): PropertyValue {
    if (property._t === "UnionProperty") {
        return union_value_to_tuple(property.value);
    }

    return scalar_value(property.value);
}

// --- Parsing values back in ---

/**
 * Separator for the elements of a tuple or array written on the command line.
 *
 * A comma rather than a colon on purpose: bash's default `COMP_WORDBREAKS` contains `:`
 * but not `,`, so `maxim,max_spi_ip` completes as one word while `maxim:max_spi_ip` would
 * be split and complete wrongly.
 */
export const ELEMENT_SEPARATOR = ",";

/**
 * Turn the raw `--with` string into a value our model accepts.
 *
 * attach-meta passes `--with` through verbatim ("the subtool parses it"), so every bit of
 * coercion is ours: the protocol never learns that a property is a number, an enum with
 * numeric options, or a union.
 */
export function parse_property_value(raw: string, property: Property): Result<unknown> {
    switch (property._t) {
        case "NumberProperty": {
            const parsed = Number(raw);
            if (Number.isNaN(parsed)) {
                return error(`'${raw}' is not a number`);
            }
            return ok(parsed);
        }

        case "BooleanProperty": {
            const normalized = raw.trim().toLowerCase();
            if (normalized === "true" || normalized === "1") {
                return ok(true);
            }
            if (normalized === "false" || normalized === "0") {
                return ok(false);
            }
            return error(`'${raw}' is not a boolean (expected true or false)`);
        }

        case "EnumProperty": {
            // Enum options can be numeric, and the command line only ever hands us text,
            // so a value that looks like one of the numeric options is taken as that
            // number rather than as its spelling.
            const as_number = Number(raw);
            if (!Number.isNaN(as_number) && property.values.includes(as_number)) {
                return ok(as_number);
            }
            if (!property.values.includes(raw)) {
                return error(`'${raw}' is not one of: ${property.values.join(", ")}`);
            }
            return ok(raw);
        }

        case "UnionProperty": {
            const parts = split_elements(raw);
            const member_name = parts[0];
            const member = property.members.find(candidate => candidate.name === member_name);
            if (!member) {
                return error(
                    `'${member_name}' is not a member of '${property.name}'. Available: ` +
                    property.members.map(candidate => candidate.name).join(", "),
                );
            }

            if (parts.length > 2) {
                return error(
                    `'${raw}' has ${parts.length} elements; a union takes <member> or <member>${ELEMENT_SEPARATOR}<value>`,
                );
            }

            // eslint-disable-next-line unicorn/no-null
            return ok({ [member.name]: parts[1] ?? null });
        }

        case "ArrayProperty": {
            const parts = split_elements(raw);
            if (parts.length > property.size) {
                return error(`'${property.name}' holds at most ${property.size} elements, got ${parts.length}`);
            }

            const values: unknown[] = [];
            for (const part of parts) {
                const parsed = parse_property_value(part, property.element as Property);
                if (!parsed.ok) {
                    return parsed;
                }
                values.push(parsed.value);
            }
            return ok(values);
        }

        default: {
            // Include, string, raw, platform ops/extra: stored as typed.
            return ok(raw);
        }
    }
}

/**
 * Split a composite value, accepting a JSON array as well as the comma form so a value
 * that itself contains a comma can still be written.
 */
function split_elements(raw: string): string[] {
    const trimmed = raw.trim();

    if (trimmed.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.map(element => String(element));
            }
        } catch {
            // Not JSON after all — fall through and treat it as a plain comma list.
        }
    }

    return trimmed
        .split(ELEMENT_SEPARATOR)
        .map(element => element.trim())
        .filter(element => element.length > 0);
}

// --- Nodes ---

export function to_protocol_property(property: Property): ProtocolProperty {
    return {
        kind: "property",
        key: property.name,
        type: property_type(property),
        value: property_value(property),
    };
}

function descriptive_property(key: string, value: string | undefined): ProtocolProperty {
    return {
        kind: "property",
        key,
        type: { kind: "string" },
        // eslint-disable-next-line unicorn/no-null
        value: value ?? null,
    };
}

/**
 * One symbol as a protocol node.
 *
 * An extern has no properties to configure — it names a symbol the library already
 * defines — so what it exposes instead is the symbol and the type it satisfies. Read-only,
 * like `$compatible`.
 */
export function to_protocol_node(name: string, ruleset: Ruleset): ProtocolNode {
    const properties: ProtocolProperty[] = [descriptive_property(COMPATIBLE_KEY, ruleset.$id)];

    if (ruleset._t === "RulesetExtern") {
        properties.push(
            descriptive_property("$symbol", ruleset.$symbol),
            descriptive_property("$provides", ruleset.$provides),
        );
    } else if (ruleset._t === "RulesetStruct" || ruleset._t === "RulesetDescriptor") {
        properties.push(...ruleset.properties.map(property => to_protocol_property(property)));
    }

    return { kind: "node", key: name, properties, children: [] };
}

/**
 * The whole workfile as one root node.
 *
 * `read` with no path returns this, and reading a node returns that child verbatim — the
 * schema requires a node to carry its full subtree, which for a one-level model is the
 * node itself.
 */
export function to_protocol_root(
    key: string,
    minimal: MinimalWorkfile,
    workfile: Workfile,
): ProtocolNode {
    return {
        kind: "node",
        key,
        properties: [
            descriptive_property(PLATFORM_KEY, minimal.platform),
            descriptive_property(BOARD_KEY, minimal.board),
        ],
        children: Object.keys(minimal.symbols).map(name =>
            to_protocol_node(name, workfile.symbols[name]),
        ),
    };
}
