import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";

export function fixup_collapse_allOf(binding: DtBindingSchema): DtBindingSchema {

    const properties = find_entry_in_object(
        binding,
        (path, _key, _value) => {
            if (path.at(0) !== 'properties') {
                return false;
            }

            if (path.length !== 1) {
                return false;
            }

            return true;
        }
    );

    const to_collapse = properties.filter((property) => {

        const has_other_combinator = find_entry_in_object(
            property.value,
            (_path, key, _value) => {
                if (key === 'oneOf' || key === 'anyOf' || key === 'not') {
                    return true;
                }

                return false;
            }
        );

        if (has_other_combinator.length > 0) {
            return false;
        }

        const has_allOf = find_entry_in_object(
            property.value,
            (_path, key, _value) => {
                if (key === 'allOf') {
                    return true;
                }

                return false;
            }
        );

        if (has_allOf.length > 0) {
            return true;
        }

        return false;
    });

    const collapsed = to_collapse.map((property) => {
        const new_value = collapse_allOf(property.value as Record<string, any>[]);


        return {
            path: [...property.path, property.key],
            value: { ...new_value }
        };
    });

    return overwrite_object_with_path_value(binding, collapsed);
}


export function collapse_allOf(input: Record<string, any>): Record<string, any> {
    function recurse(value: any): any {
        if (Array.isArray(value)) {
            return value.map((element) => recurse(element));
        }

        if (value !== undefined && typeof value === "object") {
            let result: Record<string, any> = {};

            for (const [key, inner_value] of Object.entries(value)) {
                if (key === "allOf" && Array.isArray(inner_value)) {
                    for (const entry of inner_value) {
                        const flattened = recurse(entry);

                        if (
                            flattened !== undefined &&
                            typeof flattened === "object" &&
                            !Array.isArray(flattened)
                        ) {
                            result = { ...result, ...flattened };
                        }
                    }
                } else {
                    result[key] = recurse(inner_value);
                }
            }

            return result;
        }

        return value;
    }

    return recurse(input);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_collapse_allOf, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties: {
                regulator_name: {
                    description: "A string used as a descriptive name for regulator outputs",
                    allOf: [
                        {
                            allOf: [
                                {
                                    type: "array",
                                    items: {
                                        type: "string"
                                    },
                                    minItems: 1
                                },
                                {
                                    uniqueItems: true
                                }
                            ]
                        },
                        {
                            maxItems: 1
                        }
                    ]
                }
            }
        };

        const fixup = fixup_collapse_allOf(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            properties: {
                regulator_name: {
                    description: "A string used as a descriptive name for regulator outputs",
                    type: "array",
                    items: {
                        type: "string"
                    },
                    minItems: 1,
                    uniqueItems: true,
                    maxItems: 1
                }
            }
        });
    });
}

