import { JSONSchema } from "@apidevtools/json-schema-ref-parser/dist/lib/types";
import { DtBindingSchema } from "./Schema";
import { SchemaContext } from "./Context.js";
import { dereference } from "./RefResolver.js";
import { deep_merge, delete_path, find_entry_in_object, overwrite_object_with_path_value } from "./ObjectUtilities.js";
import { PathEntry, PathValue, PlainObject } from "./UtilityTypes.js";
import { Result } from "../result.js";

/** The entries of the schema's own `properties`. */
function top_level_properties(schema: unknown): PathEntry[] {
    return find_entry_in_object(schema, (path) => path.length === 1 && path[0] === "properties");
}

/**
 * The properties of `base` that `extensions` define again, each merged over its
 * extension: `deep_merge(extension, base)`, so `base` wins where both say something.
 */
function merge_redefined(base: PathEntry[], extensions: PathEntry[]): PathValue[] {
    const base_keys = new Set(base.map(entry => entry.key));
    const merged: PathValue[] = [];

    for (const { key } of extensions) {
        if (!base_keys.has(key)) {
            continue;
        }

        const base_entry = base.find(entry => entry.key === key)!;
        const extension = extensions.find(entry => entry.key === key)!;

        merged.push({
            path: ["properties", key],
            value: deep_merge(extension.value as PlainObject, base_entry.value as PlainObject),
        });
    }

    return merged;
}

export async function merge_redefinitions(
    binding: DtBindingSchema,
    references: DtBindingSchema[],
    ctx: SchemaContext,
): Promise<DtBindingSchema> {
    /*
        Find all common properties ref'd in allOf
        Ignore everything that is logic for modifying the root properties
    */
    const common_properties = find_entry_in_object(binding,
        (path) => (
            path.at(0) === "allOf" &&
            path.at(-1) === "properties" &&
            !path.includes("if") && !path.includes("then") && !path.includes("else") && !path.includes("not")
        )
    );

    const extended_definitions = merge_redefined(top_level_properties(binding), common_properties);

    const extended_properties_binding = overwrite_object_with_path_value(binding, extended_definitions);

    const extensions_to_delete: string[][] = extended_definitions.map(({ path: [, key] }) => {
        const extension = common_properties.find((entry) => entry.key === key)!;
        return [...extension.path, extension.key];
    });

    const deleted_merged_extensions = delete_path(extended_properties_binding, extensions_to_delete);

    const inherited_pattern_properties = find_entry_in_object(
        deleted_merged_extensions,
        (path) => path.at(-1) === "patternProperties"
    ).filter(
        // TODO: special case needs to be handled
        (pattern) => typeof pattern.value !== "boolean" && "$id" in (pattern.value as object)
    );

    let extended_pattern_properties = deleted_merged_extensions;

    for (const inherited_pattern_property of inherited_pattern_properties) {
        const parent = references.find((schema) => schema.$id === (inherited_pattern_property.value as JSONSchema).$id);

        if (parent === undefined) {
            continue;
        }

        const reference_resolved_parent = await dereference(ctx, parent as JSONSchema);

        if (Result.is_err(reference_resolved_parent)) {
            continue;
        }

        const parent_extended_definitions = merge_redefined(
            top_level_properties(inherited_pattern_property.value),
            top_level_properties(reference_resolved_parent.value),
        );

        const extended_pattern_properties_binding = overwrite_object_with_path_value(
            inherited_pattern_property.value as object,
            parent_extended_definitions
        );

        extended_pattern_properties = overwrite_object_with_path_value(extended_pattern_properties, [
            {
                path: [...inherited_pattern_property.path, inherited_pattern_property.key],
                value: extended_pattern_properties_binding,
            },
        ]);
    }

    return extended_pattern_properties;
}
