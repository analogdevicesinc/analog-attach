import path from "node:path";

import { DeviceTreeOverlay, get_full_node_name, type DeviceTree, type DTNode } from "attach-lib";

import type { Settings } from "../../config/settings";
import { board_fit } from "../../board-fit";
import { scan_overlay } from "../../overlay-index";
import { board_lines } from "../../unresolved";
import { fragment_target, node_compatibles } from "../../utilities";
import { locate_overlay, lookup_failure, preprocess_overlay } from "../import/command";

// `add --template overlay:<name>`: the node of a device from an overlay of the
// Linux tree, with its children and nothing else. Where it goes is the node its
// fragment targets, unless `--parent` says otherwise.

/** A node of the overlay with a compatible of the device, and where the overlay puts it. */
export interface OverlayNode {
    node: DTNode;
    fragment: DTNode;
    /** The nodes between the fragment's body and this one. */
    chain: DTNode[];
    /** Whether the node is in a `__dormant__` body, which an `__overrides__` of the overlay may switch on. */
    dormant: boolean;
}

/**
 * The nodes with a compatible of the device, in file order: the first of each
 * branch, its children are the copy's. Those in `__overlay__` bodies; when
 * there are none, those in `__dormant__` ones.
 */
export function find_overlay_nodes(tree: DeviceTreeOverlay, belongs: (compatible: string) => boolean): OverlayNode[] {
    const search_bodies = (body_name: string): OverlayNode[] => {
        const found: OverlayNode[] = [];
        const search = (node: DTNode, fragment: DTNode, chain: DTNode[]): void => {
            for (const child of node.children) {
                if (node_compatibles(child).some(compatible => belongs(compatible))) { found.push({ node: child, fragment, chain, dormant: body_name === "__dormant__" }); }
                else { search(child, fragment, [...chain, child]); }
            }
        };
        for (const fragment of tree.get_fragments()) {
            const body = fragment.children.find(child => child.name === body_name);
            if (body !== undefined) { search(body, fragment, []); }
        }
        return found;
    };
    const live = search_bodies("__overlay__");
    return live.length > 0 ? live : search_bodies("__dormant__");
}

/** The overlay's place for the node, label-first as the overlay writes it: `spi0`, `/soc/spi@7e204000/mux`, `/`. */
export function overlay_place(match: OverlayNode): string {
    const target = fragment_target(match.fragment) ?? "?";
    return [target === "/" ? "" : target, ...match.chain.map(node => get_full_node_name(node))].join("/") || "/";
}

/** Where the overlay puts the node itself: `spi0/adc@0`, `/regulator@0`. */
export function overlay_node_path(match: OverlayNode): string {
    const place = overlay_place(match);
    return place === "/" ? `/${get_full_node_name(match.node)}` : `${place}/${get_full_node_name(match.node)}`;
}

/** The absolute path of the node's parent when the base has it: the fragment's target plus the nodes in between. */
export function overlay_parent(tree: DeviceTreeOverlay, base: DeviceTree, match: OverlayNode): string | undefined {
    const root = tree.get_fragment_root_path(match.fragment);
    if (root === undefined) { return undefined; }
    const parent = [root === "/" ? "" : root, ...match.chain.map(node => get_full_node_name(node))].join("/") || "/";
    return base.node_exists(parent) ? parent : undefined;
}

export type OverlayTemplate =
    | {
        status: "found";
        /** The overlay file, as shown to the user. */
        shown: string;
        match: OverlayNode;
        /** The fragment's target, as the overlay writes it (`spi0`, `/soc/spi@7e204000`). */
        target: string | undefined;
        /** Where the overlay puts the node, as it writes it. */
        place: string;
        /** The node's own path in the overlay: `spi0/adc@0`. */
        node_path: string;
        /** Whether the node comes from a `__dormant__` body. */
        dormant: boolean;
        /** The absolute path of that place, when the base has it. */
        parent: string | undefined;
        /** The places of the other nodes with the device's compatible. */
        others: string[];
        /** Lines about the overlay being for another board. */
        board: string[];
    }
    | { status: "failed"; message: string };

/** Find the overlay, preprocess and parse it against the base, and pick the device's node in it. */
export function load_overlay_template(
    name: string,
    compatible: string,
    belongs: (compatible: string) => boolean,
    settings: Settings,
    linux: string,
    base: DeviceTree,
    cwd = process.cwd(),
): OverlayTemplate {
    const located = locate_overlay(linux, name);
    if (located.kind !== "found") { return { status: "failed", message: lookup_failure(located, name, linux) }; }
    const source = located.file;
    const shown = path.relative(linux, source).startsWith("..") ? source : path.relative(linux, source);

    const preprocessed = preprocess_overlay(source, settings.preprocess_command, linux, "overlay-template.preprocessed.dts", cwd);
    if (!preprocessed.ok) { return { status: "failed", message: preprocessed.error }; }
    const tree = DeviceTreeOverlay.new_from_string(preprocessed.text, base);
    if (typeof tree === "string") { return { status: "failed", message: `${source} does not parse after preprocessing: ${tree}` }; }

    const [match, ...rest] = find_overlay_nodes(tree, belongs);
    if (match === undefined) { return { status: "failed", message: `${shown} has no node for ${compatible}` }; }

    const root = base.node_at("/");
    const overlay_board = scan_overlay(preprocessed.text).board ?? [];
    const base_board = root === undefined ? [] : node_compatibles(root);
    const fit = board_fit(overlay_board, base_board);
    return {
        status: "found",
        shown,
        match,
        target: fragment_target(match.fragment),
        place: overlay_place(match),
        node_path: overlay_node_path(match),
        dormant: match.dormant,
        parent: overlay_parent(tree, base, match),
        others: rest.map(other => overlay_node_path(other)),
        board: fit.fit === "incompatible" ? board_lines(overlay_board, base_board) : [],
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, unresolved_references } = await import("attach-lib");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { copy_example_node } = await import("./example");

    const base = (): DeviceTree => {
        const tree = DT.new_from_string(`/dts-v1/;
/ {
    compatible = "raspberrypi,4-model-b", "brcm,bcm2711";
    soc {
        spi0: spi@7e204000 { #address-cells = <1>; #size-cells = <0>; };
        i2c1: i2c@7e804000 { #address-cells = <1>; #size-cells = <0>; };
    };
};`);
        if (typeof tree === "string") { throw new TypeError(tree); }
        return tree;
    };
    const overlay = (text: string): DeviceTreeOverlay => {
        const tree = DeviceTreeOverlay.new_from_string(text, base());
        if (typeof tree === "string") { throw new TypeError(tree); }
        return tree;
    };
    const belongs = (compatible: string): boolean => compatible.startsWith("adi,ad7124");

    const OVERLAY = `/dts-v1/;
/plugin/;
/ {
    fragment@0 {
        target-path = "/";
        __overlay__ { vref: regulator@0 { compatible = "regulator-fixed"; }; };
    };
    fragment@1 {
        target = <&spi0>;
        __overlay__ {
            ad7124: adc@0 {
                compatible = "adi,ad7124-8";
                reg = <0>;
                refin1-supply = <&vref>;
                channel@0 { reg = <0>; };
            };
            adc@1 { compatible = "adi,ad7124-4"; reg = <1>; };
        };
    };
    fragment@2 {
        target = <&i2c1>;
        __overlay__ { mux { adc@2 { compatible = "adi,ad7124-8"; }; }; };
    };
    fragment@3 {
        target = <&spi7>;
        __overlay__ { adc@3 { compatible = "adi,ad7124-8"; }; };
    };
};
`;

    test("find_overlay_nodes — every node of the device, in file order, with where it sits", () => {
        const tree = overlay(OVERLAY);
        const found = find_overlay_nodes(tree, belongs);
        expect(found.map(match => overlay_node_path(match))).toEqual(["spi0/adc@0", "spi0/adc@1", "i2c1/mux/adc@2", "spi7/adc@3"]);
        expect(find_overlay_nodes(tree, c => c === "regulator-fixed").map(match => overlay_place(match))).toEqual(["/"]);
        expect(find_overlay_nodes(tree, c => c === "adi,nope")).toEqual([]);
        expect(found.map(match => match.dormant)).toEqual([false, false, false, false]);
    });

    test("find_overlay_nodes — a dormant body only counts when no live one has the device", () => {
        const text = `/dts-v1/;
/plugin/;
/ {
    fragment@0 {
        target = <&spi0>;
        __dormant__ { adc@0 { compatible = "adi,ad7124-8"; }; };
    };
    fragment@1 {
        target = <&i2c1>;
        __overlay__ { adc@1 { compatible = "adi,ad7124-4"; }; };
    };
};
`;
        const found = find_overlay_nodes(overlay(text), belongs);
        expect(found.map(match => [overlay_node_path(match), match.dormant])).toEqual([["i2c1/adc@1", false]]);
        const only = find_overlay_nodes(overlay(text.replace("adi,ad7124-4", "adi,adxl345")), belongs);
        expect(only.map(match => [overlay_node_path(match), match.dormant])).toEqual([["spi0/adc@0", true]]);
    });

    test("overlay_parent — the target's path, plus the nodes in between; undefined when the base lacks it", () => {
        const tree = overlay(OVERLAY);
        const found = find_overlay_nodes(tree, belongs);
        expect(found.map(match => overlay_parent(tree, base(), match))).toEqual(["/soc/spi@7e204000", "/soc/spi@7e204000", undefined, undefined]);
        const root = find_overlay_nodes(tree, c => c === "regulator-fixed")[0]!;
        expect(overlay_parent(tree, base(), root)).toBe("/");
    });

    test("overlay_place — a path target and a label target", () => {
        const tree = overlay(`/dts-v1/;\n/plugin/;\n&{/soc/spi@7e204000} { adc@0 { compatible = "adi,ad7124-8"; }; };\n`);
        const [match] = find_overlay_nodes(tree, belongs);
        expect(overlay_place(match!)).toBe("/soc/spi@7e204000");
        expect(overlay_parent(tree, base(), match!)).toBe("/soc/spi@7e204000");
    });

    const workspace = (): { linux: string; cwd: string; settings: Settings; done: () => void } => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-overlay-template-"));
        const linux = path.join(root, "linux");
        const cwd = path.join(root, "work");
        fs.mkdirSync(path.join(linux, "arch/arm/boot/dts/overlays"), { recursive: true });
        fs.mkdirSync(cwd);
        return { linux, cwd, settings: { overlay_syntax: "fragment", preprocess_command: "cp {input} {output}" }, done: () => { fs.rmSync(root, { recursive: true }); } };
    };

    test("load_overlay_template — the first node of the device, the others, the board, and where it goes", () => {
        const { linux, cwd, settings, done } = workspace();
        try {
            fs.writeFileSync(path.join(linux, "arch/arm/boot/dts/overlays/ad7124-overlay.dts"), OVERLAY.replace("/ {\n    fragment@0", '/ {\n    compatible = "xlnx,zynqmp";\n    fragment@0'));
            const found = load_overlay_template("ad7124", "adi,ad7124-8", belongs, settings, linux, base(), cwd);
            expect(found).toMatchObject({
                status: "found",
                shown: "arch/arm/boot/dts/overlays/ad7124-overlay.dts",
                place: "spi0",
                parent: "/soc/spi@7e204000",
                others: ["spi0/adc@1", "i2c1/mux/adc@2", "spi7/adc@3"],
            });
            expect(found.status === "found" && found.board).toEqual(["warning: this overlay is for another board: xlnx,zynqmp", "  (base: raspberrypi,4-model-b, brcm,bcm2711)"]);
        } finally { done(); }
    });

    test("load_overlay_template — a file path; no node, no overlay and a parse error say so", () => {
        const { linux, cwd, settings, done } = workspace();
        try {
            const file = path.join(cwd, "mine.dts");
            fs.writeFileSync(file, '/dts-v1/;\n/plugin/;\n&spi7 { adc@0 { compatible = "adi,ad7124-8"; }; };\n');
            expect(load_overlay_template(file, "adi,ad7124-8", belongs, settings, linux, base(), cwd))
                .toMatchObject({ status: "found", shown: file, place: "spi7", parent: undefined, others: [], board: [] });
            expect(load_overlay_template(file, "adi,adxl345", c => c === "adi,adxl345", settings, linux, base(), cwd))
                .toEqual({ status: "failed", message: `${file} has no node for adi,adxl345` });
            expect(load_overlay_template("nope", "adi,ad7124-8", belongs, settings, linux, base(), cwd))
                .toEqual({ status: "failed", message: `No overlay named nope in ${linux} (list overlay <compatible> finds them), and no such file` });
            fs.writeFileSync(file, "/dts-v1/;\n/plugin/;\n&spi7 { adc@0 { ");
            expect(load_overlay_template(file, "adi,ad7124-8", belongs, settings, linux, base(), cwd))
                .toMatchObject({ status: "failed", message: expect.stringContaining("does not parse after preprocessing") });
        } finally { done(); }
    });

    test("copied into a workfile — the node with its channels, the overlay's regulator left behind and referenced", () => {
        const { linux, cwd, settings, done } = workspace();
        try {
            fs.writeFileSync(path.join(linux, "arch/arm/boot/dts/overlays/ad7124-overlay.dts"), OVERLAY);
            const found = load_overlay_template("ad7124-overlay.dts", "adi,ad7124-8", belongs, settings, linux, base(), cwd);
            if (found.status !== "found") { throw new Error(found.message); }
            const workfile = DeviceTreeOverlay.new_from_string("/dts-v1/;\n/plugin/;\n/ {\n};\n", base());
            if (typeof workfile === "string") { throw new TypeError(workfile); }
            expect(copy_example_node(workfile, found.parent ?? "/", found.match.node, { compatible: "adi,ad7124-8" }))
                .toMatchObject({ status: "added", path: "/soc/spi@7e204000/adc@0", label: "ad7124" });
            const printed = workfile.print();
            expect(printed).toContain("channel@0 {");
            expect(printed).not.toContain("regulator-fixed");
            expect(unresolved_references(workfile, "/soc/spi@7e204000/adc@0")).toEqual([
                { path: "/soc/spi@7e204000/adc@0", property: "refin1-supply", reference: "&vref" },
            ]);
        } finally { done(); }
    });
}
