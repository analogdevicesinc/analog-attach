import { DeviceTree, DeviceTreeOverlay, type DTNode } from "attach-lib";

/**
 * What `validate --full` reports of the merged tree: the nodes the overlay adds,
 * with everything below them, and the base nodes whose properties it sets, in
 * any fragment. A base node the overlay only adds children to isn't, as for
 * reg clashes (VALIDATE-110).
 */
export interface Touched {
    /** Absolute paths of the nodes the overlay adds: a node at or below one is the overlay's. */
    readonly added: readonly string[];
    /** Absolute paths of the base nodes the overlay sets a property on. */
    readonly set: ReadonlySet<string>;
}

export function touched_by(overlay: DeviceTreeOverlay): Touched {
    const base = overlay.get_base_dts();
    const added: string[] = [];
    const set = new Set<string>();

    const walk = (node: DTNode, at: string): void => {
        if (base?.node_at(at) === undefined) {
            added.push(at);
            return;
        }
        if (node.properties.length > 0) { set.add(at); }
        for (const child of node.children) {
            walk(child, child_path(at, child));
        }
    };

    for (const fragment of overlay.get_fragments()) {
        const body = fragment.children.find(child => child.name === "__overlay__");
        const root = overlay.get_fragment_root_path(fragment);
        if (body === undefined || root === undefined) { continue; }
        walk(body, root);
    }
    return { added, set };
}

/** Whether the node at `at` is the overlay's (`Touched`). */
export function is_touched(touched: Touched, at: string): boolean {
    return touched.set.has(at) || touched.added.some(path => at === path || at.startsWith(path === "/" ? "/" : `${path}/`));
}

function child_path(parent: string, child: DTNode): string {
    const name = child.unit_addr === undefined ? child.name : `${child.name}@${child.unit_addr}`;
    return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 { gpio-controller; };
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev0: spidev@0 { reg = <0>; };
        };
    };
};`);
    if (typeof base === "string") { throw new TypeError(base); }

    test("touched_by - the nodes the overlay adds and the base nodes it sets", () => {
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;
&spi0 {
    status = "okay";
    adc@1 { reg = <1>; channel@0 { reg = <0>; }; };
};
&gpio {
    pins { brcm,pins = <4>; };
};
&spidev0 {
    status = "disabled";
};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const touched = touched_by(overlay);
        expect(touched.added).toEqual(["/soc/spi@7e204000/adc@1", "/soc/gpio@7e200000/pins"]);
        expect([...touched.set]).toEqual(["/soc/spi@7e204000", "/soc/spi@7e204000/spidev@0"]);
        expect(is_touched(touched, "/soc/spi@7e204000")).toBe(true);
        expect(is_touched(touched, "/soc/spi@7e204000/adc@1/channel@0")).toBe(true);
        expect(is_touched(touched, "/soc/spi@7e204000/adc@10")).toBe(false);
        // gpio only gets a child: its own findings stay the base's.
        expect(is_touched(touched, "/soc/gpio@7e200000")).toBe(false);
        expect(is_touched(touched, "/soc")).toBe(false);
    });
}
