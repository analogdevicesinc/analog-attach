import { FixupContext, PropertySchema } from "../FixupWalker.js";

const SINGLE_VALUE_KEYWORDS = new Set(["const", "enum", "minimum", "maximum", "multipleOf"]);

/** dt-schema `lib.py:_is_int_schema`: a `const`, `enum`, `minimum` or `maximum` of numbers. */
function is_int_schema(schema: Record<string, unknown>): boolean {
    return ["const", "enum", "minimum", "maximum"].some(keyword => {
        if (!(keyword in schema)) { return false; }
        const value = schema[keyword];
        return typeof (Array.isArray(value) ? value[0] : value) === "number";
    });
}

/**
 * dt-schema: `fixups.py:_fixup_reg_schema`. Wraps the cell constraints of `reg`
 * as the items of a one-entry matrix (`reg = <addr size>, ...`).
 *
 * dt-schema only does so for an integer schema (a `types.yaml` type); we look at
 * the schema's own shape, as the `$ref`s are gone by now.
 */
export function fixup_reg(schema: PropertySchema, { name }: FixupContext): PropertySchema {
    if (name !== "reg" || typeof schema === "boolean") { return schema; }

    const items = schema["items"] as Record<string, unknown> | unknown[] | undefined;

    if (typeof items === "object" && items !== null && !("items" in items)) {
        schema["items"] = [{ items: Array.isArray(items) ? items : [items] }];
    } else if (items === undefined && is_int_schema(schema)) {
        const single: Record<string, unknown> = {};

        for (const key of Object.keys(schema)) {
            if (SINGLE_VALUE_KEYWORDS.has(key)) {
                single[key] = schema[key];
                delete schema[key];
            }
        }

        schema["items"] = [{ items: [single] }];
    }

    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const reg = (schema: PropertySchema, name = "reg") => fixup_reg(schema, { path: ["properties", name], name });

    test("reg items array", () => {
        expect(reg({ items: [{ minimum: 0, maximum: 15 }], minItems: 1, maxItems: 1 })).toStrictEqual({
            items: [{ items: [{ minimum: 0, maximum: 15 }] }],
            minItems: 1,
            maxItems: 1,
        });
    });

    test("reg items object", () => {
        expect(reg({ items: { minimum: 0, maximum: 15 }, minItems: 1, maxItems: 1 })).toStrictEqual({
            items: [{ items: [{ minimum: 0, maximum: 15 }] }],
            minItems: 1,
            maxItems: 1,
        });
    });

    test("reg no items", () => {
        expect(reg({ enum: [0, 1] })).toStrictEqual({ items: [{ items: [{ enum: [0, 1] }] }] });
    });

    test("reg bounded as a number", () => {
        expect(reg({ minimum: 0, maximum: 3, description: "channel" })).toStrictEqual({ items: [{ items: [{ minimum: 0, maximum: 3 }] }], description: "channel" });
    });

    test("reg that already is a matrix, another property and a boolean are left alone", () => {
        const matrix = { items: { items: [{ minimum: 0 }] } };
        expect(reg(structuredClone(matrix))).toStrictEqual(matrix);
        expect(reg({ enum: [0, 1] }, "other")).toStrictEqual({ enum: [0, 1] });
        expect(reg(true)).toBe(true);
    });
}
