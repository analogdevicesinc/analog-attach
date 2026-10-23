import { FixupContext, PropertySchema } from "../FixupWalker.js";

// Keep in sync with dt-schema's `property-units.yaml`
export const ARRAY_SUFFIX = /-(kBps|bits|percent|bp|db|mhz|sec|ms|us|ns|ps|mm|nanoamp|(micro-)?ohms|micro(amp|watt)(-hours)?|milliwatt|(femto|pico)farads|(milli)?celsius|kelvin|k?pascal)$/;
export const MATRIX_SUFFIX = /-(hz|microvolt)$/;

const SINGLE_VALUE_KEYWORDS = ["const", "enum", "pattern", "minimum", "maximum", "multipleOf"];

type Schema = Record<string, unknown>;

/** dt-schema `lib.py:_is_int_schema`: a `const`, `enum`, `minimum` or `maximum` of numbers. */
function is_int_schema(schema: Schema): boolean {
    return ["const", "enum", "minimum", "maximum"].some(keyword => {
        if (!(keyword in schema)) { return false; }
        const value = schema[keyword];
        return typeof (Array.isArray(value) ? value[0] : value) === "number";
    });
}

/** dt-schema `fixups.py:_is_matrix_schema`: an entry of `items` that has `items` or bounds is a row. */
function is_matrix_schema(schema: Schema): boolean {
    const items = schema["items"];
    if (items === undefined) { return false; }

    return (Array.isArray(items) ? items : [items]).some(entry =>
        typeof entry === "object" && entry !== null && ["items", "maxItems", "minItems"].some(key => key in entry));
}

function extract_single_schemas(schema: Schema): Schema {
    const single: Schema = {};

    for (const keyword of SINGLE_VALUE_KEYWORDS) {
        if (keyword in schema) {
            single[keyword] = schema[keyword];
            delete schema[keyword];
        }
    }

    return single;
}

/**
 * dt-schema: `fixups.py:_fixup_unit_suffix_props`. The properties with a unit suffix (`-ns`, `-hz`, `-microvolt`) are
 * typed by the suffix: a list of numbers, or for `-hz` and `-microvolt` a matrix. A schema that constrains one
 * as a single number (`maximum: 10`, `enum: [...]`) or as the cells of one row (`items: [{enum: [...]}]`)
 * is moved to where that type has it. A schema that has a `type` was declared with a `$ref` to `types.yaml`
 * (dt-schema skips those), and is left as it is.
 */
export function fixup_unit_suffix(schema: PropertySchema, { name }: FixupContext): PropertySchema {
    if (typeof schema === "boolean" || "type" in schema) { return schema; }

    if (ARRAY_SUFFIX.test(name) && is_int_schema(schema)) {
        schema["items"] = [extract_single_schemas(schema)];
    } else if (MATRIX_SUFFIX.test(name)) {
        if (is_matrix_schema(schema)) { return schema; }

        if (["items", "minItems", "maxItems"].some(key => key in schema)) {
            const row = structuredClone(schema);
            delete schema["minItems"];
            delete schema["maxItems"];
            schema["items"] = [row];
        } else if (is_int_schema(schema)) {
            schema["items"] = [{ items: [extract_single_schemas(schema)] }];
        }
    }

    return schema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const unit = (schema: PropertySchema, name: string) => fixup_unit_suffix(schema, { path: ["properties", name], name });

    test("a number constraint of a list property moves into its items", () => {
        expect(unit({ maximum: 10, description: "d" }, "foo-ns")).toStrictEqual({ items: [{ maximum: 10 }], description: "d" });
    });

    test("a matrix property's items become its row, a number constraint a row of one", () => {
        expect(unit({ items: [{ enum: [1, 2] }], minItems: 1, maxItems: 1 }, "foo-hz")).toStrictEqual({
            items: [{ items: [{ enum: [1, 2] }] , minItems: 1, maxItems: 1 }],
        });
        expect(unit({ enum: [1, 2] }, "foo-microvolt")).toStrictEqual({ items: [{ items: [{ enum: [1, 2] }] }] });
    });

    test("a matrix that has rows, another name, one that is typed and a boolean are left alone", () => {
        const rows = { items: [{ items: [{ enum: [1] }] }] };
        expect(unit(structuredClone(rows), "foo-hz")).toStrictEqual(rows);
        expect(unit({ maximum: 10 }, "foo")).toStrictEqual({ maximum: 10 });
        expect(unit({ type: "integer", maximum: 10 }, "foo-ns")).toStrictEqual({ type: "integer", maximum: 10 });
        expect(unit(true, "foo-ns")).toBe(true);
    });
}
