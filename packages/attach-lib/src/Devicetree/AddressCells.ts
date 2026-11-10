import { PropertyBuilder } from "./build/PropertyBuilder.js";
import { has_property, number_property } from "./nodes/Access.js";
import type { DeviceTreeOverlay } from "./DeviceTreeOverlay.js";
import type { DTNode } from "./syntax/AST.js";

export interface AddressCells {
    address: number;
    size: number;
}

/**
 * The `#address-cells` / `#size-cells` of the node at `parent_path` (a path, or a label): the overlay's, over all its
 * fragments for the node (a later one's wins, as in dtc), else the base's, else 1 and 0.
 */
export function address_cells_of(overlay: DeviceTreeOverlay, parent_path: string): AddressCells {
    const base = overlay.get_base_dts();
    const path = parent_path.startsWith("/")
        ? parent_path
        : overlay.find_node(parent_path)?.node_path ?? base?.locate(parent_path)?.path ?? parent_path;
    // The overlay's properties before the base's: `number_property` reads the first of a name
    const node: DTNode = {
        name: "",
        unit_addr: undefined,
        labels: [],
        properties: [...overlay.overlay_properties(path), ...(base?.node_at(path)?.properties ?? [])],
        children: [],
    };

    return {
        address: Number(number_property(node, "#address-cells") ?? 1n),
        size: Number(number_property(node, "#size-cells") ?? 0n),
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
