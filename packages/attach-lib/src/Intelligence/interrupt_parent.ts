import { DeviceTree, DeviceTreeOverlay, type DTNode, is_dt_flag } from "../Devicetree/index.js";
import { cell_extract_first_value } from "./query.js";

export interface InterruptParentInfo {
    label?: string;
    path: string;
    from: string;
    interrupt_cells?: number;
}

export type NodeLookup = (path: string) => DTNode | undefined;

export function base_lookup(dt: DeviceTree): NodeLookup {
    return (path: string) => {
        const reference = dt.get_node_by_path({ kind: "path", labels: [], path });
        return reference === undefined ? undefined : dt.deref_node(reference);
    };
}

export function overlay_lookup(overlay: DeviceTreeOverlay): NodeLookup {
    const base_dt = overlay.get_base_dts();
    return (path: string) => {
        const found = overlay.find_node({ kind: "path", labels: [], path });
        if (found !== undefined) { return found.node; }
        if (base_dt === undefined) { return undefined; }
        const reference = base_dt.get_node_by_path({ kind: "path", labels: [], path });
        return reference === undefined ? undefined : base_dt.deref_node(reference);
    };
}

function get_number_property(node: DTNode, name: string): bigint | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return undefined; }
    const value = cell_extract_first_value(property);
    return typeof value === "bigint" ? value : undefined;
}

function get_label_property(node: DTNode, name: string): string | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return undefined; }
    const value = cell_extract_first_value(property);
    return typeof value === "string" ? value : undefined;
}

/**
 * Find the effective interrupt parent of a node by walking up the tree,
 * following Linux's `of_irq_find_parent` logic:
 * - If a node has `#interrupt-cells`, it is an interrupt parent
 * - If a node has `interrupt-parent`, follow that reference
 * - Otherwise, go up one level
 *
 * The lookup merges base and overlay so overlay patches win.
 */
export function effective_interrupt_parent(
    lookup: NodeLookup,
    node_path: string,
    base_dt?: DeviceTree,
): InterruptParentInfo | undefined {
    const visited = new Set<string>();

    let path = parent_of(node_path);
    if (path === undefined) { return undefined; }

    while (!visited.has(path)) {
        visited.add(path);

        const node = lookup(path);
        if (node === undefined) {
            path = parent_of(path) ?? "";
            if (path === "") { break; }
            continue;
        }

        if (node.properties.some(p => p.name === "#interrupt-cells")) {
            const cells = get_number_property(node, "#interrupt-cells");
            const label = node.labels.at(-1);
            return {
                label,
                path,
                from: path,
                interrupt_cells: cells !== undefined ? Number(cells) : undefined,
            };
        }

        const parent_label = get_label_property(node, "interrupt-parent");
        if (parent_label !== undefined && base_dt !== undefined) {
            const reference = base_dt.get_node_by_label({ kind: "label", labels: [], name: parent_label });
            if (reference !== undefined) {
                const parent_node = base_dt.deref_node(reference);
                if (parent_node !== undefined) {
                    const cells = get_number_property(parent_node, "#interrupt-cells");
                    const resolved_label = parent_node.labels.at(-1);
                    return {
                        label: resolved_label,
                        path: reference.full_path.path,
                        from: path,
                        interrupt_cells: cells !== undefined ? Number(cells) : undefined,
                    };
                }
            }
        }

        path = parent_of(path) ?? "";
        if (path === "") { break; }
    }

    return undefined;
}

function parent_of(path: string): string | undefined {
    if (path === "/" || path === "") { return undefined; }
    const last = path.lastIndexOf("/");
    return last <= 0 ? "/" : path.slice(0, last);
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_dts = `/dts-v1/;
/ {
    interrupt-parent = <&gicv2>;
    #address-cells = <2>;
    #size-cells = <1>;

    gicv2: interrupt-controller@ff841000 {
        interrupt-controller;
        #interrupt-cells = <3>;
    };

    soc {
        gpio: gpio@7e200000 {
            interrupt-controller;
            #interrupt-cells = <2>;
        };

        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`;

    const dt = DeviceTree.new_from_string(base_dts);
    if (typeof dt === "string") { throw new TypeError(dt); }
    const lookup = base_lookup(dt);

    test("effective_interrupt_parent — inherited from root", () => {
        const result = effective_interrupt_parent(lookup, "/soc/spi@7e204000/my_adc", dt);
        expect(result).toBeDefined();
        expect(result!.label).toBe("gicv2");
        expect(result!.from).toBe("/");
        expect(result!.interrupt_cells).toBe(3);
    });

    test("effective_interrupt_parent — soc node with no interrupt-parent inherits from root", () => {
        const result = effective_interrupt_parent(lookup, "/soc/gpio@7e200000", dt);
        expect(result).toBeDefined();
        expect(result!.label).toBe("gicv2");
    });

    test("effective_interrupt_parent — nothing inherited at root", () => {
        const result = effective_interrupt_parent(lookup, "/", dt);
        expect(result).toBeUndefined();
    });

    test("effective_interrupt_parent — intermediate ancestor with #interrupt-cells is the parent", () => {
        const result = effective_interrupt_parent(lookup, "/soc/gpio@7e200000/child", dt);
        expect(result).toBeDefined();
        expect(result!.label).toBe("gpio");
        expect(result!.interrupt_cells).toBe(2);
    });

    test("effective_interrupt_parent — overlay patch wins", () => {
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;
&spi0 {
    interrupt-parent = <&gpio>;
    adc@0 {
        reg = <0>;
    };
};`, dt);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const ol = overlay_lookup(overlay);
        const result = effective_interrupt_parent(ol, "/soc/spi@7e204000/adc@0", dt);
        expect(result).toBeDefined();
        expect(result!.label).toBe("gpio");
        expect(result!.interrupt_cells).toBe(2);
    });

    test("effective_interrupt_parent — loop terminates", () => {
        const looped_lookup: NodeLookup = (path) => {
            if (path === "/a") {
                return {
                    name: "a", unit_addr: undefined,
                    properties: [{ name: "interrupt-parent", value: [{ kind: "array" as const, elements: [{ kind: "label" as const, name: "fake", labels: [] }], labels: [], bit_width: 32 }], labels: [] }],
                    children: [], labels: [],
                };
            }
            return lookup(path);
        };
        const result = effective_interrupt_parent(looped_lookup, "/a/child");
        expect(result).toBeUndefined();
    });
}
