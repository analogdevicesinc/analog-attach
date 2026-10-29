import { is_enabled, missing_required, type DeviceTree, type DeviceTreeOverlay } from "attach-lib";

import type { NodeBinding } from "./binding-resolution";
import { property_info, value_suggestions, type PropertyInfo, type TargetBinding } from "./commands/list/suggest";
import type { Suggestion } from "./protocol/types";

/**
 * The required properties the node at `path` doesn't have yet, in the order
 * to set them (see the lib's `missing_required`). Properties the base tree
 * already sets on the node count as set. What the binding requires depends on
 * the node's data (an if/then branch can add to it), so the list is the one
 * after narrowing, the binding's unconditional one when that fails.
 */
export function node_missing_required(
    binding: Pick<NodeBinding, "required_properties" | "narrow_and_populate">,
    overlay: DeviceTreeOverlay,
    path: string,
): string[] {
    const node = overlay.effective_node(path);
    const required = (node === undefined ? undefined : binding.narrow_and_populate(node)?.required_properties) ?? binding.required_properties;
    return missing_required(required, node?.properties.map(p => p.name) ?? []);
}

export interface PropertyDetails {
    /** What the binding says; undefined without a binding or when it doesn't define the property. */
    info: PropertyInfo | undefined;
    suggestions: Suggestion[];
    /** For a phandle, the other nodes it could name (disabled, or enabled by the overlay): shown after the suggestions, never a default. */
    others: Suggestion[];
}

/** What `read` and the add interview show about a property of the target node. */
export function property_details(
    target: TargetBinding,
    overlay: DeviceTreeOverlay,
    base: DeviceTree,
    node_identifier: string,
    property_name: string,
): PropertyDetails {
    const { binding_node } = target.target;
    const info = "error" in target.binding || binding_node === undefined
        ? undefined
        : property_info(target.binding, binding_node, property_name);
    const values = value_suggestions(target, overlay, base, node_identifier, property_name);
    const known = info?.ok === true ? info.info : undefined;
    const suggestions = values.ok ? values.suggestions : [];
    return { info: known, suggestions, others: other_candidates(known?.phandle_options ?? [], suggestions, overlay) };
}

/**
 * The nodes a phandle property can name that the suggestions leave out, to list
 * after them. The suggestions take the enabled providers of the base with the
 * overlay applied, so for clocks, supplies and interrupt parents these are the
 * disabled ones; for other phandles, any node, marked by where it is enabled.
 */
export function other_candidates(options: string[], suggestions: Suggestion[], overlay: DeviceTreeOverlay): Suggestion[] {
    const suggested = new Set(suggestions.map(s => s.value.replace(/^&/, "")));
    const labels = overlay.all_labels();
    return options.flatMap(label => {
        const path = labels.get(label);
        const node = path === undefined ? undefined : overlay.effective_node(path);
        if (suggested.has(label) || node === undefined || path === undefined) { return []; }
        const base_node = overlay.get_base_dts()?.node_at(path);
        let note = "disabled";
        if (is_enabled(node)) { note = base_node !== undefined && is_enabled(base_node) ? "enabled" : "enabled by the overlay"; }
        return [{ value: label, display_string: `${label} (${note})`, note }];
    });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree, DeviceTreeOverlay: DTO } = await import("attach-lib");
    const cannot_narrow = (): undefined => { return; };
    const unnarrowed = (required_properties: string[]) => ({ required_properties, narrow_and_populate: cannot_narrow });

    test("other_candidates — the nodes a phandle can name that the suggestions leave out, marked by where they are enabled", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tgpio: gpio@7e200000 {\n\t};\n\tgicv2: interrupt-controller@40041000 {\n\t};\n\taon_intr: interrupt-controller@7ef00100 {\n\t\tstatus = "disabled";\n\t};\n\tl2_intr: interrupt-controller@7ef00200 {\n\t\tstatus = "disabled";\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&l2_intr {\n\tstatus = "okay";\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(other_candidates(["gpio", "gicv2", "aon_intr", "l2_intr", "nope"], [{ value: "gicv2" }, { value: "&gpio" }], overlay)).toEqual([
            { value: "aon_intr", display_string: "aon_intr (disabled)", note: "disabled" },
            { value: "l2_intr", display_string: "l2_intr (enabled by the overlay)", note: "enabled by the overlay" },
        ]);
        expect(other_candidates(["aon_intr"], [{ value: "aon_intr" }], overlay)).toEqual([]);
        expect(other_candidates(["gpio"], [], overlay)).toEqual([{ value: "gpio", display_string: "gpio (enabled)", note: "enabled" }]);
    });

    test("node_missing_required — base and overlay properties both count", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\tcompatible = "brcm,bcm2835-spi";\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\treg = <0x7e204000 0x200>;\n\tadc@0 {\n\t\tcompatible = "adi,ad7124-8";\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(node_missing_required(unnarrowed(["compatible", "reg", "clocks"]), overlay, "/soc/spi@7e204000")).toEqual(["clocks"]);
        expect(node_missing_required(unnarrowed(["compatible", "reg", "interrupts"]), overlay, "/soc/spi@7e204000/adc@0"))
            .toEqual(["reg", "interrupt-parent", "interrupts"]);
    });

    test("node_missing_required — the list after narrowing counts: an if/then branch can require more", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tspi0: spi@7e204000 {\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\tcompatible = "adi,ad5592r";\n\t\treg = <0>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const binding = {
            required_properties: ["compatible", "reg"],
            narrow_and_populate: () => ({ properties: [], required_properties: ["compatible", "reg", "spi-cpol"], errors: [] }),
        };
        expect(node_missing_required(binding, overlay, "/spi@7e204000/adc@0")).toEqual(["spi-cpol"]);
        // A binding that can't be narrowed keeps its own list.
        expect(node_missing_required({ ...binding, narrow_and_populate: cannot_narrow }, overlay, "/spi@7e204000/adc@0")).toEqual([]);
    });
}
