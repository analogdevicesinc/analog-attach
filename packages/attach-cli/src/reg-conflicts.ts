import { address_cells_of, reg_conflicts, sibling_reg_conflicts, type DeviceTreeOverlay, type RegConflict } from "attach-lib";

import { bus_kind } from "./utilities";

/** A reg clash, reported on the node the overlay adds or changes. */
export interface RegWarning {
    /** Absolute path of the node the warning is about. */
    path: string;
    message: string;
    /** How to resolve it, when the other node comes from the base tree. */
    hint?: string;
}

/** Clashes in the whole tree that involve the overlay; base-only clashes are left out. */
export function reg_warnings(overlay: DeviceTreeOverlay): RegWarning[] {
    return reg_conflicts(overlay)
        .filter(conflict => conflict.in_overlay.some(Boolean))
        .map(conflict => {
            // Report on the overlay's side; the later node when both are.
            const side = conflict.in_overlay[1] ? 1 : 0;
            return warning(overlay, conflict, side);
        });
}

/** Clashes between the node at `path` and its siblings, whichever side they come from. */
export function node_reg_warnings(overlay: DeviceTreeOverlay, path: string): RegWarning[] {
    const slash = path.lastIndexOf("/");
    const parent_path = slash <= 0 ? "/" : path.slice(0, slash);
    const name = path.slice(slash + 1);
    return sibling_reg_conflicts(overlay, parent_path)
        .filter(conflict => conflict.nodes.includes(name))
        .map(conflict => warning(overlay, conflict, conflict.nodes[0] === name ? 0 : 1));
}

/** The lines `update reg`, `rename` and `add` print for a warning (on stderr under --json). */
export function reg_warning_lines(warning: RegWarning): string[] {
    return [`warning: ${warning.message}`, ...(warning.hint === undefined ? [] : [`  ${warning.hint}`])];
}

function warning(overlay: DeviceTreeOverlay, conflict: RegConflict, side: 0 | 1): RegWarning {
    const { parent_path, nodes, address, in_overlay } = conflict;
    const child_path = (name: string): string => parent_path === "/" ? `/${name}` : `${parent_path}/${name}`;
    const name = nodes[side];
    const other = nodes[side === 0 ? 1 : 0];

    const parent = overlay.effective_node(parent_path);
    const bus = parent === undefined ? undefined : bus_kind(parent);
    let message: string;
    if (address_cells_of(overlay, parent_path).size > 0) {
        message = `reg overlaps ${other} at 0x${address.toString(16)}`;
    } else if (bus === "spi") {
        message = `chip select ${address} is already used by ${other}`;
    } else if (bus === "i2c") {
        message = `address 0x${address.toString(16)} is already used by ${other}`;
    } else {
        message = `reg 0x${address.toString(16)} is already used by ${other}`;
    }

    const other_in_base = !in_overlay[side === 0 ? 1 : 0];
    return {
        path: child_path(name),
        message,
        ...(other_in_base ? { hint: `If ${name} replaces it: disable ${child_path(other)}` } : {}),
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree, DeviceTreeOverlay: DTO } = await import("attach-lib");

    const base_source = `/dts-v1/;
/ {
    #address-cells = <1>;
    #size-cells = <1>;
    uart@1000 { reg = <0x1000 0x100>; };
    soc {
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 { reg = <0>; };
        };
        i2c1: i2c@7e804000 {
            compatible = "brcm,bcm2835-i2c";
            #address-cells = <1>;
            #size-cells = <0>;
            temp@48 { reg = <0x48>; };
        };
        gpio@7e200000 { reg = <0x7e200000 0xb4>; };
        gpiomem { reg = <0x7e200000 0x1000>; };
    };
};`;

    const setup = (overlay_source: string): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string(base_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(`/dts-v1/;\n/plugin/;\n\n${overlay_source}`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };

    test("reg_warnings — a taken chip select, with a hint to disable the base node", () => {
        expect(reg_warnings(setup("&spi0 {\n\tadc@1 { reg = <0>; };\n};"))).toEqual([{
            path: "/soc/spi@7e204000/adc@1",
            message: "chip select 0 is already used by spidev@0",
            hint: "If adc@1 replaces it: disable /soc/spi@7e204000/spidev@0",
        }]);
    });

    test("reg_warnings — I2C addresses are hex, and two overlay nodes need no hint", () => {
        expect(reg_warnings(setup("&i2c1 {\n\tadc@49 { reg = <0x49>; };\n\tdac@49 { reg = <0x49>; };\n};"))).toEqual([{
            path: "/soc/i2c@7e804000/dac@49",
            message: "address 0x49 is already used by adc@49",
        }]);
    });

    test("reg_warnings — an overlapping MMIO range", () => {
        expect(reg_warnings(setup("&{/} {\n\tdma@1080 { reg = <0x1080 0x10>; };\n};"))).toEqual([{
            path: "/dma@1080",
            message: "reg overlaps uart@1000 at 0x1080",
            hint: "If dma@1080 replaces it: disable /uart@1000",
        }]);
    });

    test("reg_warnings — clashes only within the base tree are left out", () => {
        expect(reg_warnings(setup("&spi0 {\n\tadc@1 { reg = <1>; };\n};"))).toEqual([]);
    });

    test("node_reg_warnings — only the clashes of that node", () => {
        const overlay = setup("&spi0 {\n\tadc@0 { reg = <0>; };\n\tadc@1 { reg = <1>; };\n};");
        expect(node_reg_warnings(overlay, "/soc/spi@7e204000/adc@1")).toEqual([]);
        expect(node_reg_warnings(overlay, "/soc/spi@7e204000/adc@0").map(w => w.message)).toEqual(["chip select 0 is already used by spidev@0"]);
        expect(node_reg_warnings(overlay, "/soc/spi@7e204000/spidev@0").map(w => w.message)).toEqual(["chip select 0 is already used by adc@0"]);
    });

    test("reg_warning_lines — the warning and its hint", () => {
        expect(reg_warning_lines({ path: "/a/adc@1", message: "chip select 0 is already used by spidev@0", hint: "If adc@1 replaces it: disable /a/spidev@0" }))
            .toEqual(["warning: chip select 0 is already used by spidev@0", "  If adc@1 replaces it: disable /a/spidev@0"]);
        expect(reg_warning_lines({ path: "/a/adc@1", message: "m" })).toEqual(["warning: m"]);
    });
}
