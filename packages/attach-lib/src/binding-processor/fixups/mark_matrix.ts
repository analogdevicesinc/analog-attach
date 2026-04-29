import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities.js";
import { PathValue } from "../UtilityTypes";

export function fixup_mark_matrix(binding: DtBindingSchema): DtBindingSchema {

    const unmarked_matrix = find_entry_in_object(
        binding,
        (path, key, value) => {

            if (path.includes("allOf")) {
                return false;
            }

            if (path.at(-1) !== "properties") {
                return false;
            }

            if (key === "interrupts" || key === "clocks") {
                return true;
            }

            return false;
        }
    );

    const marked_matrix = unmarked_matrix.map((unmarked) => {

        let marked = structuredClone(unmarked.value) as Record<string, any>;

        marked = overwrite_object_with_path_value(
            marked,
            [
                {
                    path: ["items"],
                    value: [
                        {
                            "items": {
                                minimum: 0,
                                maximum: 0xFF_FF_FF_FF
                            },
                            type: "array"
                        }
                    ]
                }
            ]
        );

        return {
            path: [...unmarked.path, unmarked.key],
            value: { ...marked }
        };
    });

    return overwrite_object_with_path_value(binding, marked_matrix);

}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_mark_matrix, () => {

        const binding: DtBindingSchema = {
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                interrupts: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                },
                clocks: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array"
                }
            }
        };

        const fixup = fixup_mark_matrix(binding);

        expect(fixup).toStrictEqual({
            $id: "test_id",
            $schema: "test_schema",
            title: "test_binding",
            maintainers: ["test"],
            select: true,
            properties:
            {
                interrupts: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array",
                    items: [
                        {
                            items: {
                                minimum: 0,
                                maximum: 0xFF_FF_FF_FF
                            },
                            type: "array"
                        }
                    ]
                },
                clocks: {
                    minItems: 1,
                    maxItems: 1,
                    type: "array",
                    items: [
                        {
                            items: {
                                minimum: 0,
                                maximum: 0xFF_FF_FF_FF
                            },
                            type: "array"
                        }
                    ]
                }
            },
        });

    });
}
