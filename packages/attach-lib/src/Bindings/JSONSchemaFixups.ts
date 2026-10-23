import { DtBindingSchema } from "./Schema";
import { fixup_collapse_allOf } from "./fixups/collapse_allOf";
import { fixup_dt_type } from "./fixups/dt_type.js";
import { fixup_interrupts } from "./fixups/interrupts.js";
import { fixup_items_size } from "./fixups/items_size.js";
import { fixup_ifs } from "./fixups/mark_ifs_required_properties.js";
import { fixup_mark_integers } from "./fixups/mark_integers.js";
import { fixup_matrix_rows } from "./fixups/matrix_rows.js";
import { fixup_names } from "./fixups/names.js";
import { fixup_oneof_to_enum } from "./fixups/oneof_to_enum.js";
import { fixup_string_to_array } from "./fixups/string_to_array.js";
import { fixup_unit_cells } from "./fixups/unit_cells.js";
import { fixup_unit_suffix } from "./fixups/unit_suffix.js";
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
    property: [fixup_string_to_array, fixup_names, fixup_reg, fixup_unit_suffix, fixup_items_size, fixup_dt_type(types)],
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
 * - `fixup_matrix_rows` gives a matrix property (`reg`, `interrupts`, `clocks`) that doesn't describe its rows some.
 * - `fixup_unit_cells` gives the numbers of a unit property (`-ns`, `-hz`) the bounds of their type.
 */
export function apply_JSONSchema_fixups(binding: DtBindingSchema, types: PropertyTypes = NO_PROPERTY_TYPES): DtBindingSchema {

    const collapsed = fixup_collapse_allOf(binding);
    // A pass of its own: the walk fixes the branches of a `oneOf` before the property, and `string_to_array` would
    // turn each `const` into a list by then. dt-schema runs `_fixup_oneOf_to_enum` first on the property.
    const enumerated = apply_fixups(collapsed, { node: [], property: [fixup_oneof_to_enum] });
    const fixuped_properties = apply_fixups(enumerated, fixups(types));
    const fixuped_ifs = fixup_ifs(fixuped_properties);
    const fixuped_marked_integers = fixup_mark_integers(fixuped_ifs);
    // After the integers: the cells it adds are numbers only when they are, a label or a macro is not an integer
    const fixuped_matrix_rows = apply_fixups(fixuped_marked_integers, { node: [], property: [fixup_matrix_rows, fixup_unit_cells] });

    // dt-schema: `validator.py:process_schema`
    return { ...fixuped_matrix_rows, type: "object" } as DtBindingSchema;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const fixuped = (properties: Record<string, unknown>) =>
        (apply_JSONSchema_fixups({ $id: "id", $schema: "s", title: "t", maintainers: [], properties } as unknown as DtBindingSchema).properties as Record<string, Record<string, unknown>>);

    test("a property that is a oneOf of consts is an enum, a string one still a list of them", () => {
        const { compatible, "nvidia,pull": pull } = fixuped({
            compatible: { oneOf: [{ description: "ahci", const: "snps,dwc-ahci" }, { description: "spear", const: "snps,spear-ahci" }] },
            "nvidia,pull": { $ref: "/schemas/types.yaml#/definitions/uint32", oneOf: [{ description: "none", const: 0 }, { description: "down", const: 1 }] },
        });

        expect(compatible["oneOf"]).toBeUndefined();
        expect(compatible["items"]).toStrictEqual([{ enum: ["snps,dwc-ahci", "snps,spear-ahci"] }]);
        expect(pull["oneOf"]).toBeUndefined();
        expect(pull["enum"]).toStrictEqual([0, 1]);
    });
}
