import {
    DeviceTree,
    DeviceTreeOverlay,
    DTLabel,
    DTNode,
    DTPath,
    get_full_node_name,
    is_dt_flag,
} from "../../Devicetree/index.js";
import { cell_extract_first_value } from "../query.js";
import { NodePlacement } from "./types.js";

function first_reg(node: DTNode): bigint | undefined {
    const reg = node.properties.find(p => p.name === "reg");
    if (reg === undefined) { return; }
    const value = cell_extract_first_value(reg);
    return typeof value === "bigint" ? value : undefined;
}

function status_of(node: DTNode): string | undefined {
    const status = node.properties.find(p => p.name === "status");
    if (status === undefined || is_dt_flag(status.value)) { return; }
    const first = status.value[0];
    return first?.kind === "string" ? first.value : undefined;
}

function parent_path_of(node_path: string): string {
    const last_slash = node_path.lastIndexOf("/");
    return last_slash <= 0 ? "/" : node_path.slice(0, last_slash);
}

function base_node_at(base: DeviceTree | undefined, path: string): DTNode | undefined {
    if (base === undefined) { return; }
    const reference = base.get_node_by_path({ kind: "path", labels: [], path });
    return reference === undefined ? undefined : base.deref_node(reference);
}

function resolve_in_base(base: DeviceTree | undefined, target: DTLabel | DTPath): { node: DTNode, path: string } | undefined {
    if (base === undefined) { return; }
    const reference = target.kind === "path" ? base.get_node_by_path(target) : base.get_node_by_label(target);
    if (reference === undefined) { return; }
    const node = base.deref_node(reference);
    return node === undefined ? undefined : { node, path: reference.full_path.path };
}

/**
 * Locate `target` in the overlay (falling back to the base tree) and describe
 * its position: parent path, own `reg`, and the enabled siblings that occupy
 * the parent's address space. Overlay children override base children of the
 * same name, and `status = "disabled"` nodes are not counted as siblings.
 *
 * All overlay fragments are walked so that sibling patches in separate
 * fragments (e.g. a `target = <&spidev0>` that disables a base sibling, or a
 * second `&spi0` fragment that adds a device) are accounted for.
 */
export function placement_from_overlay(overlay: DeviceTreeOverlay, target: DTLabel | DTPath): NodePlacement | undefined {
    const base = overlay.get_base_dts();

    const found = overlay.find_node(target);
    const located = found === undefined
        ? resolve_in_base(base, target)
        : { node: found.node, path: found.node_path };
    if (located === undefined) { return; }

    const node_path = located.path;
    const parent_path = parent_path_of(node_path);
    const own_name = node_path.slice(node_path.lastIndexOf("/") + 1);

    const children = new Map<string, DTNode>();
    for (const child of base_node_at(base, parent_path)?.children ?? []) {
        children.set(get_full_node_name(child), child);
    }

    for (const fragment of overlay.get_fragments()) {
        const overlay_node = fragment.children.find(c => c.name === "__overlay__");
        if (overlay_node === undefined) { continue; }

        const root = overlay.get_fragment_root_path(fragment);
        if (root === undefined) { continue; }

        if (root === parent_path) {
            // Fragment targets the parent → every child of __overlay__ is a child patch
            for (const child of overlay_node.children) {
                const child_name = get_full_node_name(child);
                const base_child = children.get(child_name);
                children.set(child_name, base_child === undefined
                    ? child
                    : { ...base_child, properties: [...base_child.properties.filter(p => !child.properties.some(o => o.name === p.name)), ...child.properties] });
            }
        } else if (parent_path.startsWith(root + "/") || root === "/" && parent_path.startsWith("/")) {
            // Fragment targets an ancestor → descend __overlay__ along the relative segments
            const relative = root === "/" ? parent_path.slice(1) : parent_path.slice(root.length + 1);
            const segments = relative.split("/");
            let cursor: DTNode | undefined = overlay_node;
            for (const segment of segments) {
                if (cursor === undefined) { break; }
                cursor = cursor.children.find(c => get_full_node_name(c) === segment);
            }
            if (cursor !== undefined) {
                for (const child of cursor.children) {
                    const child_name = get_full_node_name(child);
                    const base_child = children.get(child_name);
                    children.set(child_name, base_child === undefined
                        ? child
                        : { ...base_child, properties: [...base_child.properties.filter(p => !child.properties.some(o => o.name === p.name)), ...child.properties] });
                }
            }
        } else if (parent_path_of(root) === parent_path) {
            // Fragment targets a sibling directly → __overlay__'s properties patch that child
            const sibling_name = root.slice(root.lastIndexOf("/") + 1);
            const base_child = children.get(sibling_name);
            if (base_child !== undefined) {
                children.set(sibling_name, {
                    ...base_child,
                    properties: [...base_child.properties.filter(p => !overlay_node.properties.some(o => o.name === p.name)), ...overlay_node.properties],
                });
            } else {
                children.set(sibling_name, overlay_node);
            }
        }
    }

    const siblings = [...children.entries()]
        .filter(([name, child]) => name !== own_name && status_of(child) !== "disabled")
        .map(([name, child]) => {
            const reg = first_reg(child);
            return reg === undefined ? { name } : { name, reg };
        });

    const reg = first_reg(located.node) ?? (found === undefined ? undefined : first_reg_from_base(base, node_path));
    return reg === undefined
        ? { node_path, parent_path, siblings }
        : { node_path, parent_path, reg, siblings };
}

function first_reg_from_base(base: DeviceTree | undefined, path: string): bigint | undefined {
    const node = base_node_at(base, path);
    return node === undefined ? undefined : first_reg(node);
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
            spidev0: spidev@0 {
                compatible = "spidev";
                reg = <0>;
            };
            spidev1: spidev@1 {
                compatible = "spidev";
                reg = <1>;
            };
        };
    };
};`);
    if (typeof base === "string") { throw new TypeError(base); }

    const overlay_of = (source: string) => {
        const overlay = DeviceTreeOverlay.new_from_string(source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };

    test("placement_from_overlay — overlay node under a base bus sees base and overlay siblings", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;
&spi0 {
    adc: adc@2 {
        compatible = "adi,ad7124-8";
        reg = <2>;
    };
    dac@3 {
        reg = <3>;
    };
};`);
        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "adc" });
        expect(placement?.node_path).toBe("/soc/spi@7e204000/adc@2");
        expect(placement?.parent_path).toBe("/soc/spi@7e204000");
        expect(placement?.reg).toBe(2n);
        expect(placement?.siblings).toStrictEqual([
            { name: "spidev@0", reg: 0n },
            { name: "spidev@1", reg: 1n },
            { name: "dac@3", reg: 3n },
        ]);
    });

    test("placement_from_overlay — base siblings disabled by the overlay are ignored", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;
&spi0 {
    spidev@0 {
        status = "disabled";
    };
    adc: adc@0 {
        reg = <0>;
    };
};`);
        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "adc" });
        expect(placement?.siblings).toStrictEqual([{ name: "spidev@1", reg: 1n }]);
    });

    test("placement_from_overlay — falls back to the base tree for nodes the overlay does not touch", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;
/ { };`);
        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "spi0" });
        expect(placement?.node_path).toBe("/soc/spi@7e204000");
        expect(placement?.parent_path).toBe("/soc");
        expect(placement?.reg).toBeUndefined();
    });

    test("placement_from_overlay — unknown targets yield undefined", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;
/ { };`);
        expect(placement_from_overlay(overlay, { kind: "label", labels: [], name: "nope" })).toBeUndefined();
    });

    test("placement_from_overlay — sibling disabled via a separate target=<&spidev0> fragment is excluded", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;

/ {
    fragment@0 {
        target = <&spi0>;
        __overlay__ {
            adc: adc@0 {
                reg = <0>;
            };
        };
    };

    fragment@1 {
        target = <&spidev0>;
        __overlay__ {
            status = "disabled";
        };
    };
};`);
        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "adc" });
        expect(placement?.siblings.map(s => s.name)).not.toContain("spidev@0");
        expect(placement?.siblings.map(s => s.name)).toContain("spidev@1");
    });

    test("placement_from_overlay — device in a second &spi0 fragment is counted", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;

/ {
    fragment@0 {
        target = <&spi0>;
        __overlay__ {
            adc: adc@0 {
                reg = <0>;
            };
        };
    };

    fragment@1 {
        target = <&spi0>;
        __overlay__ {
            dac@2 {
                reg = <2>;
            };
        };
    };
};`);
        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "adc" });
        expect(placement?.siblings.map(s => s.name)).toContain("dac@2");
    });

    test("placement_from_overlay — fragment targeting an ancestor is descended", () => {
        const base_with_ancestor = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
        };
    };
};`);
        if (typeof base_with_ancestor === "string") { throw new TypeError(base_with_ancestor); }

        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;

/ {
    fragment@0 {
        target = <&spi0>;
        __overlay__ {
            adc: adc@0 {
                reg = <0>;
            };
        };
    };

    fragment@1 {
        target-path = "/soc";
        __overlay__ {
            spi@7e204000 {
                dac@1 {
                    reg = <1>;
                };
            };
        };
    };
};`, base_with_ancestor);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "adc" });
        expect(placement?.siblings.map(s => s.name)).toContain("dac@1");
    });

    test("placement_from_overlay — path-targeted fragment resolves correctly", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;

/ {
    fragment@0 {
        target = <&{/soc/spi@7e204000}>;
        __overlay__ {
            adc: adc@2 {
                compatible = "adi,ad7124-8";
                reg = <2>;
            };
        };
    };
};`);
        const placement = placement_from_overlay(overlay, { kind: "label", labels: [], name: "adc" });
        expect(placement?.node_path).toBe("/soc/spi@7e204000/adc@2");
        expect(placement?.parent_path).toBe("/soc/spi@7e204000");
        expect(placement?.siblings).toStrictEqual([
            { name: "spidev@0", reg: 0n },
            { name: "spidev@1", reg: 1n },
        ]);
    });
}
