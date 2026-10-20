import fs from "node:fs";
import path from "node:path";

import {
    DeviceTree,
    PropertyBuilder,
    ensure_address_cells,
    get_full_node_name,
    is_dt_flag,
    is_valid_label,
    label_from_compatible,
    unique_label,
    type DeviceTreeOverlay,
    type DTLabel,
    type DTNode,
} from "attach-lib";

import { config_directory, type Settings } from "../../config/settings";
import { bus_kind, node_compatibles, run_preprocess, type BusKind } from "../../utilities";

/** A binding example that has a node for the device, and the bus it sits on there. */
export interface ExampleMatch {
    /** 1-based, as the examples read in the binding. */
    index: number;
    node: DTNode;
    bus: BusKind | undefined;
}

export type ExampleNote =
    /** The example is for another compatible of the binding. */
    | { kind: "compatible-replaced"; from: string }
    /** The example's label is taken. */
    | { kind: "label-renamed"; from: string; to: string };

export type CopyResult =
    | { status: "added"; key: string; path: string; label: string; notes: ExampleNote[] }
    | { status: "parent-not-found" }
    | { status: "invalid-label"; label: string }
    | { status: "label-taken"; label: string; owner: string }
    | { status: "duplicate"; key: string };

function is_include(line: string): boolean {
    return /^\s*#include\b/.test(line);
}

/** Wrap a binding example so it compiles on its own: its `#include` lines, then the snippet under a root node. */
export function wrap_example(example: string): string {
    const lines = example.split("\n");
    const header = ["/dts-v1/;", ...lines.filter(line => is_include(line)).map(line => line.trim())].join("\n");
    const body = lines.filter(line => !is_include(line)).join("\n").replace(/^\s*\/dts-v1\/;\s*/, "");
    return /^\s*\/\s*\{/m.test(body) ? `${header}\n${body}` : `${header}\n/ {\n${body}\n};\n`;
}

/** The first node (depth first) whose compatible list has a compatible of the device, and its parent in the example. */
export function find_in_example(root: DTNode, belongs: (compatible: string) => boolean): { node: DTNode; wrapper: DTNode | undefined } | undefined {
    for (const child of root.children) {
        if (node_compatibles(child).some(compatible => belongs(compatible))) { return { node: child, wrapper: undefined }; }
        const below = find_in_example(child, belongs);
        if (below !== undefined) { return { node: below.node, wrapper: below.wrapper ?? child }; }
    }
    return undefined;
}

/** The bus an example wraps its node in: `spi { … }`, `i2c1 { … }`, or a controller node. */
export function example_bus(wrapper?: DTNode): BusKind | undefined {
    if (wrapper === undefined) { return undefined; }
    const named = /^(spi|i2c)\d*$/.exec(wrapper.name)?.[1];
    return named === undefined ? bus_kind(wrapper) : named as BusKind;
}

/** The first example on the parent's bus, else the first one; `fits` says whether the bus matched. */
export function choose_example(matches: ExampleMatch[], bus?: BusKind): { match: ExampleMatch; fits: boolean } | undefined {
    const [first] = matches;
    if (first === undefined) { return undefined; }
    if (bus === undefined) { return { match: first, fits: true }; }
    const on_bus = matches.find(match => match.bus === bus);
    return on_bus === undefined ? { match: first, fits: false } : { match: on_bus, fits: true };
}

/**
 * Copy the example node under `parent_path` as it is (name, unit address,
 * reg, children, references). The compatible becomes `compatible` when the
 * example is for another device of the binding. Taken labels in the copy get
 * free ones, and the copy's references to them follow; references to labels
 * outside it stay as written.
 */
export function copy_example_node(
    overlay: DeviceTreeOverlay,
    parent_path: string,
    node: DTNode,
    request: { compatible: string; label?: string },
): CopyResult {
    if (overlay.effective_node(parent_path) === undefined) { return { status: "parent-not-found" }; }
    const key = get_full_node_name(node);
    if (overlay.effective_children(parent_path).has(key)) { return { status: "duplicate", key }; }

    const notes: ExampleNote[] = [];
    const copy = structuredClone(node);
    const compatibles = node_compatibles(node);
    if (!compatibles.includes(request.compatible)) {
        copy.properties = copy.properties.map(property => property.name === "compatible"
            ? PropertyBuilder.build_string().with_value(request.compatible).with_name("compatible").build()
            : property);
        notes.push({ kind: "compatible-replaced", from: compatibles[0] ?? "" });
    }

    const taken = overlay.all_labels();
    const claim = (wanted: string): string => {
        const free = unique_label(wanted, taken);
        taken.set(free, "");
        if (free !== wanted) { notes.push({ kind: "label-renamed", from: wanted, to: free }); }
        return free;
    };
    let label: string;
    if (request.label === undefined) {
        label = node.labels[0] === undefined ? unique_label(label_from_compatible(request.compatible), taken) : claim(node.labels[0]);
    } else {
        if (!is_valid_label(request.label)) { return { status: "invalid-label", label: request.label }; }
        const owner = taken.get(request.label);
        if (owner !== undefined) { return { status: "label-taken", label: request.label, owner }; }
        label = request.label;
    }
    taken.set(label, "");
    const renames = new Map(node.labels.map(old => [old, label]));
    copy.labels = [label];
    const relabel = (parent: DTNode): void => {
        for (const child of parent.children) {
            child.labels = child.labels.map(old => {
                const free = claim(old);
                renames.set(old, free);
                return free;
            });
            relabel(child);
        }
    };
    relabel(copy);
    rename_references(copy, renames);

    if (node.unit_addr !== undefined) { ensure_address_cells(overlay, parent_path); }
    const parent = overlay.ensure_node(parent_path);
    if (parent === undefined) { return { status: "parent-not-found" }; }
    parent.children.push(copy);
    return { status: "added", key, path: `${parent_path === "/" ? "" : parent_path}/${key}`, label, notes };
}

/** Point the `&label` references in the subtree at the renamed labels. */
function rename_references(node: DTNode, renames: Map<string, string>): void {
    const rename = (value: { kind: string }): void => {
        if (value.kind !== "label") { return; }
        const reference = value as DTLabel;
        const bare = reference.name.startsWith("&") ? reference.name.slice(1) : reference.name;
        const renamed = renames.get(bare);
        if (renamed !== undefined) { reference.name = reference.name.startsWith("&") ? `&${renamed}` : renamed; }
    };
    for (const property of node.properties) {
        if (is_dt_flag(property.value)) { continue; }
        for (const value of property.value) {
            for (const element of value.kind === "array" ? value.elements : [value]) { rename(element); }
        }
    }
    for (const child of node.children) { rename_references(child, renames); }
}

/** Run the example through `preprocess-command` (for its dt-bindings headers) and parse it. */
export function parse_example(example: string, settings: Settings, linux: string, cwd = process.cwd()): DTNode | string {
    const directory = config_directory(cwd);
    fs.mkdirSync(directory, { recursive: true });
    const input = path.join(directory, "example.dts");
    const output = path.join(directory, "example.preprocessed.dts");
    fs.writeFileSync(input, wrap_example(example));
    const error = run_preprocess(settings.preprocess_command, { input, output, linux });
    if (error !== undefined) { return error; }
    const tree = DeviceTree.new_from_string(fs.readFileSync(output, "utf8"));
    if (typeof tree === "string") { return tree; }
    return tree.node_at("/") ?? "the example has no root node";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTreeOverlay: DTO } = await import("attach-lib");
    const { EMPTY_DTSO } = await import("../../workfile");

    const parse_root = (source: string): DTNode => {
        const tree = DeviceTree.new_from_string(source);
        if (typeof tree === "string") { throw new TypeError(tree); }
        return tree.node_at("/")!;
    };

    const AD7124_EXAMPLE = `#include <dt-bindings/gpio/gpio.h>
spi {
  #address-cells = <1>;
  #size-cells = <0>;

  adc@0 {
    compatible = "adi,ad7124-4";
    reg = <0>;
    interrupt-parent = <&gpio>;
    refin1-supply = <&adc_vref>;
    #address-cells = <1>;
    #size-cells = <0>;
    channel@0 { reg = <0>; };
  };
};
`;

    test("wrap_example — includes first, the snippet under a root node", () => {
        expect(wrap_example(AD7124_EXAMPLE)).toBe(`/dts-v1/;
#include <dt-bindings/gpio/gpio.h>
/ {
spi {
  #address-cells = <1>;
  #size-cells = <0>;

  adc@0 {
    compatible = "adi,ad7124-4";
    reg = <0>;
    interrupt-parent = <&gpio>;
    refin1-supply = <&adc_vref>;
    #address-cells = <1>;
    #size-cells = <0>;
    channel@0 { reg = <0>; };
  };
};

};
`);
    });

    test("wrap_example — an example with its own root node isn't wrapped again", () => {
        expect(wrap_example("/ {\n  model = \"x\";\n};\n")).toBe("/dts-v1/;\n/ {\n  model = \"x\";\n};\n");
    });

    test("find_in_example — the node of the device and its wrapper", () => {
        const root = parse_root(wrap_example(AD7124_EXAMPLE).replace("#include <dt-bindings/gpio/gpio.h>\n", ""));
        const found = find_in_example(root, c => c === "adi,ad7124-4");
        expect(found?.node.name).toBe("adc");
        expect(found?.wrapper?.name).toBe("spi");
        expect(find_in_example(root, c => c === "adi,ad7173-8")).toBeUndefined();
    });

    test("example_bus — wrapper names and controller compatibles", () => {
        const root = parse_root(`/dts-v1/;
/ {
    spi { };
    i2c1 { };
    bus@0 { compatible = "brcm,bcm2835-i2c"; };
    soc { };
};`);
        const child = (name: string): DTNode => root.children.find(c => c.name === name)!;
        expect(example_bus(child("spi"))).toBe("spi");
        expect(example_bus(child("i2c1"))).toBe("i2c");
        expect(example_bus(child("bus"))).toBe("i2c");
        expect(example_bus(child("soc"))).toBeUndefined();
        expect(example_bus()).toBeUndefined();
    });

    test("choose_example — the first on the parent's bus, else the first", () => {
        const node = parse_root("/dts-v1/;\n/ { };");
        const matches: ExampleMatch[] = [
            { index: 1, node, bus: "i2c" },
            { index: 2, node, bus: "spi" },
            { index: 3, node, bus: "spi" },
        ];
        expect(choose_example(matches, "spi")).toEqual({ match: matches[1], fits: true });
        expect(choose_example(matches, "i2c")).toEqual({ match: matches[0], fits: true });
        expect(choose_example(matches.slice(1), "i2c")).toEqual({ match: matches[1], fits: false });
        expect(choose_example(matches)).toEqual({ match: matches[0], fits: true });
        expect(choose_example([], "spi")).toBeUndefined();
    });

    const setup = (): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        gpio: gpio@7e200000 { };
        spi0: spi@7e204000 {
            #address-cells = <1>;
            #size-cells = <0>;
            spidev@0 { reg = <0>; };
        };
        adc: i2c@7e804000 { };
    };
};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO.new_from_string(EMPTY_DTSO, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };
    const example_node = (): DTNode => find_in_example(parse_root(wrap_example(AD7124_EXAMPLE).replace(/#include.*\n/, "").replace("adc@0", "ad7124: adc@0")), c => c.startsWith("adi,"))!.node;

    test("copy_example_node — copied as it is, with the requested compatible", () => {
        const overlay = setup();
        const result = copy_example_node(overlay, "/soc/spi@7e204000", example_node(), { compatible: "adi,ad7124-8" });
        expect(result).toEqual({
            status: "added",
            key: "adc@0",
            path: "/soc/spi@7e204000/adc@0",
            label: "ad7124",
            notes: [{ kind: "compatible-replaced", from: "adi,ad7124-4" }],
        });
        const printed = overlay.print();
        expect(printed).toContain('compatible = "adi,ad7124-8";');
        expect(printed).toContain("interrupt-parent = <&gpio>;");
        expect(printed).toContain("refin1-supply = <&adc_vref>;");
        expect(printed).toContain("channel@0 {");
    });

    test("copy_example_node — the example's own compatible stays", () => {
        const overlay = setup();
        const result = copy_example_node(overlay, "/soc/spi@7e204000", example_node(), { compatible: "adi,ad7124-4" });
        expect(result).toMatchObject({ status: "added", notes: [] });
    });

    test("copy_example_node — a taken example label, no label, an explicit label", () => {
        const overlay = setup();
        const taken = example_node();
        taken.labels = ["adc"];
        expect(copy_example_node(overlay, "/soc/spi@7e204000", taken, { compatible: "adi,ad7124-4" }))
            .toMatchObject({ status: "added", label: "adc_1", notes: [{ kind: "label-renamed", from: "adc", to: "adc_1" }] });

        const unlabelled = example_node();
        unlabelled.labels = [];
        unlabelled.unit_addr = "1";
        expect(copy_example_node(overlay, "/soc/spi@7e204000", unlabelled, { compatible: "adi,ad7124-8" }))
            .toMatchObject({ status: "added", key: "adc@1", label: "ad7124_8" });

        const explicit = example_node();
        explicit.unit_addr = "2";
        expect(copy_example_node(overlay, "/soc/spi@7e204000", explicit, { compatible: "adi,ad7124-4", label: "gpio" }))
            .toEqual({ status: "label-taken", label: "gpio", owner: "/soc/gpio@7e200000" });
    });

    test("copy_example_node — references to the copied labels follow a rename", () => {
        const overlay = setup();
        const root = parse_root(`/dts-v1/;
/ {
    i2c {
        gpio: expander@20 {
            compatible = "adi,adt7476";
            #pwm-cells = <3>;
            out: fan-0 { pwms = <&gpio 0 44444 0>; trigger = &out; };
            fan-1 { pwms = <&gpio 2 44444 0>, <&adc 1>; };
        };
    };
};`);
        const node = find_in_example(root, c => c === "adi,adt7476")!.node;
        expect(copy_example_node(overlay, "/soc/spi@7e204000", node, { compatible: "adi,adt7475" })).toMatchObject({
            status: "added",
            label: "gpio_1",
            notes: [{ kind: "compatible-replaced", from: "adi,adt7476" }, { kind: "label-renamed", from: "gpio", to: "gpio_1" }],
        });
        const printed = overlay.print();
        expect(printed).toContain("pwms = <&gpio_1 0 44444 0>;");
        // References to labels outside the copy are left as they are.
        expect(printed).toContain("pwms = <&gpio_1 2 44444 0>, <&adc 1>;");
        expect(printed).toContain("out: fan-0");

        const explicit = copy_example_node(overlay, "/soc/spi@7e204000", { ...structuredClone(node), unit_addr: "21" }, { compatible: "adi,adt7475", label: "fans" });
        expect(explicit).toMatchObject({ status: "added", label: "fans" });
        expect(overlay.print()).toContain("pwms = <&fans 0 44444 0>;");
        expect(overlay.print()).toContain("out_1: fan-0");
        expect(overlay.print()).toContain("trigger = &out_1;");
    });

    test("copy_example_node — a child of that name already exists", () => {
        const overlay = setup();
        const node = example_node();
        node.name = "spidev";
        expect(copy_example_node(overlay, "/soc/spi@7e204000", node, { compatible: "adi,ad7124-4" }))
            .toEqual({ status: "duplicate", key: "spidev@0" });
        expect(copy_example_node(overlay, "/soc/nope", example_node(), { compatible: "adi,ad7124-4" }))
            .toEqual({ status: "parent-not-found" });
    });
}
