import { DtBindingSchema, Schema } from "../schema/Schema.js";
import { fixup_branch_counts } from "./branch_counts.js";
import { fixup_collapse_allOf } from "./collapse_allOf.js";
import { fixup_dt_type } from "./dt_type.js";
import { fixup_interrupts } from "./interrupts.js";
import { fixup_items_size } from "./items_size.js";
import { fixup_ifs } from "./mark_ifs_required_properties.js";
import { fixup_mark_integers } from "./mark_integers.js";
import { fixup_matrix_rows } from "./matrix_rows.js";
import { fixup_names } from "./names.js";
import { fixup_node_properties } from "./node_properties.js";
import { fixup_oneof_to_enum } from "./oneof_to_enum.js";
import { fixup_one_form } from "./one_form.js";
import { fixup_string_to_array } from "./string_to_array.js";
import { fixup_unit_cells } from "./unit_cells.js";
import { fixup_unit_suffix } from "./unit_suffix.js";
import { fixup_reg } from "./reg.js";
import { apply_fixups, NodeFixup, PropertyFixup } from "./Walker.js";
import { NO_PROPERTY_TYPES, PropertyTypes } from "../schema/PropertyTypes.js";
import { fixup_remove_invalid_keys } from "./remove_invalid_keys.js";
import type { PipelineTracer } from "../Trace.js";
import { isDeepStrictEqual } from "node:util";

/** What a step of the pipeline is, for showing it: an id, what it does, and what it ports from dt-schema (none if ours). */
export type StepInfo = {
    id: string;
    summary: string;
    counterpart?: string;
};

export type Named<F> = StepInfo & { fixup: F };

/**
 * A pass over the whole binding: either a function of it, or a walk applying node and property fixups to each node
 * schema and property (`Walker.ts`), in the order given.
 */
export type FixupPass = StepInfo & (
    | { kind: "binding"; run: (binding: DtBindingSchema) => DtBindingSchema }
    | { kind: "walk"; node: Named<NodeFixup>[]; property: Named<PropertyFixup>[] }
);

/**
 * The fixup passes, in the order they run. The walks are dt-schema's `fixups.py`; the passes around them are ours.
 * dt-schema has nothing like those because it keeps the `$ref`s to `types.yaml` and gets what a property is (an
 * integer, a matrix, a phandle array) from there (`validator.py:_extract_prop_type`); we dereference, and have to
 * guess it from the shape.
 */
export const fixup_passes = (types: PropertyTypes): FixupPass[] => [
    {
        id: "collapse_allOf", kind: "binding", run: fixup_collapse_allOf,
        summary: "Flattens the `allOf` the dereferencing leaves in a property into one schema.",
    },
    {
        // A pass of its own: the walk fixes the branches of a `oneOf` before the property, and `string_to_array` would
        // turn each `const` into a list by then. dt-schema runs `_fixup_oneOf_to_enum` first on the property.
        id: "oneof_to_enum", kind: "walk", node: [],
        summary: "A walk of its own, before the others turn each `const` of a `oneOf` into a list.",
        property: [{
            id: "oneof_to_enum", fixup: fixup_oneof_to_enum, counterpart: "fixups.py:_fixup_oneOf_to_enum",
            summary: "A `oneOf` / `anyOf` of nothing but `const`s is an `enum`.",
        }],
    },
    {
        id: "walk", kind: "walk",
        summary: "The fixups of each node schema and property, as dt-schema's `fixups.py:fixup_sub_schema` walks them.",
        node: [
            {
                id: "remove_invalid_keys", fixup: fixup_remove_invalid_keys, counterpart: "fixups.py:fixup_schema",
                summary: "Drops what validation doesn't need (`maintainers`, `$schema`, `select`) from every node schema.",
            },
            {
                id: "interrupts", fixup: fixup_interrupts, counterpart: "fixups.py:fixup_interrupts",
                summary: "A node with `interrupts` can have an `interrupt-parent`, one phandle.",
            },
            {
                id: "node_properties", fixup: fixup_node_properties, counterpart: "fixups.py:fixup_node_props",
                summary: "A node that forbids the properties it doesn't name still has `pinctrl-names` and `pinctrl-N` (`true`).",
            },
        ],
        // `one_form` first, so the others see the form; `branch_counts` after `items_size`, which has sized the
        // branches by then; `names` after `items_size`: dt-core's `minItems: 1` is a schema of its own in dt-schema,
        // and doesn't keep `items: [a, b]` from fixing the count to two.
        property: [
            {
                id: "one_form", fixup: fixup_one_form,
                summary: "A property a `oneOf` / `anyOf` gives several forms of is the one to write: the one not deprecated, the flag rather than the number.",
            },
            {
                id: "string_to_array", fixup: fixup_string_to_array, counterpart: "fixups.py:_fixup_string_to_array",
                summary: "A string property is a list of strings: `{enum: [a, b]}` constrains its first item.",
            },
            {
                id: "reg", fixup: fixup_reg, counterpart: "fixups.py:_fixup_reg_schema",
                summary: "A `reg` whose values are bounded as numbers is a one-cell entry with those bounds.",
            },
            {
                id: "unit_suffix", fixup: fixup_unit_suffix, counterpart: "fixups.py:_fixup_unit_suffix_props",
                summary: "A property with a unit suffix (`-ns`, `-hz`) is a list or a matrix of numbers; its constraints move to where that type has them.",
            },
            {
                id: "items_size", fixup: fixup_items_size, counterpart: "fixups.py:_fixup_items_size",
                summary: "An array gets its type, and a fixed count when its `items` is a list or only one of `minItems` / `maxItems` is given.",
            },
            {
                id: "branch_counts", fixup: fixup_branch_counts,
                summary: "A property is bounded by what all the branches of its `oneOf` / `anyOf` keep to.",
            },
            {
                id: "names", fixup: fixup_names, counterpart: "schemas/dt-core.yaml",
                summary: "A `-names` property is a list of strings, at least one.",
            },
            {
                id: "dt_type", fixup: fixup_dt_type(types), counterpart: "validator.py:property_get_type",
                summary: "A property that doesn't say its type gets the one dt-schema gives its name (`reg` an address, `-gpios` a phandle-array).",
            },
        ],
    },
    {
        id: "ifs", kind: "binding", run: fixup_ifs,
        summary: "An `allOf` branch's `if` requires the properties it tests, so that a condition whose properties are absent doesn't match.",
    },
    {
        id: "mark_integers", kind: "binding", run: fixup_mark_integers, counterpart: "lib.py:_is_int_schema",
        summary: "A schema with `minimum` / `maximum` is an integer.",
    },
    {
        // After the integers: the cells it adds are numbers only when they are, a label or a macro is not an integer
        id: "cells", kind: "walk", node: [],
        summary: "After `mark_integers`: the cells these add can be labels or macros, not integers.",
        property: [
            {
                id: "matrix_rows", fixup: fixup_matrix_rows,
                summary: "A matrix property (`reg`, `interrupts`, `clocks`) that doesn't describe its rows gets them, each an array.",
            },
            {
                id: "unit_cells", fixup: fixup_unit_cells,
                summary: "The numbers of a unit property get the bounds of the type its suffix gives.",
            },
        ],
    },
    {
        id: "object", kind: "binding", counterpart: "validator.py:process_schema",
        run: binding => ({ ...binding, type: "object" }) as DtBindingSchema,
        summary: "The binding is an object schema.",
    },
];

/** Reports what a fixup changed, if anything. Each changes its schema in place, so `before` is a copy taken first. */
function report(trace: PipelineTracer, pass: string, fixup: string, target: "property" | "node", pointer: string[], before: unknown, after: unknown, name?: string): void {
    if (isDeepStrictEqual(before, after)) { return; }
    trace({ kind: "fixup", pass, fixup, target, pointer, ...(name === undefined ? {} : { name }), before, after: structuredClone(after) });
}

function traced_property(trace: PipelineTracer, pass: string, { id, fixup }: Named<PropertyFixup>): PropertyFixup {
    return (schema, context) => {
        const before = structuredClone(schema);
        const after = fixup(schema, context);
        report(trace, pass, id, "property", context.pointer ?? context.path, before, after, context.name);
        return after;
    };
}

function traced_node(trace: PipelineTracer, pass: string, { id, fixup }: Named<NodeFixup>): NodeFixup {
    return (schema, path, pointer) => {
        const before = structuredClone(schema);
        fixup(schema, path, pointer);
        report(trace, pass, id, "node", pointer ?? path, before, schema);
    };
}

function run_pass(binding: DtBindingSchema, pass: FixupPass, trace?: PipelineTracer): DtBindingSchema {
    if (pass.kind === "binding") { return pass.run(binding); }

    return apply_fixups(binding, trace === undefined
        ? { node: pass.node.map(named => named.fixup), property: pass.property.map(named => named.fixup) }
        : { node: pass.node.map(named => traced_node(trace, pass.id, named)), property: pass.property.map(named => traced_property(trace, pass.id, named)) });
}

/** Runs the fixup passes over a binding (`fixup_passes`), reporting each pass and what each fixup of a walk changed to `trace`. */
export function apply_JSONSchema_fixups(binding: DtBindingSchema, types: PropertyTypes = NO_PROPERTY_TYPES, trace?: PipelineTracer): DtBindingSchema {
    let fixuped = binding;
    for (const pass of fixup_passes(types)) {
        fixuped = run_pass(fixuped, pass, trace);
        trace?.({ kind: "pass", pass: pass.id, schema: structuredClone(fixuped) });
    }
    return fixuped;
}

if (import.meta.vitest) {

    const { test, expect } = import.meta.vitest;

    const fixuped = (properties: Schema) =>
        (apply_JSONSchema_fixups({ $id: "id", $schema: "s", title: "t", maintainers: [], properties } as unknown as DtBindingSchema).properties as Record<string, Schema>);
    const bounds = (schema: Schema | undefined) => [schema?.["minItems"], schema?.["maxItems"]];

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

    test("the count a property gives is its own, not the minItems: 1 dt-core gives every -names", () => {
        const properties = fixuped({
            "clock-names": { items: [{ const: "a" }, { const: "b" }] },
            "dma-names": { items: [{ const: "rx" }, { const: "tx" }], minItems: 1 },
            "reset-names": { description: "d" },
        });

        expect(bounds(properties["clock-names"])).toStrictEqual([2, 2]);
        expect(bounds(properties["dma-names"])).toStrictEqual([1, 2]);
        expect(bounds(properties["reset-names"])).toStrictEqual([1, undefined]);
    });

    test("a property whose counts only its oneOf branches give is bounded by them, once the branches are sized", () => {
        // adi,axi-clkgen.yaml's `clock-names`, and panel-timing.yaml's porches: one value, or min, typical and max
        const properties = fixuped({
            "clock-names": { oneOf: [{ items: [{ const: "clkin1" }, { const: "s_axi_aclk" }] }, { items: [{ const: "clkin1" }, { const: "clkin2" }, { const: "s_axi_aclk" }] }] },
            "hback-porch": { $ref: "/schemas/types.yaml#/definitions/uint32-array", oneOf: [{ maxItems: 1, items: { description: "typical" } }, { minItems: 3, maxItems: 3 }] },
        });
        expect(bounds(properties["clock-names"])).toStrictEqual([2, 3]);
        expect(bounds(properties["hback-porch"])).toStrictEqual([undefined, 3]);
    });

    test("an integer array's own minimum bounds its values and leaves it an array", () => {
        // adi,adl5960.yaml's `lo_in-clock-scales: {$ref: uint32-array, minimum: 1}`, dereferenced
        const uint32 = { type: "integer", typeSize: 32, minimum: 0, maximum: 0xFF_FF_FF_FF, dtType: "uint32" };
        const { "lo_in-clock-scales": scales } = fixuped({
            "lo_in-clock-scales": { type: "array", minItems: 1, items: uint32, dtType: "uint32-array", minimum: 1 },
        });
        expect(scales?.["type"]).toBe("array");
        expect(scales?.["items"]).toStrictEqual({ ...uint32, minimum: 1 });
    });

    test("a property of several forms is the one to write: fixed-link the node, bias-pull-up the flag", () => {
        const uint32 = { type: "integer", typeSize: 32, minimum: 0, maximum: 0xFF_FF_FF_FF, dtType: "uint32" };
        const { "fixed-link": link, "bias-pull-up": pull } = fixuped({
            "fixed-link": { oneOf: [
                { type: "array", dtType: "uint32-array", deprecated: true, items: [{ minimum: 0, maximum: 31 }, { enum: [0, 1] }] },
                { type: "object", properties: { speed: { ...uint32, enum: [10, 100] } } },
            ] },
            "bias-pull-up": { oneOf: [{ type: "boolean" }, uint32], description: "pull up the pin" },
        });
        expect(link?.["type"]).toBe("object");
        expect(link?.["oneOf"]).toBeUndefined();
        expect(pull).toStrictEqual({ type: "boolean", description: "pull up the pin" });
    });
}
