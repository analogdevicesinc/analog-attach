/* eslint-disable unicorn/prevent-abbreviations */
import { $RefParser } from "@apidevtools/json-schema-ref-parser";
import { DtBindingSchema } from "../DtBindingSchema";
import { bidirectional_custom_resolve } from "./RefResolver.js";
import { PathValue, RefResolvedBinding } from "./UtilityTypes.js";
import { compare_arrays, find_entry_in_object, find_in_object, map_object } from "./ObjectUtilities.js";

type PathDefinition = {
    path: string[],
    definition: {
        [key: string]: unknown
    }
}

// TODO: handle recursive definitions
export async function resolve_properties(
    ref_resolved: RefResolvedBinding,
    parser: $RefParser,
    linux_path: string,
    dt_schema_path: string
): Promise<DtBindingSchema | string> {

    /*
        Searching for incomplete properties has the assumption that the form is like this:
        ```
            properties:
                property: true
        ```
    */
    const incomplete_properties: PathValue[] = find_in_object(
        ref_resolved.root_binding,
        (path, value) => {
            const properties = path.at(-2);
            return (properties !== undefined && properties === "properties" && typeof value === 'boolean' && value === true);
        }
    );

    /*
        We search for the definitions of the incomplete properties in the refs used to dereference the original binding
        We assume we'll only find one definition and won't need to choose
        We assume we'll find the definition in those refs
    */
    const properties_definitions: PathDefinition[] | string = (() => {

        const accumulator: PathDefinition[] = [];

        for (const unresolved_property of incomplete_properties) {

            const unresolved = unresolved_property.path.at(-1);

            if (unresolved === undefined) {
                return "Fail1";
            }

            for (const ref of ref_resolved.refs) {

                const resolved_prop_defs = find_entry_in_object(
                    ref,
                    (path, key, value) => {
                        return (
                            key === unresolved &&
                            typeof value !== 'boolean' &&
                            path.includes("properties") &&
                            !path.includes("if") &&
                            !path.includes("then") &&
                            !path.includes("else")
                        );
                    }
                );

                if (resolved_prop_defs.length === 0) {
                    continue;
                }

                const resolved: PathDefinition = {
                    path: unresolved_property.path,
                    definition: resolved_prop_defs[0].value as Record<string, unknown>
                };

                accumulator.push(resolved);
            }
        }

        return accumulator;
    })();

    if (typeof properties_definitions === 'string') {
        return properties_definitions;
    }

    /*
        Sometimes the found definitions need to be resolved again
        We assume resolving won't break if there isn't anything to be resolved
    */
    const resolved_properties: PathValue[] | string = await (async () => {

        const accumulator: PathValue[] = [];

        for (const property_definition of properties_definitions) {
            const try_resolve = await bidirectional_custom_resolve(parser, property_definition.definition, linux_path, dt_schema_path);

            if (typeof try_resolve === "string") {
                return try_resolve;
            }

            accumulator.push(
                {
                    path: property_definition.path,
                    value: try_resolve
                }
            );
        }

        return accumulator;
    })();

    if (typeof resolved_properties === 'string') {
        return resolved_properties;
    }

    const property_resolved_binding = map_object(
        ref_resolved.root_binding,
        (path, value) => {

            const replace = resolved_properties.find(
                (resolved_property) => {
                    return compare_arrays(resolved_property.path, path);
                }
            );

            if (replace !== undefined) {
                value = replace.value;
            }

            return value;
        }
    );

    return property_resolved_binding as DtBindingSchema;
}
