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

/**
 * The interrupt parent of the node at `node_path`, as Linux's `of_irq_find_parent` finds it: the node's own
 * `interrupt-parent`, else up from its parent, the first ancestor with `#interrupt-cells` (an interrupt controller
 * isn't its own parent), or the node an ancestor's `interrupt-parent` names. `from` is the node that gave it. A label
 * resolves in `dt`, the tree `lookup` reads: for an overlay, `base_lookup(overlay.merged_tree())` and that tree, so
 * every fragment counts.
 */
export function effective_interrupt_parent(
    lookup: NodeLookup,
    node_path: string,
    dt?: DeviceTree,
): InterruptParentInfo | undefined {
    const named = (path: string, node: DTNode): InterruptParentInfo | undefined => {
        const parent_label = reference_property(node, "interrupt-parent");
        const located = parent_label === undefined ? undefined : dt?.locate(parent_label);
        if (located === undefined) { return undefined; }
        const cells = number_property(located.node, "#interrupt-cells");
        return {
            label: located.node.labels.at(-1),
            path: located.path,
            from: path,
            interrupt_cells: cells === undefined ? undefined : Number(cells),
        };
    };

    const own = lookup(node_path);
    const from_own = own === undefined ? undefined : named(node_path, own);
    if (from_own !== undefined) { return from_own; }

    const visited = new Set<string>();
    let current = parent_path(node_path);
    if (current === undefined) { return undefined; }

    while (!visited.has(current)) {
        visited.add(current);

        const node = lookup(current);
        if (node !== undefined) {
            if (has_property(node, "#interrupt-cells")) {
                const cells = number_property(node, "#interrupt-cells");
                return {
                    label: node.labels.at(-1),
                    path: current,
                    from: current,
                    interrupt_cells: cells === undefined ? undefined : Number(cells),
                };
            }
            const from_ancestor = named(current, node);
            if (from_ancestor !== undefined) { return from_ancestor; }
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

    test("effective_interrupt_parent — the root has only its own interrupt-parent", () => {
        expect(effective_interrupt_parent(lookup, "/", dt)).toMatchObject({ label: "gicv2", from: "/" });
        const bare = DeviceTree.new_from_string("/dts-v1/;\n/ { gic: gic { #interrupt-cells = <3>; }; };");
        if (typeof bare === "string") { throw new TypeError(bare); }
        expect(effective_interrupt_parent(base_lookup(bare), "/", bare)).toBeUndefined();
    });

    test("effective_interrupt_parent — intermediate ancestor with #interrupt-cells is the parent", () => {
        const result = effective_interrupt_parent(lookup, "/soc/gpio@7e200000/child", dt);
        expect(result).toBeDefined();
        expect(result!.label).toBe("gpio");
        expect(result!.interrupt_cells).toBe(2);
    });

    test("effective_interrupt_parent — a node's own interrupt-parent is its parent", () => {
        const own = DeviceTree.new_from_string(base_dts.replace("spi0: spi@7e204000 {", "hdmi: hdmi { interrupt-parent = <&gpio>; };\n        spi0: spi@7e204000 {"));
        if (typeof own === "string") { throw new TypeError(own); }
        const result = effective_interrupt_parent(base_lookup(own), "/soc/hdmi", own);
        expect(result).toMatchObject({ label: "gpio", from: "/soc/hdmi", interrupt_cells: 2 });
    });

    test("effective_interrupt_parent — an ancestor's interrupt-parent a later fragment sets, through the merged tree", () => {
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;
&spi0 {
    adc@0 {
        reg = <0>;
    };
};
&spi0 {
    interrupt-parent = <&gpio>;
};`, dt);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const merged = overlay.merged_tree();
        if (merged === undefined) { throw new TypeError("no merged tree"); }
        const result = effective_interrupt_parent(base_lookup(merged), "/soc/spi@7e204000/adc@0", merged);
        expect(result).toMatchObject({ label: "gpio", from: "/soc/spi@7e204000", interrupt_cells: 2 });
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
