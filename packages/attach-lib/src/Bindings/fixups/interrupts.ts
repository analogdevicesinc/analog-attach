import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathEntry, PathValue } from "../UtilityTypes";

export function fixup_interrupts(binding: DtBindingSchema): DtBindingSchema {

    const has_interrupts = find_entry_in_object(binding,
        (path, key, _value) => {
            if (
                (key === "interrupts" || key === "interrupt-controller") &&
                path.at(-1) === "properties" &&
                path.at(0) !== 'allOf'
            ) {
                return true;
            }

            return false;
        }
    );

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const remove_duplicate_paths = (entry: PathEntry[]): PathEntry[] => {
        const seen = new Set<string>();

        return entry.filter(item => {
            const key = JSON.stringify(item.path);

            if (seen.has(key)) {
                return false;
            }

            seen.add(key);

            return true;
        });
    };

    const unique_paths = remove_duplicate_paths(has_interrupts);

    const has_interrupt_parent = find_entry_in_object(binding,
        (path, key, _value) => {
            if (
                key === "interrupt-parent" &&
                path.at(-1) === "properties"
            ) {
                return true;
            }

            return false;
        }
    );

    // eslint-disable-next-line unicorn/consistent-function-scoping
    const arraysEqual = (a: string[], b: string[]): boolean => {
        return a.length === b.length && a.every((value, index) => value === b[index]);
    };

    const updates: PathValue[] = [];

    for (const interrupt of unique_paths) {

        if (!has_interrupt_parent.some((value) => arraysEqual(value.path, interrupt.path))) {
            updates.push({
                path: [...interrupt.path, 'interrupt-parent'],
                value: {
                    minItems: 1,
                    maxItems: 1,
                    type: 'array'
                }
            });
        }

    }

    return overwrite_object_with_path_value(binding, updates);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_interrupts, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                compatible: {
                    enum: [
                        "one",
                        "two"
                    ]
                },
                interrupts: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                }
            },
            patternProperties: {
                "adc@[0-8]": {
                    properties: {
                        interrupts: {
                            minItems: 1,
                            maxItems: 1,
                            type: "array"
                        }
                    }
                }
            }
        };

        const fixuped = fixup_interrupts(binding);

        expect(fixuped).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                compatible: {
                    enum: [
                        "one",
                        "two"
                    ]
                },
                interrupts: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                },
                "interrupt-parent": {
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                }
            },
            patternProperties: {
                "adc@[0-8]": {
                    properties: {
                        interrupts: {
                            minItems: 1,
                            maxItems: 1,
                            type: "array"
                        },
                        "interrupt-parent": {
                            minItems: 1,
                            maxItems: 1,
                            type: "array"
                        }
                    }
                }
            }
        });

    });
}