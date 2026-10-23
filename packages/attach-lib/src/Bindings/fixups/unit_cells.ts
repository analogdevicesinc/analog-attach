import { PropertyFixup } from "../FixupWalker.js";
import { DT_TYPE } from "../RefResolver.js";
import { cell_range } from "../PropertyTypes.js";
import { ARRAY_SUFFIX, MATRIX_SUFFIX } from "./unit_suffix.js";

const NOT_THE_DEFINITION = new Set(["if", "not", "select", "then", "else"]);

type Schema = Record<string, unknown>;

function is_schema(value: unknown): value is Schema {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The cell schemas of `items` (one schema for every value, or one per position). */
function cells_of(items: unknown): Schema[] {
    return (Array.isArray(items) ? items : [items]).filter(cell => is_schema(cell));
}

/** Gives a number schema the bounds of its type where it has none; a choice (`enum`, `const`) already has its. */
function bound(cell: Schema, range: { minimum: bigint, maximum: bigint }): void {
    if ("enum" in cell || "const" in cell) { return; }
    cell["minimum"] ??= Number(range.minimum);
    cell["maximum"] ??= Number(range.maximum);
}

function bound_cells(items: unknown, range: { minimum: bigint, maximum: bigint }): void {
    for (const cell of cells_of(items)) { bound(cell, range); }
}

/**
 * A property with a unit suffix (`-ns`, `-hz`, `-microvolt`) holds numbers of the type the suffix gives
 * (`property-units.yaml`: `uint32-array`, `int32-matrix`, ...). dt-schema gets their bounds from the `$ref` to
 * `types.yaml`; our schema, with `fixup_unit_suffix` having put the binding's constraints where that type has them,
 * gets what is missing: the bounds of the type on each cell, and for a property that says nothing of its
 * values, the list (or the rows of the list) of them, at least one as `types.yaml` has it. Runs after `mark_integers`, which would make the cells integers,
 * and a cell can be a macro.
 */
export const fixup_unit_cells: PropertyFixup = (schema, { path, name }) => {
    if (typeof schema === "boolean" || path.at(-1) !== name || path.at(-2) !== "properties" || path.some(key => NOT_THE_DEFINITION.has(key))) {
        return schema;
    }

    const type = schema[DT_TYPE];
    const range = typeof type === "string" ? cell_range(type) : undefined;

    if (typeof type !== "string" || range === undefined) { return schema; }

    if (MATRIX_SUFFIX.test(name) && type.endsWith("-matrix")) {
        if ("items" in schema) {
            for (const row of cells_of(schema["items"])) {
                if ("items" in row) { bound_cells(row["items"], range); } else { row["type"] ??= "array"; row["items"] = { minimum: Number(range.minimum), maximum: Number(range.maximum) }; }
            }
        } else if (!("enum" in schema || "const" in schema)) {
            schema["type"] = "array";
            schema["minItems"] ??= 1;
            schema["items"] = { type: "array", items: { minimum: Number(range.minimum), maximum: Number(range.maximum) } };
        }
    } else if (ARRAY_SUFFIX.test(name) && type.endsWith("-array")) {
        if ("items" in schema) {
            bound_cells(schema["items"], range);
        } else if (!("enum" in schema || "const" in schema || "minimum" in schema || "maximum" in schema)) {
            schema["type"] = "array";
            schema["minItems"] ??= 1;
            schema["items"] = { minimum: Number(range.minimum), maximum: Number(range.maximum) };
        }
    } else if (name.endsWith("-bps") && !type.includes("-") && !("items" in schema)) {
        schema["type"] ??= "integer";
        bound(schema, range);
    }

    return schema;
};

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const unit = (schema: Schema, name: string) => fixup_unit_cells(schema, { path: ["properties", name], name });
    const uint32 = { minimum: 0, maximum: 0xFF_FF_FF_FF };

    test("a unit list that says nothing of its values is a list of numbers of the type", () => {
        expect(unit({ dtType: "uint32-array", description: "d" }, "foo-ns")).toStrictEqual({ dtType: "uint32-array", description: "d", type: "array", minItems: 1, items: uint32 });
        expect(unit({ dtType: "int32-array" }, "foo-percent")).toStrictEqual({ dtType: "int32-array", type: "array", minItems: 1, items: { minimum: -2_147_483_648, maximum: 2_147_483_647 } });
    });

    test("the bounds a binding gives are kept, those it doesn't are the type's", () => {
        expect(unit({ dtType: "uint32-array", items: [{ minimum: 16_000 }] }, "foo-ns")).toStrictEqual({ dtType: "uint32-array", items: [{ minimum: 16_000, maximum: 0xFF_FF_FF_FF }] });
        expect(unit({ dtType: "uint32-array", items: [{ enum: [1, 2] }] }, "foo-ns")).toStrictEqual({ dtType: "uint32-array", items: [{ enum: [1, 2] }] });
    });

    test("a unit matrix gets rows of numbers, the cells of the rows it has the bounds of the type", () => {
        expect(unit({ dtType: "uint32-matrix" }, "foo-hz")).toStrictEqual({ dtType: "uint32-matrix", type: "array", minItems: 1, items: { type: "array", items: uint32 } });
        expect(unit({ dtType: "uint32-matrix", items: [{ items: [{ maximum: 9 }] }] }, "foo-hz")).toStrictEqual({ dtType: "uint32-matrix", items: [{ items: [{ maximum: 9, minimum: 0 }] }] });
    });

    test("a unit number gets the bounds of its type", () => {
        expect(unit({ dtType: "uint32", description: "d" }, "foo-bps")).toStrictEqual({ dtType: "uint32", description: "d", type: "integer", ...uint32 });
    });

    test("a property that is no unit property, has no number type, or is not the definition is left alone", () => {
        expect(unit({ dtType: "uint32-matrix" }, "interrupts")).toStrictEqual({ dtType: "uint32-matrix" });
        expect(unit({ dtType: "string-array" }, "foo-ns")).toStrictEqual({ dtType: "string-array" });
        expect(unit({ description: "d" }, "foo-ns")).toStrictEqual({ description: "d" });
        expect(fixup_unit_cells({ dtType: "uint32-array" }, { path: ["then", "properties", "foo-ns"], name: "foo-ns" })).toStrictEqual({ dtType: "uint32-array" });
        expect(unit(true as unknown as Schema, "foo-ns")).toBe(true);
    });
}
