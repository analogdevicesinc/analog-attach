import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_mark_array_size(binding: DtBindingSchema): DtBindingSchema {

    const arrays = find_entry_in_object(
        binding,
        (path, _key, value) => {
            if (!['properties', 'patternProperties'].includes(path[0])) {
                return false;
            }

            if (
                Array.isArray(value) ||
                value === null ||
                typeof value !== 'object'
            ) {
                return false;
            }

            if (
                path.includes("then") ||
                path.includes("else")
            ) {
                return false;
            }

            const typecast_value = value as Object;

            if (
                'type' in typecast_value &&
                typecast_value['type'] === 'array'
            ) {
                return true;
            }

            return false;
        }
    );

    // https://github.com/devicetree-org/dt-schema/blob/7033eb7cec1abe55f496309f0f6f271524f5d612/dtschema/fixups.py#L112
    const sized_arrays: PathValue[] = arrays.map(
        (array) => {
            const unmarked_array = array.value as Object;

            if (
                "items" in unmarked_array &&
                Array.isArray(unmarked_array["items"])
            ) {
                const fixed_length = unmarked_array["items"].length;

                const minItems = "minItems" in unmarked_array ? unmarked_array["minItems"] : fixed_length;
                const maxItems = "maxItems" in unmarked_array ? unmarked_array["maxItems"] : fixed_length;

                return {
                    path: [...array.path, array.key],
                    value: {
                        ...unmarked_array,
                        minItems: minItems,
                        maxItems: maxItems
                    }
                };
            }

            if (
                "maxItems" in unmarked_array &&
                !("minItems" in unmarked_array)
            ) {
                return {
                    path: [...array.path, array.key],
                    value: {
                        ...unmarked_array,
                        minItems: unmarked_array["maxItems"]
                    }
                };
            }

            if (
                "minItems" in unmarked_array &&
                !("maxItems" in unmarked_array)
            ) {
                return {
                    path: [...array.path, array.key],
                    value: {
                        ...unmarked_array,
                        maxItems: unmarked_array["minItems"]
                    }
                };
            }

            return {
                path: [...array.path, array.key],
                value: array.value
            };
        });

    return overwrite_object_with_path_value(binding, sized_arrays);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_mark_array_size, () => {

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
                    ],
                    type: "array"
                },
                reg: {
                    items: [
                        {
                            items: [
                                {
                                    minimum: 0,
                                    maximum: 15,
                                }
                            ],
                            type: "array"
                        }
                    ],
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                },
                clocks: {
                    maxItems: 1,
                    type: "array"
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
                    }
                }
            ]
        };

        const fixup = fixup_mark_array_size(binding);

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
                    ],
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                },
                reg: {
                    items: [
                        {
                            items: [
                                {
                                    minimum: 0,
                                    maximum: 15,
                                },
                            ],
                            minItems: 1,
                            maxItems: 1,
                            type: "array"

                        }
                    ],
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                },
                clocks: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
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
                    }
                }
            ]
        });

    });
}