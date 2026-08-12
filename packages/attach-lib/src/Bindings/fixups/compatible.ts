import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value, delete_path } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_compatible(binding: DtBindingSchema): DtBindingSchema {
    // TODO: most likely needs to be extended to all (in devicetree) string properties
    // https://github.com/devicetree-org/dt-schema/blob/aa859412ce8e38c63bb13fa55c5e1c6ba66a8e3b/dtschema/fixups.py#L19
    const compatible_property = find_entry_in_object(
        binding,
        (path, key, _value) => {

            if (key === 'compatible' &&
                path.at(-1) === "properties" &&
                path.at(0) !== 'allOf'
            ) {
                return true;
            }

            return false;
        }
    );

    const fixuped_compatible_property: PathValue[] = compatible_property.map(
        (compatible) => {
            const unwrapped_enum_or_const = find_entry_in_object(
                compatible.value,
                (path, key, _value) => {
                    if (path.at(-1) === "items" || path.at(-2) === "items") {
                        return false;
                    }

                    return key === 'enum' || key === 'const';
                }
            );

            let new_compatible = compatible.value as Record<string, any>;

            for (const unwrapped_tag of unwrapped_enum_or_const) {
                new_compatible = overwrite_object_with_path_value(
                    new_compatible,
                    [
                        {
                            path: [...unwrapped_tag.path, "items"],
                            value: [
                                {
                                    [unwrapped_tag.key]: unwrapped_tag.value
                                }
                            ]
                        }
                    ]
                );

                new_compatible = delete_path(new_compatible, [[...unwrapped_tag.path, unwrapped_tag.key]]);
            }

            return {
                path: [...compatible.path, compatible.key],
                value: { ...new_compatible }
            };
        }
    );

    return overwrite_object_with_path_value(binding, fixuped_compatible_property);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(`${fixup_compatible.name} enum`, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties:
            {
                compatible: {
                    enum: [
                        "one",
                        "two"
                    ]
                }

            },
            patternProperties:
            {
                "adc@[0-1]": {
                    properties: {
                        compatible: {
                            enum: [
                                "one",
                                "two"
                            ]
                        }
                    }
                }
            }
        };

        const fixup = fixup_compatible(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
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
                }
            },
            patternProperties:
            {
                "adc@[0-1]": {
                    properties: {
                        compatible: {
                            items: [
                                {
                                    enum: [
                                        "one",
                                        "two"
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        });
    });


    test(`${fixup_compatible.name} const`, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties:
            {
                compatible: {
                    const: "one"
                }

            }
        };

        const fixup = fixup_compatible(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties:
            {
                compatible: {
                    items: [
                        {
                            const: "one"
                        }

                    ]
                }
            }
        });
    });

    test(`${fixup_compatible.name} oneOf`, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties:
            {
                compatible: {
                    oneOf: [
                        {
                            const: "one"
                        },
                        {
                            enum: [
                                "one",
                                "two"
                            ]
                        },
                        {
                            const: "bad",
                            deprecated: true
                        },
                        {
                            items: [
                                {
                                    const: "one"
                                },
                                {
                                    const: "two"
                                }
                            ]
                        }
                    ]
                }

            }
        };

        const fixup = fixup_compatible(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties:
            {
                compatible: {
                    oneOf: [
                        {
                            items: [
                                {
                                    const: "one"
                                }
                            ]
                        },
                        {
                            items: [
                                {
                                    enum: [
                                        "one",
                                        "two"
                                    ]
                                }
                            ]
                        },
                        {
                            items: [
                                {
                                    const: "bad",
                                }
                            ],
                            deprecated: true
                        },
                        {
                            items: [
                                {
                                    const: "one"
                                },
                                {
                                    const: "two"
                                }
                            ]
                        }
                    ]
                }

            }
        }
        );
    }
    );
}