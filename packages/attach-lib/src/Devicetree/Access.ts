import { type DTLabel, type DTNode, type DTPath, type DTProperty, is_dt_flag, get_full_node_name } from "./Parser/AST.js";

export type LocatedNode = { node: DTNode; path: string };

export type NodeTarget = DTLabel | DTPath | string;

export function normalize_target(target: NodeTarget): DTLabel | DTPath {
    if (typeof target === "string") {
        return target.startsWith("/")
            ? { kind: "path", labels: [], path: target }
            : { kind: "label", labels: [], name: target };
    }
    return target;
}

export function cell_extract_first_value(property: DTProperty): bigint | string | undefined {
    if (is_dt_flag(property.value)) { return; }
    const first = property.value[0];
    if (first === undefined || first.kind !== 'array') { return; }
    const element = first.elements[0];
    if (element === undefined) { return; }
    switch (element.kind) {
        case "number": { return element.value; }
        case "expression": { return element.value; }
        case "label": { return element.name; }
        case "path": { return element.path; }
        default: {
            const _x: never = element;
            throw new Error("Failed exhaustive check!");
        }
    }
}

function find_cell_array(node: DTNode, name: string) {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return; }
    const first = property.value[0];
    if (first === undefined || first.kind !== "array") { return; }
    return first;
}

export function number_property(node: DTNode, name: string): bigint | undefined {
    const cell_array = find_cell_array(node, name);
    if (cell_array === undefined || cell_array.elements.length !== 1) { return; }
    const element = cell_array.elements[0];
    if (element === undefined) { return; }
    if (element.kind === "number") { return element.value; }
    if (element.kind === "expression" && typeof element.value === "bigint") { return element.value; }
    return;
}

export function reference_property(node: DTNode, name: string): string | undefined {
    const cell_array = find_cell_array(node, name);
    if (cell_array === undefined || cell_array.elements.length !== 1) { return; }
    const element = cell_array.elements[0];
    if (element?.kind === "label") { return element.name; }
    if (element?.kind === "path") { return element.path; }
    return;
}

export function extract_first_number(node: DTNode, name: string): bigint | undefined {
    const cell_array = find_cell_array(node, name);
    if (cell_array === undefined) { return; }
    const element = cell_array.elements[0];
    if (element === undefined) { return; }
    if (element.kind === "number") { return element.value; }
    if (element.kind === "expression" && typeof element.value === "bigint") { return element.value; }
    return;
}

export function extract_first_reference(node: DTNode, name: string): string | undefined {
    const cell_array = find_cell_array(node, name);
    if (cell_array === undefined) { return; }
    const element = cell_array.elements[0];
    if (element?.kind === "label") { return element.name; }
    if (element?.kind === "path") { return element.path; }
    return;
}

export function string_property(node: DTNode, name: string): string | undefined {
    const property = node.properties.find(p => p.name === name);
    if (property === undefined || is_dt_flag(property.value)) { return undefined; }
    const first = property.value[0];
    return first?.kind === "string" ? first.value : undefined;
}

export function has_flag(node: DTNode, name: string): boolean {
    const property = node.properties.find(p => p.name === name);
    return property !== undefined && is_dt_flag(property.value);
}

export function has_property(node: DTNode, name: string): boolean {
    return node.properties.some(p => p.name === name);
}

export function has_compatible(node: DTNode, compatible: string): boolean {
    const property = node.properties.find(p => p.name === "compatible");
    if (property === undefined || is_dt_flag(property.value)) { return false; }
    return property.value.some(v => v.kind === "string" && v.value === compatible);
}

export function is_enabled(node: DTNode): boolean {
    const status = node.properties.find(p => p.name === "status");
    if (status === undefined || is_dt_flag(status.value)) { return true; }
    const first = status.value[0];
    return !(first?.kind === "string" && first.value === "disabled");
}

export function parent_path(path: string): string | undefined {
    if (path === "/" || path === "") { return undefined; }
    const last = path.lastIndexOf("/");
    return last <= 0 ? "/" : path.slice(0, last);
}

export function node_name_of(path: string): string {
    return path.slice(path.lastIndexOf("/") + 1);
}

export function patch_node(base: DTNode, patch: DTNode): DTNode {
    return {
        ...base,
        properties: [
            ...base.properties.filter(p => !patch.properties.some(o => o.name === p.name)),
            ...patch.properties,
        ],
        children: [
            ...base.children.filter(c => !patch.children.some(o => get_full_node_name(o) === get_full_node_name(c))),
            ...patch.children,
        ],
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const dts = async (source: string) => {
        const { DeviceTree } = await import("./Devicetree.js");
        const dt = DeviceTree.new_from_string(source);
        if (typeof dt === "string") { throw new TypeError(dt); }
        return dt;
    };

    test("number_property reads a single-cell number", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    node {
        #interrupt-cells = <3>;
        reg = <0x48 0x400>;
    };
};`);
        const node = dt.as_stream().toArray().find(({ node }) => node.name === "node")!.node;
        expect(number_property(node, "#interrupt-cells")).toBe(3n);
        expect(number_property(node, "reg")).toBeUndefined();
        expect(number_property(node, "missing")).toBeUndefined();
    });

    test("extract_first_number reads first cell from any array", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    node {
        #interrupt-cells = <3>;
        reg = <0x48 0x400>;
    };
};`);
        const node = dt.as_stream().toArray().find(({ node }) => node.name === "node")!.node;
        expect(extract_first_number(node, "#interrupt-cells")).toBe(3n);
        expect(extract_first_number(node, "reg")).toBe(0x48n);
    });

    test("reference_property reads a single-cell reference", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    gic: gic { };
    osc: osc { };
    node {
        interrupt-parent = <&gic>;
        clocks = <&osc 0>;
    };
};`);
        const node = dt.as_stream().toArray().find(({ node }) => node.name === "node")!.node;
        expect(reference_property(node, "interrupt-parent")).toBe("gic");
        expect(reference_property(node, "clocks")).toBeUndefined();
    });

    test("extract_first_reference reads first cell from any array", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    gic: gic { };
    osc: osc { };
    node {
        interrupt-parent = <&gic>;
        clocks = <&osc 0>;
    };
};`);
        const node = dt.as_stream().toArray().find(({ node }) => node.name === "node")!.node;
        expect(extract_first_reference(node, "interrupt-parent")).toBe("gic");
        expect(extract_first_reference(node, "clocks")).toBe("osc");
    });

    test("string_property reads a string value", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    node {
        status = "okay";
    };
};`);
        const node = dt.as_stream().toArray().find(({ node }) => node.name === "node")!.node;
        expect(string_property(node, "status")).toBe("okay");
    });

    test("has_flag / has_property / has_compatible", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    node {
        compatible = "fixed-clock";
        interrupt-controller;
        #interrupt-cells = <3>;
    };
};`);
        const node = dt.as_stream().toArray().find(({ node }) => node.name === "node")!.node;
        expect(has_flag(node, "interrupt-controller")).toBe(true);
        expect(has_flag(node, "#interrupt-cells")).toBe(false);
        expect(has_property(node, "#interrupt-cells")).toBe(true);
        expect(has_property(node, "missing")).toBe(false);
        expect(has_compatible(node, "fixed-clock")).toBe(true);
        expect(has_compatible(node, "other")).toBe(false);
    });

    test("is_enabled", async () => {
        const dt = await dts(`/dts-v1/;
/ {
    a { };
    b { status = "okay"; };
    c { status = "disabled"; };
};`);
        const nodes = dt.as_stream().toArray();
        const a = nodes.find(({ node }) => node.name === "a")!.node;
        const b = nodes.find(({ node }) => node.name === "b")!.node;
        const c = nodes.find(({ node }) => node.name === "c")!.node;
        expect(is_enabled(a)).toBe(true);
        expect(is_enabled(b)).toBe(true);
        expect(is_enabled(c)).toBe(false);
    });

    test("parent_path", () => {
        expect(parent_path("/")).toBeUndefined();
        expect(parent_path("/soc")).toBe("/");
        expect(parent_path("/soc/spi@7e204000")).toBe("/soc");
    });

    test("node_name_of", () => {
        expect(node_name_of("/soc/spi@7e204000")).toBe("spi@7e204000");
        expect(node_name_of("/")).toBe("");
    });

    test("patch_node merges properties and children", () => {
        const flag = { kind: "flag" as const };
        const base: DTNode = {
            name: "node", unit_addr: undefined, labels: [],
            properties: [
                { name: "a", value: flag, labels: [] },
                { name: "b", value: flag, labels: [] },
            ],
            children: [],
        };
        const overlay: DTNode = {
            name: "node", unit_addr: undefined, labels: [],
            properties: [{ name: "b", value: flag, labels: [] }],
            children: [],
        };
        const result = patch_node(base, overlay);
        expect(result.properties.map(p => p.name)).toStrictEqual(["a", "b"]);
    });
}
