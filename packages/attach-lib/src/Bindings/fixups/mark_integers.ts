import { DtBindingSchema, is_schema, map_entries, Schema } from "../Schema.js";
import { DT_TYPE } from "../RefResolver.js";

function bounds_numbers(value: unknown): value is Schema {
    return is_schema(value) && ("minimum" in value || "maximum" in value);
}

/** An array, as its `type` or its `dtType` says (`uint32-array`, `uint32-matrix`). */
function is_array_schema(schema: Schema): boolean {
    const dt_type = schema[DT_TYPE];
    return schema["type"] === "array" || (typeof dt_type === "string" && /-(array|matrix)$/.test(dt_type));
}

/** `cell` within the bounds `array` gives each of its values: the higher `minimum`, the lower `maximum`. */
function tightened(cell: unknown, array: Schema): unknown {
    if (!is_schema(cell) || "enum" in cell || "const" in cell || is_array_schema(cell)) { return cell; }

    const pick = (keyword: "minimum" | "maximum", tighter: (...bounds: number[]) => number): Schema => {
        const bounds = [cell[keyword], array[keyword]].filter(bound => typeof bound === "number");
        return bounds.length === 0 ? {} : { [keyword]: tighter(...bounds) };
    };
    return { ...cell, type: "integer", ...pick("minimum", Math.max), ...pick("maximum", Math.min) };
}

/**
 * An array whose `minimum` / `maximum` is its own (`lo_in-clock-scales: {$ref: uint32-array, minimum: 1}`, or in an
 * `allOf` beside the `$ref`) bounds each of its values, as the binding means: the bounds go to its cells. dt-schema
 * keeps them where they are, where they check nothing (a `minimum` is of a number), except for an array of one value
 * (`adi,full-scale-current-microamp: {maxItems: 1}`), whose `items` it gives them.
 */
function bound_array_cells(binding: DtBindingSchema): DtBindingSchema {
    return map_entries(binding, entry => {
        if (!bounds_numbers(entry) || !is_array_schema(entry) || !("items" in entry)) { return entry; }

        const { minimum: _minimum, maximum: _maximum, ...array } = entry;
        const items = array["items"];
        return { ...array, items: Array.isArray(items) ? items.map(cell => tightened(cell, entry)) : tightened(items, entry) };
    });
}

/** Types a schema with `minimum` / `maximum` as an integer, unless it is an array: its bounds are its values' then. */
export function fixup_mark_integers(binding: DtBindingSchema): DtBindingSchema {
    const marked = map_entries(binding, entry => bounds_numbers(entry) && !is_array_schema(entry) ? { ...entry, type: "integer" } : entry);
    return bound_array_cells(marked);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test("an array's own bounds are its values', not an integer's", () => {
        const uint32 = { type: "integer", typeSize: 32, minimum: 0, maximum: 0xFF_FF_FF_FF, dtType: "uint32" };
        const binding = {
            $id: "id", $schema: "s", title: "t", maintainers: [],
            properties: {
                // adi,adl5960.yaml, and ad916x.yaml's full scale current once its `allOf` is collapsed
                "lo_in-clock-scales": { type: "array", minItems: 1, items: uint32, dtType: "uint32-array", minimum: 1 },
                "adi,full-scale-current-microamp": { type: "array", minItems: 1, maxItems: 1, items: uint32, dtType: "uint32-array", minimum: 8000, maximum: 40_000 },
                "adi,pair": { type: "array", items: [{ minimum: 2 }, { const: 0 }], dtType: "uint8-array", maximum: 9 },
            },
        } as unknown as DtBindingSchema;

        const properties = fixup_mark_integers(binding).properties as Schema;
        expect(properties["lo_in-clock-scales"]).toStrictEqual({ type: "array", minItems: 1, items: { ...uint32, minimum: 1 }, dtType: "uint32-array" });
        expect(properties["adi,full-scale-current-microamp"]).toStrictEqual({ type: "array", minItems: 1, maxItems: 1, items: { ...uint32, minimum: 8000, maximum: 40_000 }, dtType: "uint32-array" });
        expect(properties["adi,pair"]).toStrictEqual({ type: "array", items: [{ minimum: 2, type: "integer", maximum: 9 }, { const: 0 }], dtType: "uint8-array" });
        // the cells of the type are not changed for the others
        expect(uint32.minimum).toBe(0);
    });

    test(fixup_mark_integers, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                compatible: {
                    items: [
                        {
                            enum: [
                                "one",
                                "two"
                            ]
                        }
                    ]
                },
                reg: {
                    items: [
                        {
                            items: [
                                {
                                    minimum: 0,
                                    maximum: 15,
                                }
                            ]
                        }
                    ],
                    minItems: 1,
                    maxItems: 1
                },
                "adi,sync-mode": {
                    minimum: 0,
                    maximum: 3,
                }
            },
            allOf: [
                {
                    if: {
                        properties: {
                            compatible: {
                                contains: {
                                    enum: [
                                        "two"
                                    ]
                                },
                                type: "array"
                            }
                        }
                    },
                    // eslint-disable-next-line unicorn/no-thenable
                    then: {
                        properties: {
                            "adi,sync-mode": {
                                minimum: 0,
                                maximum: 2,
                            }
                        }

                    }
                }
            ]
        };

        const fixup = fixup_mark_integers(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                compatible: {
                    items: [
                        {
                            enum: [
                                "one",
                                "two"
                            ]
                        }
                    ]
                },
                reg: {
                    items: [
                        {
                            items: [
                                {
                                    minimum: 0,
                                    maximum: 15,
                                    type: "integer"
                                }
                            ]
                        }
                    ],
                    minItems: 1,
                    maxItems: 1
                },
                "adi,sync-mode": {
                    minimum: 0,
                    maximum: 3,
                    type: "integer"
                }
            },
            allOf: [
                {
                    if: {
                        properties: {
                            compatible: {
                                contains: {
                                    enum: [
                                        "two"
                                    ]
                                },
                                type: "array"
                            }
                        }
                    },
                    // eslint-disable-next-line unicorn/no-thenable
                    then: {
                        properties: {
                            "adi,sync-mode": {
                                minimum: 0,
                                maximum: 2,
                                type: "integer"
                            }
                        }

                    }
                }
            ]
        });
    });
}