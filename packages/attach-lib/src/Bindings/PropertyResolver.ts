/* eslint-disable unicorn/prevent-abbreviations */
import { DtBindingSchema } from "./Schema";
import { SchemaContext } from "./Context.js";
import { dereference } from "./RefResolver.js";
import { PathValue, RefResolvedBinding } from "./UtilityTypes.js";
import { compare_arrays, find_entry_in_object, find_in_object, map_object } from "./ObjectUtilities.js";
import { Result } from "../result.js";

type PathDefinition = {
    path: string[],
    definition: Record<string, unknown>,
}

// TODO: handle recursive definitions
export async function resolve_properties(
    ref_resolved: RefResolvedBinding,
    ctx: SchemaContext,
): Promise<Result<DtBindingSchema, string>> {

    /*
        Searching for incomplete properties has the assumption that the form is like this:
        ```
            properties:
                property: true
        ```
    */
    const incomplete_properties: PathValue[] = find_in_object(
        ref_resolved.root_binding,
        (path, value) => path.at(-2) === "properties" && value === true
    );

    /*
        We search for the definitions of the incomplete properties in the refs used to dereference the original binding
        We assume we'll only find one definition and won't need to choose
        We assume we'll find the definition in those refs
    */
    const properties_definitions: PathDefinition[] = [];

    for (const unresolved_property of incomplete_properties) {
        const unresolved = unresolved_property.path.at(-1);

        if (unresolved === undefined) {
            return Result.Err("incomplete property has an empty path");
        }

        for (const ref of ref_resolved.refs) {
            const resolved_prop_defs = find_entry_in_object(
                ref,
                (path, key, value) => (
                    key === unresolved &&
                    typeof value !== "boolean" &&
                    path.includes("properties") &&
                    !path.includes("if") &&
                    !path.includes("then") &&
                    !path.includes("else")
                )
            );

            if (resolved_prop_defs.length === 0) {
                continue;
            }

            properties_definitions.push({
                path: unresolved_property.path,
                definition: resolved_prop_defs[0].value as Record<string, unknown>,
            });
        }
    }

    /*
        Sometimes the found definitions need to be resolved again
        We assume resolving won't break if there isn't anything to be resolved
    */
    const resolved_properties: PathValue[] = [];

    for (const property_definition of properties_definitions) {
        const resolved = await dereference(ctx, property_definition.definition);

        if (Result.is_err(resolved)) {
            return Result.Err(resolved.error);
        }

        resolved_properties.push({ path: property_definition.path, value: resolved.value });
    }

    const property_resolved_binding = map_object(
        ref_resolved.root_binding,
        (path, value) => {
            const replace = resolved_properties.find(resolved => compare_arrays(resolved.path, path));
            return replace === undefined ? value : replace.value;
        }
    );

    return Result.Ok(property_resolved_binding as DtBindingSchema);
}
