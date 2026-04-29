import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_mark_integers(binding: DtBindingSchema): DtBindingSchema {
    const minimum_or_maximum = find_entry_in_object(
        binding,
        (_path, _key, value) => {

            if (
                Array.isArray(value) ||
                value === null ||
                typeof value !== 'object'
            ) {
                return false;
            }

            if (
                ("minimum" in (value as Object)) ||
                ("maximum" in (value as Object))
            ) {
                return true;
            }

            return false;
        }
    );

    const marked_integers: PathValue[] = minimum_or_maximum.map(
        (integer) => {
            return {
                path: [...integer.path, integer.key],
                value: {
                    ...integer.value as Object,
                    type: "integer"
                }
            };
        }
    );

    return overwrite_object_with_path_value(binding, marked_integers);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

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