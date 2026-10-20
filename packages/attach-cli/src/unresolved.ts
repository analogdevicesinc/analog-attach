import type { UnresolvedReference } from "attach-lib";

import type { UnresolvedTargetEntry } from "./protocol/types";

// What `import` and `add --from-example` print for the targets and references
// that name nothing in the base or the overlay: a heading per kind of problem,
// one row per node and property, and how to fix it.

/** `path` from its deepest labelled node (`spi0/adc@0`); a target that didn't resolve as written, without `&`. */
export function display_path(at: string, labels: Map<string, string>): string {
    if (!at.startsWith("/")) { return at.replace(/^&/, ""); }
    const label_of = new Map<string, string>();
    for (const [label, node] of labels) { if (!label_of.has(node)) { label_of.set(node, label); } }
    const parts = at.split("/").filter(Boolean);
    for (let n = parts.length; n > 0; n--) {
        const label = label_of.get(`/${parts.slice(0, n).join("/")}`);
        if (label !== undefined) { return [label, ...parts.slice(n)].join("/"); }
    }
    return at;
}

/** The references without repeats: a property naming the same label twice (two GPIOs of one controller) counts once. */
export function unique_references(references: UnresolvedReference[]): UnresolvedReference[] {
    const seen = new Set<string>();
    return references.filter(({ path, property, reference }) => {
        const key = `${path}\u0000${property}\u0000${reference}`;
        if (seen.has(key)) { return false; }
        seen.add(key);
        return true;
    });
}

/** The references that resolve to nothing: a count, one row per node and property, and the fix. */
export function reference_lines(severity: "warning" | "error", references: UnresolvedReference[], labels: Map<string, string>): string[] {
    // node → property → references, in tree order; a reference named twice in a property counts once.
    const rows = new Map<string, Map<string, Set<string>>>();
    for (const { path, property, reference } of references) {
        const node = display_path(path, labels);
        const properties = rows.get(node) ?? new Map<string, Set<string>>();
        properties.set(property, (properties.get(property) ?? new Set<string>()).add(reference));
        rows.set(node, properties);
    }
    const count = [...rows.values()].flatMap(properties => [...properties.values()]).reduce((sum, set) => sum + set.size, 0);
    if (count === 0) { return []; }
    const width = Math.max(...[...rows.keys()].map(node => node.length));
    return [
        count === 1
            ? `${severity}: 1 reference points to a node neither the base nor the overlay has:`
            : `${severity}: ${count} references point to nodes neither the base nor the overlay has:`,
        ...[...rows].flatMap(([node, properties]) =>
            [...properties].map(([property, targets]) => `  ${node.padEnd(width)}  ${property} → ${[...targets].join(", ")}`)),
        "  fix with: update <node> <property> <value>, or delete <node> <property>",
    ];
}

/** The fragments whose target the base doesn't have: a count and one row per fragment. */
export function target_lines(targets: UnresolvedTargetEntry[]): string[] {
    if (targets.length === 0) { return []; }
    const width = Math.max(...targets.map(t => t.fragment.length));
    return [
        targets.length === 1
            ? "warning: 1 fragment targets a node the base doesn't have:"
            : `warning: ${targets.length} fragments target nodes the base doesn't have:`,
        ...targets.map(({ fragment, property, target }) => `  ${fragment.padEnd(width)}  ${property} ${target}`),
    ];
}

/** The warning for an overlay meant for another board. */
export function board_lines(overlay: readonly string[], base: readonly string[]): string[] {
    return [`warning: this overlay is for another board: ${overlay.join(", ")}`, `  (base: ${base.join(", ")})`];
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("display_path — from the deepest labelled node; an unresolved target as written", () => {
        const labels = new Map([["spi0", "/soc/spi@7e204000"], ["ad7124", "/soc/spi@7e204000/adc@0"]]);
        expect(display_path("/soc/spi@7e204000/adc@0/channel@0", labels)).toBe("ad7124/channel@0");
        expect(display_path("/soc/spi@7e204000/spidev@0", labels)).toBe("spi0/spidev@0");
        expect(display_path("/soc", labels)).toBe("/soc");
        expect(display_path("&spi7/adc@0", labels)).toBe("spi7/adc@0");
    });

    test("unique_references — repeats dropped, order kept", () => {
        expect(unique_references([
            { path: "/a", property: "gpios", reference: "&g" },
            { path: "/a", property: "clocks", reference: "&c" },
            { path: "/a", property: "gpios", reference: "&g" },
            { path: "/b", property: "gpios", reference: "&g" },
        ])).toEqual([
            { path: "/a", property: "gpios", reference: "&g" },
            { path: "/a", property: "clocks", reference: "&c" },
            { path: "/b", property: "gpios", reference: "&g" },
        ]);
    });

    test("reference_lines — a count, one aligned row per node and property, the fix", () => {
        const labels = new Map([["ad7124", "/soc/spi@7e204000/adc@0"]]);
        expect(reference_lines("warning", [
            { path: "/soc/spi@7e204000/adc@0", property: "refin1-supply", reference: "&vref" },
            { path: "/soc/spi@7e204000/adc@0", property: "clocks", reference: "&clk_a" },
            { path: "/soc/spi@7e204000/adc@0", property: "clocks", reference: "&clk_b" },
            { path: "/soc/spi@7e204000/adc@0/channel@0", property: "io-backends", reference: "&{/backend}" },
        ], labels)).toEqual([
            "warning: 4 references point to nodes neither the base nor the overlay has:",
            "  ad7124            refin1-supply → &vref",
            "  ad7124            clocks → &clk_a, &clk_b",
            "  ad7124/channel@0  io-backends → &{/backend}",
            "  fix with: update <node> <property> <value>, or delete <node> <property>",
        ]);
    });

    test("reference_lines — one reference, named twice in a property, counts once", () => {
        expect(reference_lines("error", [
            { path: "&spi7/adc@0", property: "gpios", reference: "&rp1_gpio" },
            { path: "&spi7/adc@0", property: "gpios", reference: "&rp1_gpio" },
        ], new Map())).toEqual([
            "error: 1 reference points to a node neither the base nor the overlay has:",
            "  spi7/adc@0  gpios → &rp1_gpio",
            "  fix with: update <node> <property> <value>, or delete <node> <property>",
        ]);
        expect(reference_lines("error", [], new Map())).toEqual([]);
    });

    test("target_lines — a count and one row per fragment", () => {
        expect(target_lines([
            { fragment: "fragment@1", property: "target", target: "spi7" },
            { fragment: "fragment@12", property: "target-path", target: "/soc/nope" },
        ])).toEqual([
            "warning: 2 fragments target nodes the base doesn't have:",
            "  fragment@1   target spi7",
            "  fragment@12  target-path /soc/nope",
        ]);
        expect(target_lines([{ fragment: "fragment@0", property: "target", target: "rp1_gpio" }]))
            .toEqual(["warning: 1 fragment targets a node the base doesn't have:", "  fragment@0  target rp1_gpio"]);
        expect(target_lines([])).toEqual([]);
    });

    test("board_lines — the overlay's boards, then the base's", () => {
        expect(board_lines(["brcm,bcm2712"], ["raspberrypi,4-model-b", "brcm,bcm2711"])).toEqual([
            "warning: this overlay is for another board: brcm,bcm2712",
            "  (base: raspberrypi,4-model-b, brcm,bcm2711)",
        ]);
    });
}
