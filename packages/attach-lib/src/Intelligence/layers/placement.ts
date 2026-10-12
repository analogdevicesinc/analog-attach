import {
    DeviceTree,
    DeviceTreeOverlay,
    extract_first_number,
    is_enabled,
    parent_path as access_parent_path,
    type NodeTarget,
} from "../../Devicetree/index.js";
import type { DTNode } from "../../Devicetree/index.js";
import { NodePlacement } from "./types.js";

function first_reg(node: DTNode): bigint | undefined {
    return extract_first_number(node, "reg");
}

export function placement_from_overlay(overlay: DeviceTreeOverlay, target: NodeTarget): NodePlacement | undefined {
    const base = overlay.get_base_dts();

    const found = overlay.find_node(target);
    const located = found === undefined
        ? base?.locate(target)
        : { node: found.node, path: found.node_path };
    if (located === undefined) { return; }

    const node_path = located.path;
    const parent_path = access_parent_path(node_path) ?? "/";
    const own_name = node_path.slice(node_path.lastIndexOf("/") + 1);

    const children = overlay.effective_children(parent_path);

    const siblings = [...children.entries()]
        .filter(([name, child]) => name !== own_name && is_enabled(child))
        .map(([name, child]) => {
            const reg = first_reg(child);
            return reg === undefined ? { name } : { name, reg };
        });

    const effective = overlay.effective_node(node_path);
    const reg = first_reg(located.node) ?? (effective === undefined ? undefined : first_reg(effective));
    return reg === undefined
        ? { node_path, parent_path, siblings }
        : { node_path, parent_path, reg, siblings };
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
        const placement = placement_from_overlay(overlay, "adc");
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
        const placement = placement_from_overlay(overlay, "adc");
        expect(placement?.siblings).toStrictEqual([{ name: "spidev@1", reg: 1n }]);
    });

    test("placement_from_overlay — falls back to the base tree for nodes the overlay does not touch", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;
/ { };`);
        const placement = placement_from_overlay(overlay, "spi0");
        expect(placement?.node_path).toBe("/soc/spi@7e204000");
        expect(placement?.parent_path).toBe("/soc");
        expect(placement?.reg).toBeUndefined();
    });

    test("placement_from_overlay — unknown targets yield undefined", () => {
        const overlay = overlay_of(`/dts-v1/;
/plugin/;
/ { };`);
        expect(placement_from_overlay(overlay, "nope")).toBeUndefined();
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
        const placement = placement_from_overlay(overlay, "adc");
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
        const placement = placement_from_overlay(overlay, "adc");
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

        const placement = placement_from_overlay(overlay, "adc");
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
        const placement = placement_from_overlay(overlay, "adc");
        expect(placement?.node_path).toBe("/soc/spi@7e204000/adc@2");
        expect(placement?.parent_path).toBe("/soc/spi@7e204000");
        expect(placement?.siblings).toStrictEqual([
            { name: "spidev@0", reg: 0n },
            { name: "spidev@1", reg: 1n },
        ]);
    });
}
