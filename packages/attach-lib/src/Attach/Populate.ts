import { ParsedBinding, ResolvedProperty, AttachEnumType } from "../Bindings/index.js";
import { DeviceTree, DTNode, type AddressCells } from "../Devicetree/index.js";
import { IntelligenceStack } from "../Intelligence/layers/stack.js";
import { IntelligenceLayer, NodePlacement } from "../Intelligence/layers/types.js";
import { own_cells } from "../Intelligence/reg.js";
import { node_data_json } from "./NodeData.js";

// Extra intelligence for populate_*: layers appended on top of the default
// binding + devicetree stack, and the node's placement for layers that need it.
export type PopulateOptions = {
    layers?: IntelligenceLayer[];
    placement?: NodePlacement;
    parent_name?: string;
    /** The cells the properties' `reg` is read with, when they aren't the parent's in the tree (`PropertyContext.parent_cells`). */
    parent_cells?: AddressCells;
};

export function populate_properties(
    properties: ResolvedProperty[],
    devicetree: DeviceTree,
    data: string,
    options?: PopulateOptions,
): ResolvedProperty[] {
    const stack = IntelligenceStack.default().with(...options?.layers ?? []);
    return stack.refine_properties(properties, {
        devicetree,
        data,
        ...(options?.parent_name === undefined ? {} : { parent_name: options.parent_name }),
        ...(options?.placement === undefined ? {} : { placement: options.placement }),
        ...(options?.parent_cells === undefined ? {} : { parent_cells: options.parent_cells }),
    });
}

/**
 * Pattern (child node) properties get the layers but not the node's placement: it is the parent's, not theirs. Their
 * `reg` is read with the node's own `#address-cells` / `#size-cells`.
 */
export function populate_binding(
    binding: ParsedBinding,
    devicetree: DeviceTree,
    data: string | DTNode,
    options?: PopulateOptions,
): ParsedBinding {
    const data_string = typeof data === 'string' ? data : node_data_json(data, binding.properties);

    const pattern_options: PopulateOptions = { layers: options?.layers, parent_name: options?.parent_name, parent_cells: own_cells(binding.properties, data_string) };
    return {
        ...binding,
        properties: populate_properties(binding.properties, devicetree, data_string, options),
        pattern_properties: binding.pattern_properties?.map(pattern => ({
            ...pattern,
            properties: populate_properties(pattern.properties, devicetree, data_string, pattern_options),
        })),
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("populate_binding — pattern properties do not receive the parent placement", () => {
        const dt = DeviceTree.new_from_string("/dts-v1/;\n/ {\n};\n");
        if (typeof dt === "string") { throw new TypeError(dt); }
        // Suggests the placement's reg for `reg`, and nothing without a placement.
        const layer: IntelligenceLayer = {
            name: "placement",
            refine_properties: (properties, context) => properties.map(property =>
                property.key === "reg" && context.placement?.reg !== undefined
                    ? { ...property, suggestions: [{ rows: [[context.placement.reg]], display: "reg", source: "placement" }] }
                    : property),
        };

        const reg_property: ResolvedProperty = { key: "reg", value: { _t: "scalar", cell: { _t: "number" } } };
        const binding: ParsedBinding = {
            required_properties: ["reg"],
            properties: [reg_property],
            pattern_properties: [{
                pattern: "^channel@",
                description: "ADC channel",
                properties: [{ key: "reg", value: { _t: "scalar", cell: { _t: "number" } } }],
                required: ["reg"],
            }],
            examples: [],
        };

        const placement: NodePlacement = {
            node_path: "/soc/spi@7e204000/dev@0",
            parent_path: "/soc/spi@7e204000",
            reg: 0n,
            siblings: [],
        };

        const populated = populate_binding(binding, dt, "{}", { layers: [layer], placement });

        const top_reg = populated.properties.find(p => p.key === "reg");
        expect(top_reg?.suggestions?.length).toBeGreaterThan(0);

        const pattern_reg = populated.pattern_properties?.[0]?.properties.find(p => p.key === "reg");
        expect(pattern_reg?.suggestions ?? []).toStrictEqual([]);
    });

    test("populate_binding — a pattern's reg is read with the node's own cells, not its parent's", () => {
        const dt = DeviceTree.new_from_string("/dts-v1/;\n/ {\n\tsoc {\n\t\t#address-cells = <2>;\n\t\t#size-cells = <2>;\n\t};\n};\n");
        if (typeof dt === "string") { throw new TypeError(dt); }
        const pinned = (key: string, value: bigint): ResolvedProperty => ({ key, value: { _t: "scalar", cell: { _t: "enum", enum: [value], enum_type: AttachEnumType.NUMBER }, default: value } });
        const open_reg: ResolvedProperty = { key: "reg", value: { _t: "matrix", rows: [{ _t: "list", item: { _t: "any" } }] } };
        const binding: ParsedBinding = {
            required_properties: [],
            properties: [open_reg, pinned("#address-cells", 1n), pinned("#size-cells", 1n)],
            pattern_properties: [{ pattern: "^region@", description: "", properties: [open_reg], required: [] }],
            examples: [],
        };

        const populated = populate_binding(binding, dt, "{}", { parent_name: "soc" });
        const cells = (value: ResolvedProperty["value"] | undefined) => value?._t === "matrix" ? value.rows[0]?.maxItems : undefined;
        expect(cells(populated.properties.find(p => p.key === "reg")?.value)).toBe(4);
        expect(cells(populated.pattern_properties?.[0]?.properties.find(p => p.key === "reg")?.value)).toBe(2);
    });
}
