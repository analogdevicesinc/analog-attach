import { FixupContext, PropertySchema } from "../FixupWalker.js";

const SINGLE_VALUE_KEYWORDS = ["const", "enum", "pattern", "minimum", "maximum", "multipleOf"];

/** dt-schema `lib.py:_is_string_schema`: a `const`, `enum` or `pattern` of strings. */
function is_string_schema(schema: Record<string, unknown>): boolean {
    return ["const", "enum", "pattern"].some(keyword => {
        if (!(keyword in schema)) { return false; }
        const value = schema[keyword];
        return typeof (Array.isArray(value) ? value[0] : value) === "string";
    });
}

function constrains_values(items: unknown): boolean {
    return (Array.isArray(items) ? items : [items]).some(item =>
        typeof item === "object" && item !== null && SINGLE_VALUE_KEYWORDS.some(keyword => keyword in item));
}

/**
 * dt-schema: `fixups.py:_fixup_string_to_array`. A DT string property is a list
 * of strings, so `compatible: {enum: [a, b]}` constrains the first (and only)
 * item: `compatible: {items: [{enum: [a, b]}]}`.
 */
export function fixup_string_to_array(schema: PropertySchema, _context: FixupContext): PropertySchema {
    if (typeof schema === "boolean" || !is_string_schema(schema)) { return schema; }

    const single: Record<string, unknown> = {};

    for (const keyword of SINGLE_VALUE_KEYWORDS) {
        if (keyword in schema) {
            single[keyword] = schema[keyword];
            delete schema[keyword];
        }
    }

    // dt-schema checks the files a binding includes as schemas of their own. We merged them into the
    // binding's property, so a `const` from an included file can sit beside the binding's own `items`:
    // when those already say what the values are, they win. (`items: {type: string}` from a type doesn't.)
    if (!constrains_values(schema["items"])) {
        schema["items"] = [single];
    }

    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const context = (name: string): FixupContext => ({ path: ["properties", name], name });

    test("a string enum or const becomes the first item", () => {
        expect(fixup_string_to_array({ enum: ["one", "two"] }, context("compatible"))).toStrictEqual({ items: [{ enum: ["one", "two"] }] });
        expect(fixup_string_to_array({ const: "one" }, context("compatible"))).toStrictEqual({ items: [{ const: "one" }] });
        expect(fixup_string_to_array({ pattern: "^a", description: "d" }, context("x"))).toStrictEqual({ description: "d", items: [{ pattern: "^a" }] });
    });

    test("branches of a oneOf are fixed one by one (by the walker)", () => {
        const branch = fixup_string_to_array({ const: "one" }, context("compatible"));
        expect(branch).toStrictEqual({ items: [{ const: "one" }] });
    });

    test("the binding's own items win over a const or enum merged in from an included file", () => {
        expect(fixup_string_to_array({ const: "mac-address", items: [{ const: "io_impedance_ctrl" }] }, context("nvmem-cell-names")))
            .toStrictEqual({ items: [{ const: "io_impedance_ctrl" }] });
    });

    test("items that only give a type are replaced", () => {
        expect(fixup_string_to_array({ enum: ["smc", "hvc"], items: { type: "string" } }, context("method")))
            .toStrictEqual({ items: [{ enum: ["smc", "hvc"] }] });
    });

    test("a number enum, a schema that already has items and a boolean are left alone", () => {
        expect(fixup_string_to_array({ enum: [0, 1] }, context("reg"))).toStrictEqual({ enum: [0, 1] });
        expect(fixup_string_to_array({ items: [{ enum: ["a"] }] }, context("compatible"))).toStrictEqual({ items: [{ enum: ["a"] }] });
        expect(fixup_string_to_array(true, context("compatible"))).toBe(true);
    });
}
