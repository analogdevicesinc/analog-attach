import { DtBindingSchema, is_schema, map_entries } from "../Schema.js";

/** Each `if` of an `allOf` entry that tests properties requires them, so that it doesn't match a node without them. */
export function fixup_ifs(binding: DtBindingSchema): DtBindingSchema {
    return map_entries(binding, (entry, path) => {
        if (path.at(-1) !== "if" || path.at(-3) !== "allOf" || !is_schema(entry) || !is_schema(entry["properties"])) { return entry; }
        return { ...entry, required: Object.keys(entry["properties"]), type: "object" };
    });
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