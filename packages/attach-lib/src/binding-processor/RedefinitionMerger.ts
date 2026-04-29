import { JSONSchema } from "@apidevtools/json-schema-ref-parser/dist/lib/types";
import { DtBindingSchema } from "../DtBindingSchema";
import { bidirectional_custom_resolve } from "./RefResolver.js";
import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import { deep_merge, delete_path, find_entry_in_object, overwrite_object_with_path_value } from "./ObjectUtilities.js";
import { PathValue, PlainObject } from "./UtilityTypes.js";

export async function merge_redefinitions(
    binding: DtBindingSchema,
    references: DtBindingSchema[],
    reference_parser: $RefParser,
    linux_path: string,
    dt_schema_path: string
): Promise<DtBindingSchema> {
    /*
        Find all common properties ref'd in allOf
        Ignore everything that is logic for modifying the root properties
    */
    const common_properties = find_entry_in_object(binding,
        (path, _key, _value) => {
            const root_entry = path.at(0);

            if (root_entry === undefined) {
                return false;
            }

            if (root_entry !== 'allOf') {
                return false;
            }

            const property = path.at(-1);

            if (property === undefined) {
                return false;
            }

            if (property !== 'properties') {
                return false;
            }

            if (path.includes("if") || path.includes("then") || path.includes("else") || path.includes("not")) {
                return false;
            }

            return true;
        }
    );

    const root_properties = find_entry_in_object(binding,
        (path, _key, _value) => {
            const root_entry = path.at(0);

            if (root_entry === undefined) {
                return false;
            }

            if (root_entry !== 'properties') {
                return false;
            }

            if (path.length !== 1) {
                return false;
            }

            return true;
        }
    );

    const redefinitions = common_properties.map(
        (value) => { return value.key; }
    ).filter(
        common_property => root_properties.map((value) => { return value.key; }).includes(common_property)
    );

    const extended_definitions: PathValue[] = (() => {

        const accumulator: PathValue[] = [];

        for (const redefinition of redefinitions) {
            const base = root_properties.find((value) => { return value.key === redefinition; });

            if (base === undefined) {
                continue;
            }

            const extension = common_properties.find((value) => { return value.key === redefinition; });

            if (extension === undefined) {
                continue;
            }

            accumulator.push(
                {
                    path: ["properties", extension.key],
                    value: deep_merge(extension.value as PlainObject, base.value as PlainObject)
                });
        }

        return accumulator;

    })();

    const extended_properties_binding = overwrite_object_with_path_value(binding, extended_definitions);

    const extensions_to_delete: string[][] = (() => {
        const accumulator: string[][] = [];

        for (const redefinition of redefinitions) {
            const extension = common_properties.find((value) => { return value.key === redefinition; });

            if (extension === undefined) {
                continue;
            }

            accumulator.push(
                [...extension.path, extension.key],
            );
        }

        return accumulator;

    })();

    const deleted_merged_extensions = delete_path(extended_properties_binding, extensions_to_delete);

    const patternProperties = find_entry_in_object(
        deleted_merged_extensions,
        (path, _value) => {
            return path.at(-1) === "patternProperties";
        }
    );

    const inherited_patternProperties = patternProperties.filter(
        (pattern) => {
            // TODO: special case needs to be handled
            if (typeof pattern.value === 'boolean') {
                return false;
            }

            return "$id" in (pattern.value as Object) === true;
        });

    const extended_pattern_properties = await (async () => {

        let accumulator = structuredClone(deleted_merged_extensions);

        for (const inherited_pattern_property of inherited_patternProperties) {

            const properties = find_entry_in_object(inherited_pattern_property.value,
                (path, _key, _value) => {
                    const root_entry = path.at(0);

                    if (root_entry === undefined) {
                        return false;
                    }

                    if (root_entry !== 'properties') {
                        return false;
                    }

                    if (path.length !== 1) {
                        return false;
                    }

                    return true;
                }
            );

            const parent = references.find((schema) => { return schema.$id === (inherited_pattern_property.value as JSONSchema).$id; });

            if (parent === undefined) {
                continue;
            }

            const reference_resolved_parent = await bidirectional_custom_resolve(reference_parser, parent as JSONSchema, linux_path, dt_schema_path);

            if (typeof reference_resolved_parent === 'string') {
                continue;
            }

            const parent_properties = find_entry_in_object(reference_resolved_parent,
                (path, _key, _value) => {
                    const root_entry = path.at(0);

                    if (root_entry === undefined) {
                        return false;
                    }

                    if (root_entry !== 'properties') {
                        return false;
                    }

                    if (path.length !== 1) {
                        return false;
                    }

                    return true;
                }
            );

            const parent_redefinitions = parent_properties.map(
                (value) => { return value.key; }
            ).filter(
                common_property => properties.map((value) => { return value.key; }).includes(common_property)
            );

            const parent_extended_definitions: PathValue[] = (() => {

                const accumulator: PathValue[] = [];

                for (const redefinition of parent_redefinitions) {
                    const base = properties.find((value) => { return value.key === redefinition; });

                    if (base === undefined) {
                        continue;
                    }

                    const extension = parent_properties.find((value) => { return value.key === redefinition; });

                    if (extension === undefined) {
                        continue;
                    }

                    accumulator.push(
                        {
                            path: ["properties", extension.key],
                            value: deep_merge(extension.value as PlainObject, base.value as PlainObject)
                        });
                }

                return accumulator;

            })();

            const extended_pattern_properties_binding = overwrite_object_with_path_value((inherited_pattern_property.value as Object), parent_extended_definitions);

            const updates: PathValue[] = [
                {
                    path: [...inherited_pattern_property.path, inherited_pattern_property.key],
                    value: extended_pattern_properties_binding
                }
            ];

            accumulator = overwrite_object_with_path_value(accumulator, updates);
        }
        return accumulator;
    })();

    return extended_pattern_properties;
}
