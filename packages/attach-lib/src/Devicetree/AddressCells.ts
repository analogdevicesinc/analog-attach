import { PropertyBuilder } from "./build/PropertyBuilder.js";
import { has_property, number_property } from "./nodes/Access.js";
import type { DeviceTreeOverlay } from "./DeviceTreeOverlay.js";

export interface AddressCells {
    address: number;
    size: number;
}

export function address_cells_of(overlay: DeviceTreeOverlay, parent_path: string): AddressCells {
    const node = overlay.find_node(parent_path)?.node;
    const base_node = overlay.get_base_dts()?.node_at(parent_path);

    const overlay_addr = node === undefined ? undefined : number_property(node, "#address-cells");
    const overlay_size = node === undefined ? undefined : number_property(node, "#size-cells");
    const base_addr = base_node === undefined ? undefined : number_property(base_node, "#address-cells");
    const base_size = base_node === undefined ? undefined : number_property(base_node, "#size-cells");

    return {
        address: Number(overlay_addr ?? base_addr ?? 1n),
        size: Number(overlay_size ?? base_size ?? 0n),
    };
}

/**
 * Write the `#address-cells = <1>` / `#size-cells = <0>` that `address_cells_of`
 * assumes into the overlay-added node at `parent_path` when it lacks them.
 * Base nodes are left alone: new cells would change how the `reg` of their
 * existing children is read.
 */
export function ensure_address_cells(overlay: DeviceTreeOverlay, parent_path: string): void {
    if (overlay.get_base_dts()?.node_at(parent_path) !== undefined) { return; }
    const node = overlay.find_node(parent_path)?.node;
    if (node === undefined) { return; }

    const missing = ([["#address-cells", 1n], ["#size-cells", 0n]] as const)
        .filter(([name]) => !has_property(node, name));
    for (const [name, value] of missing) {
        node.properties.push(
            PropertyBuilder.build_cell_array().with_cells(value).with_name(name).build(),
        );
    }
}
