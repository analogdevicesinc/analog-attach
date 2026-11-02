import { FixupContext, PropertySchema } from "../FixupWalker.js";

// dt-schema: `fixups.py:_extract_single_schemas`
const SINGLE_VALUE_KEYWORDS = new Set(["const", "enum", "pattern", "minimum", "maximum", "multipleOf"]);

function is_schema(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** dt-schema `lib.py:_is_int_schema`: a `const`, `enum`, `minimum` or `maximum` of numbers. */
function is_int_schema(schema: unknown): schema is Record<string, unknown> {
    return is_schema(schema) && ["const", "enum", "minimum", "maximum"].some(keyword => {
        if (!(keyword in schema)) { return false; }
        const value = schema[keyword];
        return typeof (Array.isArray(value) ? value[0] : value) === "number";
    });
}

/** The keywords of `schema` that constrain one value, taken out of it. */
function extract_single(schema: Record<string, unknown>): Record<string, unknown> {
    const single: Record<string, unknown> = {};

    for (const key of Object.keys(schema)) {
        if (SINGLE_VALUE_KEYWORDS.has(key)) {
            single[key] = schema[key];
            delete schema[key];
        }
    }

    return single;
}

/**
 * dt-schema: `fixups.py:_fixup_reg_schema`. A `reg` whose values are bounded as numbers (`reg: {maximum: 15}`, or
 * the first of its `items`) is a one-cell entry with those bounds (`reg = <3>`). A `reg` whose items say nothing of
 * the numbers (`items: [{description: core}, {description: aux}]`) lists its entries, so it is left as it is: the
 * entries are its rows, and `fixup_items_size` counts them.
 */
export function fixup_reg(schema: PropertySchema, { name }: FixupContext): PropertySchema {
    if (name !== "reg" || typeof schema === "boolean") { return schema; }

    const items = schema["items"];
    const item = "items" in schema ? (Array.isArray(items) ? items[0] : items) : schema;

    if (is_int_schema(item)) {
        schema["items"] = [{ items: [extract_single(item)] }];
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

    test("reg items that only describe the entries are left as they are: each is an entry", () => {
        const described = { items: [{ description: "core" }, { description: "aux" }] };
        expect(reg(structuredClone(described))).toStrictEqual(described);
    });

    test("reg items that bound numbers: the first one bounds the cell", () => {
        expect(reg({ items: [{ minimum: 0, maximum: 7, description: "a" }, { minimum: 8 }] })).toStrictEqual({ items: [{ items: [{ minimum: 0, maximum: 7 }] }] });
    });

    test("reg that already is a matrix, another property and a boolean are left alone", () => {
        const matrix = { items: { items: [{ minimum: 0 }] } };
        expect(reg(structuredClone(matrix))).toStrictEqual(matrix);
        expect(reg({ enum: [0, 1] }, "other")).toStrictEqual({ enum: [0, 1] });
        expect(reg(true)).toBe(true);
    });
}
