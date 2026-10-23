import { DtBindingSchema } from "./Schema";
import { fixup_collapse_allOf } from "./fixups/collapse_allOf";
import { fixup_dt_type } from "./fixups/dt_type.js";
import { fixup_interrupts } from "./fixups/interrupts.js";
import { fixup_items_size } from "./fixups/items_size.js";
import { fixup_ifs } from "./fixups/mark_ifs_required_properties.js";
import { fixup_mark_integers } from "./fixups/mark_integers.js";
import { fixup_mark_matrix } from "./fixups/mark_matrix";
import { fixup_names } from "./fixups/names.js";
import { fixup_string_to_array } from "./fixups/string_to_array.js";
import { fixup_reg } from "./fixups/reg.js";
import { apply_fixups, Fixups } from "./FixupWalker.js";
import { NO_PROPERTY_TYPES, PropertyTypes } from "./PropertyTypes.js";
import { fixup_remove_invalid_keys } from "./fixups/remove_invalid_keys.js";

/**
 * The fixups that work on one node's or one property's schema, in the order they run. They walk the schema
 * once, the way dt-schema's `fixups.py` does (see `FixupWalker.ts`); each names its counterpart there.
 */
const fixups = (types: PropertyTypes): Fixups => ({
    node: [fixup_remove_invalid_keys, fixup_interrupts],
    property: [fixup_string_to_array, fixup_names, fixup_reg, fixup_items_size, fixup_dt_type(types)],
});

/**
 * Our fixups run before and after the walk. dt-schema has nothing like them because it keeps the
 * `$ref`s to `types.yaml` and gets what a property is (an integer, a matrix, a phandle array) from
 * there (`validator.py:_extract_prop_type`); we dereference, and have to guess it from the shape:
 *
 * - `collapse_allOf` flattens the `allOf` the dereferencing leaves in a property into one schema.
 * - `fixup_ifs` makes an `allOf` branch's `if` require the properties it tests (and be an object), so
 *   that a condition whose properties are absent doesn't match.
 * - `fixup_mark_integers` types a schema with `minimum` / `maximum` as an integer.
 * - `fixup_mark_matrix` shapes `interrupts` and `clocks` as lists of cell lists.
 */
export function apply_JSONSchema_fixups(binding: DtBindingSchema, types: PropertyTypes = NO_PROPERTY_TYPES): DtBindingSchema {

    const collapsed = fixup_collapse_allOf(binding);
    const fixuped_properties = apply_fixups(collapsed, fixups(types));
    const fixuped_ifs = fixup_ifs(fixuped_properties);
    const fixuped_marked_integers = fixup_mark_integers(fixuped_ifs);
    const fixuped_marked_matrix = fixup_mark_matrix(fixuped_marked_integers);

    // dt-schema: `validator.py:process_schema`
    return { ...fixuped_marked_matrix, type: "object" } as DtBindingSchema;
}
