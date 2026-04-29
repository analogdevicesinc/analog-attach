import { DtBindingSchema } from "../../DtBindingSchema";
import { find_entry_in_object, overwrite_object_with_path_value } from "../ObjectUtilities";

export function fixup_names_arrays(binding: DtBindingSchema): DtBindingSchema {

    const names_properties = find_entry_in_object(
        binding,
        (path: string[], key: string, value: unknown) => {
            const properties = path.at(-1);

            if (properties === undefined) {
                return false;
            }

            if (path.includes("if") || path.includes("then") || path.includes("else")) {
                return false;
            }

            if (properties !== "properties") {
                return false;
            }

            return key.endsWith("-names") && typeof value !== "boolean";
        }
    );

    const fixuped_names_properties = names_properties.map(
        (names_property) => {

            const names_definition = {
                type: "array",
                items: { type: "string" },
                minItems: 1
            };

            const original_definition: Record<string, unknown> = structuredClone(names_property.value as Record<string, unknown>);

            if ("enum" in original_definition) {
                const enum_value: Record<"enum", unknown> = {
                    enum: structuredClone(original_definition["enum"])
                };

                delete original_definition["enum"];

                names_definition.items = { ...names_definition.items, ...enum_value };
            } else if ("const" in original_definition) {
                const const_value: Record<"const", unknown> = {
                    const: structuredClone(original_definition["const"])
                };

                delete original_definition["const"];

                names_definition.items = { ...names_definition.items, ...const_value };
            }

            return {
                path: [...names_property.path, names_property.key],
                value: { ...names_definition, ...original_definition }
            };
        }
    );

    return overwrite_object_with_path_value(binding, fixuped_names_properties);
}