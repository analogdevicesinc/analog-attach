import { parent_path_string, suggest_parents, type DeviceTree, type ParsedBinding, type PathAndLabel } from "attach-lib";

import { bus_kind, type BusKind } from "../../utilities";

/** The parent a node goes under when none was named. */
export interface DefaultParent {
    /** Absolute path; `/` when the device has no valid parent in the base. */
    path: string;
    label: string | undefined;
    /** The bus kind asked for, when one was. */
    requested: BusKind | undefined;
    /** Whether the parent is of the requested kind (always, without one). */
    fits: boolean;
}

/** The first of `candidates` (the `list parent` entries, in their order) of the bus kind `bus`; the first one when none is, the root when there are none. */
export function pick_parent(tree: DeviceTree, candidates: readonly PathAndLabel[], bus?: BusKind): DefaultParent {
    const entry = (candidate: PathAndLabel, fits: boolean): DefaultParent => ({
        path: parent_path_string(candidate),
        label: candidate.label,
        requested: bus,
        fits,
    });
    if (bus !== undefined) {
        const of_kind = candidates.find(candidate => {
            const node = tree.node_at(parent_path_string(candidate));
            return node !== undefined && bus_kind(node) === bus;
        });
        if (of_kind !== undefined) { return entry(of_kind, true); }
    }
    const [first] = candidates;
    return first === undefined ? { path: "/", label: undefined, requested: bus, fits: bus === undefined } : entry(first, bus === undefined);
}

/** The first `list parent` bus of the device, of the kind `bus` when one is given. */
export function default_parent(tree: DeviceTree, binding: ParsedBinding, bus?: BusKind): DefaultParent {
    return pick_parent(tree, suggest_parents(tree, binding), bus);
}

/** The bus kind a fragment target names: `spi7`, `i2c_arm`, `/soc/spi@7e204000` (its last segment); undefined for anything else. */
export function target_bus(target?: string): BusKind | undefined {
    const last = target?.split("/").findLast(segment => segment !== "");
    return /^(spi|i2c)(?![a-z])/i.exec(last ?? "")?.[1]?.toLowerCase() as BusKind | undefined;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT } = await import("attach-lib");

    const tree = (): DeviceTree => {
        const parsed = DT.new_from_string(`/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 { compatible = "brcm,bcm2835-spi"; };
        i2c1: i2c@7e804000 { compatible = "brcm,bcm2835-i2c"; };
        spi1: spi@7e215080 { compatible = "brcm,bcm2835-aux-spi"; };
    };
    clocks { };
};`);
        if (typeof parsed === "string") { throw new TypeError(parsed); }
        return parsed;
    };
    const spi0: PathAndLabel = { path: ["/", "soc", "spi@7e204000"], label: "spi0" };
    const wire_bus: PathAndLabel = { path: ["/", "soc", "i2c@7e804000"], label: "i2c1" };
    const spi1: PathAndLabel = { path: ["/", "soc", "spi@7e215080"], label: "spi1" };

    test("pick_parent — without a kind, the first entry", () => {
        expect(pick_parent(tree(), [wire_bus, spi0])).toEqual({ path: "/soc/i2c@7e804000", label: "i2c1", requested: undefined, fits: true });
    });

    test("pick_parent — the first entry of the kind, whatever its place in the list", () => {
        expect(pick_parent(tree(), [wire_bus, spi0, spi1], "spi")).toEqual({ path: "/soc/spi@7e204000", label: "spi0", requested: "spi", fits: true });
        expect(pick_parent(tree(), [spi0, wire_bus, spi1], "i2c")).toMatchObject({ path: "/soc/i2c@7e804000", fits: true });
    });

    test("pick_parent — no bus of the kind: the first entry, not fitting", () => {
        expect(pick_parent(tree(), [spi0, spi1], "i2c")).toEqual({ path: "/soc/spi@7e204000", label: "spi0", requested: "i2c", fits: false });
    });

    test("pick_parent — no entry at all: the root", () => {
        expect(pick_parent(tree(), [])).toEqual({ path: "/", label: undefined, requested: undefined, fits: true });
        expect(pick_parent(tree(), [], "spi")).toEqual({ path: "/", label: undefined, requested: "spi", fits: false });
    });

    test("pick_parent — the root as the only entry (regulator-fixed) is the root", () => {
        expect(pick_parent(tree(), [{ path: ["/"], label: "/" }])).toMatchObject({ path: "/", fits: true });
    });

    test("target_bus — labels, bus nodes with unit addresses, other names", () => {
        expect(target_bus("spi7")).toBe("spi");
        expect(target_bus("i2c_arm")).toBe("i2c");
        expect(target_bus("i2c5")).toBe("i2c");
        expect(target_bus("/soc/spi@7e204000")).toBe("spi");
        expect(target_bus("/soc/i2c@7e804000/")).toBe("i2c");
        expect(target_bus("spidev0")).toBeUndefined();
        expect(target_bus("axi_spi_0")).toBeUndefined();
        expect(target_bus("/")).toBeUndefined();
        expect(target_bus()).toBeUndefined();
    });
}
