import { PropertyFixup } from "../FixupWalker.js";
import { DT_TYPE } from "../RefResolver.js";
import { cell_range, is_matrix_type } from "../PropertyTypes.js";

const NOT_THE_DEFINITION = new Set(["if", "not", "select", "then", "else"]);

/**
 * A property of a matrix type (`reg`, `interrupts`, `clocks`) says how many rows it has and little else,
 * unless it `$ref`s `types.yaml`. dt-schema validates the rows against the type of its own schemas; we have one
 * schema, so a matrix property that doesn't describe its rows gets them: each an array, of the numbers the type
 * allows. Not `type: integer`, as a cell can be a label or a macro.
 */
export const fixup_matrix_rows: PropertyFixup = (schema, { path, name }) => {
    if (typeof schema === "boolean" || path.at(-1) !== name || path.at(-2) !== "properties" || path.some(key => NOT_THE_DEFINITION.has(key))) {
        return schema;
    }

    const type = schema[DT_TYPE];

    if (typeof type !== "string" || !is_matrix_type(type) || "items" in schema) { return schema; }

    const range = cell_range(type);

    schema["type"] = "array";
    schema["items"] = {
        type: "array",
        ...(range === undefined ? {} : { items: { minimum: Number(range.minimum), maximum: Number(range.maximum) } }),
    };

    return schema;
};

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const rows = (schema: Record<string, unknown> | boolean, name = "interrupts", path = ["properties", name]) => fixup_matrix_rows(schema, { path, name });

    test("a matrix property without rows gets rows of the type's numbers", () => {
        expect(rows({ maxItems: 1, dtType: "uint32-matrix" })).toStrictEqual({
            maxItems: 1,
            dtType: "uint32-matrix",
            type: "array",
            items: { type: "array", items: { minimum: 0, maximum: 0xFF_FF_FF_FF } },
        });
        expect(rows({ minItems: 1, dtType: "phandle-array" }, "clocks")).toStrictEqual({
            minItems: 1,
            dtType: "phandle-array",
            type: "array",
            items: { type: "array" },
        });
    });

    test("a property with rows already, of another type, without a type or not the definition is left alone", () => {
        expect(rows({ items: [{ description: "first" }], dtType: "uint32-matrix" })).toStrictEqual({ items: [{ description: "first" }], dtType: "uint32-matrix" });
        expect(rows({ maxItems: 1, dtType: "uint32-array" })).toStrictEqual({ maxItems: 1, dtType: "uint32-array" });
        expect(rows({ maxItems: 1 })).toStrictEqual({ maxItems: 1 });
        expect(rows({ maxItems: 1, dtType: "uint32-matrix" }, "interrupts", ["then", "properties", "interrupts"])).toStrictEqual({ maxItems: 1, dtType: "uint32-matrix" });
        expect(rows(true)).toBe(true);
    });
}
