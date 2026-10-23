import { DtBindingSchema } from "./Schema";
import { fixup_collapse_allOf } from "./fixups/collapse_allOf";
import { fixup_compatible } from "./fixups/compatible.js";
import { fixup_interrupts } from "./fixups/interrupts.js";
import { fixup_mark_array_size } from "./fixups/mark_array_size.js";
import { fixup_mark_arrays } from "./fixups/mark_arrays.js";
import { fixup_ifs } from "./fixups/mark_ifs_required_properties.js";
import { fixup_mark_integers } from "./fixups/mark_integers.js";
import { fixup_mark_matrix } from "./fixups/mark_matrix";
import { fixup_names_arrays } from "./fixups/names";
import { fixup_reg } from "./fixups/reg.js";
import { fixup_remove_invalid_keys } from "./fixups/remove_invalid_keys.js";
import { overwrite_object_with_path_value } from "./ObjectUtilities.js";
import { is_node_pattern } from "./PatternKind.js";

export function apply_JSONSchema_fixups(binding: DtBindingSchema) {

    const fixuped_allOf = fixup_collapse_allOf(fixup_property_patterns(binding));
    const fixuped_names = fixup_names_arrays(fixuped_allOf);
    const fixuped_reg = fixup_reg(fixuped_names);
    const fixuped_compatible = fixup_compatible(fixuped_reg);
    const fixuped_marked_arrays = fixup_mark_arrays(fixuped_compatible);
    const fixuped_ifs = fixup_ifs(fixuped_marked_arrays);
    const fixuped_marked_integers = fixup_mark_integers(fixuped_ifs);

    const fixuped_mark_binding_as_object = overwrite_object_with_path_value(
        fixuped_marked_integers,
        [
            {
                path: ['type'],
                value: "object"
            }
        ]
    );

    const fixuped_remove_invalid_keys = fixup_remove_invalid_keys(fixuped_mark_binding_as_object);
    const fixuped_interrupts = fixup_interrupts(fixuped_remove_invalid_keys);
    const fixuped_marked_arrays_size = fixup_mark_array_size(fixuped_interrupts);
    const fixuped_marked_matrix = fixup_mark_matrix(fixuped_marked_arrays_size);

    return fixuped_marked_matrix;
}

/**
 * The fixups look at `properties` only. Property patterns (see
 * `is_node_pattern`) get the same ones, run as the properties of a stub schema.
 */
function fixup_property_patterns(binding: DtBindingSchema): DtBindingSchema {
    const patterns = binding.patternProperties;
    if (patterns === undefined) {
        return binding;
    }

    const property_patterns = Object.entries(patterns)
        .filter(([pattern, schema]) => typeof schema === 'object' && schema !== null && !is_node_pattern(pattern, schema));
    if (property_patterns.length === 0) {
        return binding;
    }

    const fixuped = apply_JSONSchema_fixups({ properties: Object.fromEntries(property_patterns) } as DtBindingSchema);
    return {
        ...binding,
        patternProperties: Object.fromEntries(Object.entries(patterns).map(([pattern, schema]) => [
            pattern,
            fixuped.properties?.[pattern] ?? schema,
        ])),
    };
}
