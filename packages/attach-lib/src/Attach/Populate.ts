import { ParsedBinding, ResolvedProperty } from "../Bindings/ParsedBinding.js";
import { DeviceTree, DTNode } from "../Devicetree/index.js";
import { IntelligenceStack } from "../Intelligence/layers/stack.js";
import { IntelligenceLayer, NodePlacement } from "../Intelligence/layers/types.js";
import { validator_input_json } from "./DTxBinding.js";

// Extra intelligence for populate_*: layers appended on top of the default
// binding + devicetree stack, and the node's placement for layers that need it.
export type PopulateOptions = {
    layers?: IntelligenceLayer[];
    placement?: NodePlacement;
    parent_name?: string;
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
    });
}

/** Pattern (child node) properties get the layers but not the node's placement: it is the parent's, not theirs. */
export function populate_binding(
    binding: ParsedBinding,
    devicetree: DeviceTree,
    data: string | DTNode,
    options?: PopulateOptions,
): ParsedBinding {
    const data_string = typeof data === 'string' ? data : validator_input_json(data, binding.properties);

    const pattern_options: PopulateOptions = { layers: options?.layers, parent_name: options?.parent_name };
    return {
        ...binding,
        properties: populate_properties(binding.properties, devicetree, data_string, options),
        pattern_properties: binding.pattern_properties?.map(pattern => ({
            ...pattern,
            properties: populate_properties(pattern.properties, devicetree, data_string, pattern_options),
        })),
    };
}

import { readFileSync as _readFileSync } from "node:fs";
import { parse_board_description as _parse_board_description } from "../Intelligence/board/parse.js";
import { board_layer as _board_layer } from "../Intelligence/board/layer.js";

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const readFileSync = _readFileSync;
    const parse_board_description = _parse_board_description;
    const board_layer = _board_layer;
    const PMD_RPI_INTZ_FIXTURE = readFileSync(new URL("../../test/fixtures/board/pmd-rpi-intz.yaml", import.meta.url), "utf8");
    const RPI_BASE_FIXTURE = readFileSync(new URL("../../test/fixtures/board/rpi-base.dts", import.meta.url), "utf8");

    test("populate_binding — pattern properties do not receive the parent placement", () => {
        const dt = DeviceTree.new_from_string(RPI_BASE_FIXTURE);
        if (typeof dt === "string") { throw new TypeError(dt); }
        const board = parse_board_description(PMD_RPI_INTZ_FIXTURE);
        if (typeof board === "string") { throw new TypeError(board); }
        const layer = board_layer(board);

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
}
