import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, delete_path } from "../ObjectUtilities.js";

export function fixup_remove_invalid_keys(binding: DtBindingSchema): DtBindingSchema {

    const schema_tags = find_entry_in_object(binding,
        (_path, key, _value) => {
            if (key === "$schema" || key === "maintainers" || key === "select") {
                return true;
            }

            return false;
        }
    );

    const schema_tags_paths = schema_tags.map((value) => { return [...value.path, value.key]; });

    return delete_path(binding, schema_tags_paths);
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    test(fixup_remove_invalid_keys, () => {

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
                }

            }
        };

        const fixuped = fixup_remove_invalid_keys(binding);

        expect(fixuped).toStrictEqual({
            $id: "test_id",
            title: "test_binding",
            properties: {
                compatible: {
                    enum: [
                        "one",
                        "two"
                    ]
                }

            }
        });
    });
}