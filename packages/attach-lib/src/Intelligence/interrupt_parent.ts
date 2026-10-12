import { DeviceTree, DeviceTreeOverlay, type DTNode, number_property, reference_property, has_property, parent_path } from "../Devicetree/index.js";

export interface InterruptParentInfo {
    label?: string;
    path: string;
    from: string;
    interrupt_cells?: number;
}

export type NodeLookup = (path: string) => DTNode | undefined;

export function base_lookup(dt: DeviceTree): NodeLookup {
    return (path: string) => dt.node_at(path);
}

export function overlay_lookup(overlay: DeviceTreeOverlay): NodeLookup {
    const base_dt = overlay.get_base_dts();
    return (path: string) => {
        const found = overlay.find_node(path);
        if (found !== undefined) { return found.node; }
        return base_dt?.node_at(path);
    };
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

    let current = parent_path(node_path);
    if (current === undefined) { return undefined; }

    while (!visited.has(current)) {
        visited.add(current);

        const node = lookup(current);
        if (node === undefined) {
            current = parent_path(current) ?? "";
            if (current === "") { break; }
            continue;
        }

        if (has_property(node, "#interrupt-cells")) {
            const cells = number_property(node, "#interrupt-cells");
            const label = node.labels.at(-1);
            return {
                label,
                path: current,
                from: current,
                interrupt_cells: cells === undefined ? undefined : Number(cells),
            };
        }

        const parent_label = reference_property(node, "interrupt-parent");
        if (parent_label !== undefined && base_dt !== undefined) {
            const located = base_dt.locate(parent_label);
            if (located !== undefined) {
                const cells = number_property(located.node, "#interrupt-cells");
                const resolved_label = located.node.labels.at(-1);
                return {
                    label: resolved_label,
                    path: located.path,
                    from: current,
                    interrupt_cells: cells === undefined ? undefined : Number(cells),
                };
            }
        }

        current = parent_path(current) ?? "";
        if (current === "") { break; }
    }

    return undefined;
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
        // eslint-disable-next-line unicorn/consistent-function-scoping
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
