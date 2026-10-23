import { FixupContext, PropertySchema } from "../FixupWalker.js";

type Schema = Record<string, unknown>;

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function size(schema: Schema, path: string[]): void {
    // Ours: a schema that bounds or lists items, or looks for one, is an array even when it doesn't say so
    // (dt-schema gets the type from the `$ref` to types.yaml). Unless it bounds a number: that is an integer.
    const bounds_items = "maxItems" in schema || "minItems" in schema || "items" in schema || "contains" in schema;
    if (!("type" in schema) && bounds_items && !("minimum" in schema || "maximum" in schema)) {
        schema["type"] = "array";
    }

    const items = schema["items"];

    if ("items" in schema) {
        schema["type"] = "array";

        if (Array.isArray(items)) {
            schema["minItems"] ??= items.length;
            schema["maxItems"] ??= items.length;
        }

        for (const item of Array.isArray(items) ? items : [items]) {
            if (is_schema(item)) { size(item, [...path, "items"]); }
        }
    } else if (schema["type"] === "array" && !path.includes("then") && !path.includes("else")) {
        // Only a bound given: the count is fixed to it.
        if ("maxItems" in schema && !("minItems" in schema)) {
            schema["minItems"] = schema["maxItems"];
        } else if ("minItems" in schema && !("maxItems" in schema)) {
            schema["maxItems"] = schema["minItems"];
        }
    }
}

/**
 * dt-schema: `fixups.py:_fixup_items_size`. Gives an array schema its type, and a fixed size when
 * its `items` is a list (one entry each) or only one of `minItems` / `maxItems` is given
 * (dt-schema does the latter for any schema; we only for arrays).
 * The bounds of a `then` / `else` branch are left as they are: they refine the property's own.
 */
export function fixup_items_size(schema: PropertySchema, { path }: FixupContext): PropertySchema {
    if (typeof schema !== "boolean") { size(schema, path); }
    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const sized = (schema: Schema, path = ["properties", "x"]) => fixup_items_size(schema, { path, name: "x" });

    test("items as a list fix the size to its length, unless the schema bounds it", () => {
        expect(sized({ items: [{ const: "a" }, { const: "b" }] })).toStrictEqual({ items: [{ const: "a" }, { const: "b" }], type: "array", minItems: 2, maxItems: 2 });
        expect(sized({ items: [{ const: "a" }], minItems: 1, maxItems: 3 })).toStrictEqual({ items: [{ const: "a" }], minItems: 1, maxItems: 3, type: "array" });
    });

    test("a lone bound fixes the size to it", () => {
        expect(sized({ minItems: 2 })).toStrictEqual({ minItems: 2, maxItems: 2, type: "array" });
        expect(sized({ maxItems: 3 })).toStrictEqual({ maxItems: 3, minItems: 3, type: "array" });
        expect(sized({ minItems: 1, maxItems: 4 })).toStrictEqual({ minItems: 1, maxItems: 4, type: "array" });
    });

    test("a lone bound in a then or else branch is left alone", () => {
        expect(sized({ maxItems: 3 }, ["properties", "x", "then"])).toStrictEqual({ maxItems: 3, type: "array" });
    });

    test("the schemas inside items are sized too (a matrix)", () => {
        expect(sized({ items: { items: [{ minimum: 0 }, { minimum: 1 }] } })).toStrictEqual({
            items: { items: [{ minimum: 0 }, { minimum: 1 }], type: "array", minItems: 2, maxItems: 2 },
            type: "array",
        });
    });

    test("a schema that bounds nothing, one with a type already and a boolean are left alone", () => {
        expect(sized({ minimum: 0 })).toStrictEqual({ minimum: 0 });
        expect(sized({ minimum: 0, maxItems: 1 })).toStrictEqual({ minimum: 0, maxItems: 1 });
        expect(sized({ type: "string", minItems: 1, maxItems: 2 })).toStrictEqual({ type: "string", minItems: 1, maxItems: 2 });
        expect(sized({ type: "integer", maxItems: 1 })).toStrictEqual({ type: "integer", maxItems: 1 });
        expect(sized(true as unknown as Schema)).toBe(true);
    });
}
