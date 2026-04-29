import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_reg(binding: DtBindingSchema): DtBindingSchema {

    // TODO: implement find first occurrence of 
    const reg_property = find_entry_in_object(
        binding,
        (path, key, _value) => {
            if (key !== 'reg') {
                return false;
            }

            if (path.includes('allOf') || path.includes('oneOf') || path.includes('anyOf')) {
                return false;
            }

            return true;
        }
    );

    const fixuped_reg: PathValue[] = reg_property.map(
        (reg) => {

            let new_reg = reg.value as Record<string, any>;

            // TODO: atp it shouldn't be bool

            if (
                !(typeof new_reg === 'boolean') &&
                !("items" in new_reg)
            ) {
                // TODO: find a case like this and see how to resolve
            }

            if (
                !(typeof new_reg === 'boolean') &&
                "items" in new_reg &&
                !("items" in new_reg["items"])
            ) {
                let items;

                items = Array.isArray(new_reg["items"]) ? structuredClone(new_reg["items"]) : [structuredClone(new_reg["items"])];

                new_reg = overwrite_object_with_path_value(
                    new_reg,
                    [
                        {
                            path: ["items"],
                            value: [{ "items": items }]
                        }
                    ]
                );
            }

            if (
                !(typeof new_reg === 'boolean') &&
                !("items" in new_reg) &&
                "enum" in new_reg
            ) {
                let new_value: Record<string, any> = {};

                for (const [key, value] of Object.entries(new_reg)) {
                    if (["const", "enum", "minimum", "maximum", "multipleOf"].includes(key)) {
                        new_value[key] = structuredClone(value);
                        delete new_reg[key];
                    }
                }

                new_reg = overwrite_object_with_path_value(
                    new_reg,
                    [
                        {
                            path: ["items"],
                            value: [{ "items": [new_value] }]
                        }
                    ]
                );
            }

            return {
                path: [...reg.path, reg.key],
                value: { ...new_reg }
            };

        }
    );

    return overwrite_object_with_path_value(binding, fixuped_reg);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test("reg items array", () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                reg: {
                    items: [
                        {
                            minimum: 0,
                            maximum: 15,
                        }
                    ],
                    minItems: 1,
                    maxItems: 1
                }
            }
        };

        const fixuped = fixup_reg(binding);

        expect(fixuped).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
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
            }
        });
    });

    test("reg items object", () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                reg: {
                    items: {
                        minimum: 0,
                        maximum: 15,
                    },
                    minItems: 1,
                    maxItems: 1
                }
            }
        };

        const fixuped = fixup_reg(binding);

        expect(fixuped).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
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
            }
        });
    });

    test("reg no items", () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                reg: {
                    enum: [0, 1]
                }
            }
        };

        const fixuped = fixup_reg(binding);

        expect(fixuped).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                reg: {
                    items: [
                        {
                            items: [
                                {
                                    enum: [0, 1]
                                }
                            ]
                        }
                    ],
                }
            }
        });


    });
}