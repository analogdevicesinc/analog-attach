import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_ifs(binding: DtBindingSchema): DtBindingSchema {

    const ifs = find_entry_in_object(
        binding,
        (path, key, _value) => {
            if (key !== 'if') {
                return false;
            }

            if (path.at(-1) === undefined || path.at(-2) !== 'allOf') {
                return false;
            }

            return true;
        }
    );

    const marked_properties_required_ifs: PathValue[] = (() => {

        const accumulator: PathValue[] = [];

        for (const entry of ifs) {
            const if_condition = entry.value as Record<string, any>;
            if (!("properties" in if_condition)) {
                continue;
            }

            let properties: string[] = [];

            for (const property of Object.entries(if_condition["properties"])) {
                properties.push(property[0]);
            }

            accumulator.push(
                {
                    path: [...entry.path, entry.key],
                    value: {
                        ...if_condition,
                        'required': properties,
                        'type': "object"
                    }
                }
            );
        }

        return accumulator;
    })();

    return overwrite_object_with_path_value(binding, marked_properties_required_ifs);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_ifs, () => {

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
        };

        const fixuped = fixup_ifs(binding);

        expect(fixuped).toStrictEqual({
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
                        },
                        required: ["compatible"],
                        type: "object"
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