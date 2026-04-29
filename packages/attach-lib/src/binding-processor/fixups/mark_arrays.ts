import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_mark_arrays(binding: DtBindingSchema): DtBindingSchema {

    const unmarked_arrays = find_entry_in_object(
        binding,
        (path, _key, value) => {
            if (
                Array.isArray(value) ||
                value === null ||
                typeof value !== 'object'
            ) {
                return false;
            }

            const typecast_value = value as Object;

            if ('type' in typecast_value) {
                return false;
            }

            if (
                'maxItems' in typecast_value ||
                'minItems' in typecast_value ||
                'items' in typecast_value ||
                'contains' in typecast_value
            ) {
                return true;
            }

            return false;
        }
    );

    const marked_arrays: PathValue[] = unmarked_arrays.map(
        (array) => {

            const unmarked_array = array.value as Object;

            return {
                path: [...array.path, array.key],
                value: {
                    ...unmarked_array,
                    type: "array"
                }
            };
        }
    );

    return overwrite_object_with_path_value(binding, marked_arrays);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_mark_arrays, () => {

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
                                }
                            }
                        }
                    }
                }
            ]
        };

        const fixup = fixup_mark_arrays(binding);

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
                            type: "array"

                        }
                    ],
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