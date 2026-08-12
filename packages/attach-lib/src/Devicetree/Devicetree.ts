import { INodeBuilderBase } from "./NodeBuilder";
import { PropertyBuilder } from "./PropertyBuilder";

import {
    print_dts,
    DTS,
    DTNode,
    parse_dts,
    DTLabel,
    DTPath,
    get_full_node_name,
    DTProperty,
    is_dt_flag
} from "./parser";

import path from 'node:path';
import * as fs from 'node:fs';
import { Result } from "../result";
import { DTReference, TraversalOrder, UnitAddr } from "./Types";
import { Stream } from "./Stream";

function format_unit_addr_part(addr: UnitAddr): string {
    return addr.repr === "hex"
        ? addr.value.toString(16)
        : addr.value.toString(10);
}

export class DeviceTree {

    private devicetree: DTS;

    private constructor(devicetree: DTS) {
        this.devicetree = devicetree;
    }

    static new_from_string(devicetree_content: string): DeviceTree | string {
        try {
            const dts = parse_dts(devicetree_content);

            if (Result.is_err(dts)) {
                return "Failed to parse!";
            }

            return new DeviceTree(dts.value.dts);
        } catch (error) {
            return error instanceof Error ? error.message : "Failed to parse!";
        }
    }

    static new_from_file(file_path: string): DeviceTree | string {
        try {
            const content = fs.readFileSync(file_path, 'utf8');
            return DeviceTree.new_from_string(content);
        } catch (error) {
            return error instanceof Error ? error.message : "Failed to read file!";
        }
    }

    static new_empty(): DeviceTree {
        return new DeviceTree(
            {
                memreserves: [],
                root: {
                    name: "/",
                    unit_addr: undefined,
                    labels: [],
                    children: [],
                    properties: [],
                },
            },
        );
    }

    public as_stream(order: TraversalOrder = "DFS"): Stream<DTNode, DTPath> {
        return new Stream(this.as_generator(this.devicetree.root, "/", order));
    }

    private *as_generator(root: DTNode, currentPath: string, order: TraversalOrder): Generator<[DTNode, DTPath]> {
        const make_path = (p: string): DTPath => ({ kind: "path", labels: [], path: p });

        if (order === "DFS") {
            yield [root, make_path(currentPath)];

            for (const child of root.children) {
                const childPath = currentPath === "/"
                    ? `/${get_full_node_name(child)}`
                    : `${currentPath}/${get_full_node_name(child)}`;

                yield* this.as_generator(child, childPath, order);
            }
        } else {
            const queue: [DTNode, string][] = [[root, currentPath]];

            while (queue.length > 0) {
                const [node, nodePath] = queue.shift()!;

                yield [node, make_path(nodePath)];

                for (const child of node.children) {
                    const childPath = nodePath === "/"
                        ? `/${get_full_node_name(child)}`
                        : `${nodePath}/${get_full_node_name(child)}`;

                    queue.push([child, childPath]);
                }
            }
        }
    }

    public add_node(node: INodeBuilderBase, parent: DTReference): DTNode | undefined {
        const target = this.deref_node(parent);

        if (target === undefined) {
            return undefined;
        }

        target.children.push(node.build());

        return;
    }

    public remove_node(target: DTReference): DTNode | undefined {
        const target_parent = this.get_parent(target);

        if (target_parent === undefined) {
            return undefined;
        }

        const deref_parent = this.deref_node(target_parent);

        if (deref_parent === undefined) {
            return undefined;
        }

        deref_parent.children = deref_parent.children.filter((entry) => get_full_node_name(entry) !== target.node_name);

        return;
    }

    public move_node(target: DTReference, new_parent: DTReference): DTReference | undefined {
        const node = this.deref_node(target);
        if (node === undefined) {
            return undefined;
        }

        this.remove_node(target);

        const new_parent_node = this.deref_node(new_parent);
        if (new_parent_node === undefined) {
            return undefined;
        }

        new_parent_node.children.push(node);

        const new_path = new_parent.full_path.path === "/"
            ? `/${get_full_node_name(node)}`
            : `${new_parent.full_path.path}/${get_full_node_name(node)}`;

        return DeviceTree.node_to_ref(node, { kind: "path", labels: [], path: new_path });
    }

    public rename_node(target: DTReference, new_name: string): boolean {
        const node = this.deref_node(target);
        if (node === undefined) {
            return false;
        }

        node.name = new_name;
        return true;
    }

    public set_unit_addr(target: DTReference, addr: UnitAddr | UnitAddr[] | undefined): boolean {
        const node = this.deref_node(target);
        if (node === undefined) {
            return false;
        }

        if (addr === undefined) {
            node.unit_addr = undefined;
            return true;
        }

        const parts = Array.isArray(addr) ? addr : [addr];
        node.unit_addr = parts.map((element) => format_unit_addr_part(element)).join(",");
        return true;
    }

    public set_status(target: DTReference, status: "okay" | "disabled" | "reserved" | "fail" | "fail-sss"): boolean {
        const property = PropertyBuilder.build_string()
            .with_value(status)
            .with_name("status")
            .build();

        return this.set_property(target, property);
    }

    public get_parent(target: DTReference): DTReference | undefined {
        // eslint-disable-next-line unicorn/consistent-function-scoping
        const make_path = (p: string): DTPath => ({ kind: "path", labels: [], path: p });

        const path = target.full_path.path;

        if (path === "/") {
            return undefined;
        }

        const segments = path.split("/").filter(s => s.length > 0);
        segments.pop();

        const parent_path = segments.length === 0 ? "/" : "/" + segments.join("/");

        const parent_node = this.deref_node_by_path(parent_path);

        if (parent_node === undefined) {
            return undefined;
        }

        return DeviceTree.node_to_ref(parent_node, make_path(parent_path));
    }

    public get_node_by_label(label: DTLabel): DTReference | undefined {
        for (const [node, path] of this.as_stream()) {
            if (node.labels.includes(label.name)) {
                return DeviceTree.node_to_ref(node, path);
            }
        }

        return undefined;
    }

    public get_node_by_path(path: DTPath): DTReference | undefined {
        const node = this.deref_node_by_path(path.path);
        if (node === undefined) {
            return undefined;
        }

        return DeviceTree.node_to_ref(node, path);
    }

    /**
     * Accept any of the four CLI identifier forms and return the corresponding
     * DTLabel or DTPath if the node exists, or undefined if not found.
     * Accepted forms: &label  |  bare-label  |  /abs/path  |  &{/abs/path}
     */
    public resolve_identifier(identifier: string): DTLabel | DTPath | undefined {
        const stripped = identifier.startsWith("&") ? identifier.slice(1) : identifier;

        if (stripped.startsWith("{/") && stripped.endsWith("}")) {
            const abs = stripped.slice(1, -1);
            const dt_path: DTPath = { kind: "path", labels: [], path: abs };
            return this.get_node_by_path(dt_path) === undefined ? undefined : dt_path;
        }

        if (identifier.startsWith("/")) {
            const dt_path: DTPath = { kind: "path", labels: [], path: identifier };
            return this.get_node_by_path(dt_path) === undefined ? undefined : dt_path;
        }

        const dt_label: DTLabel = { kind: "label", labels: [], name: stripped };
        return this.get_node_by_label(dt_label) === undefined ? undefined : dt_label;
    }

    public get_nodes_with_compatible(compatible: string): DTReference[] {
        const results: DTReference[] = [];

        for (const [node, path] of this.as_stream()) {
            const compat_property = node.properties.find(p => p.name === "compatible");
            if (compat_property === undefined || is_dt_flag(compat_property.value)) {
                continue;
            }

            const has_match = compat_property.value.some(v => v.kind === "string" && v.value === compatible);
            if (has_match) {
                results.push(DeviceTree.node_to_ref(node, path));
            }
        }

        return results;
    }

    static node_to_ref(node: DTNode, path: DTPath): DTReference {
        return {
            node_name: get_full_node_name(node),
            full_path: path,
            labels: node.labels.map(entry => ({ kind: "label", labels: [], name: entry }))
        };
    }

    public get_property(target_node: DTReference, property: string): DTProperty | undefined {
        const node = this.deref_node(target_node);
        if (node === undefined) {
            return undefined;
        }

        return node.properties.find(p => p.name === property);
    }

    public set_property(target_node: DTReference, property: DTProperty): boolean {
        const node = this.deref_node(target_node);
        if (node === undefined) {
            return false;
        }

        const existing_index = node.properties.findIndex(p => p.name === property.name);
        if (existing_index === -1) {
            node.properties.push(property);
        } else {
            node.properties[existing_index] = property;
        }

        return true;
    }

    public remove_property(target_node: DTReference, property: string): boolean {
        const node = this.deref_node(target_node);
        if (node === undefined) {
            return false;
        }

        const original_length = node.properties.length;
        node.properties = node.properties.filter(p => p.name !== property);

        return node.properties.length < original_length;
    }

    public deref_node(reference: DTReference): DTNode | undefined {
        return this.deref_node_by_path(reference.full_path.path);
    }

    private deref_node_by_path(path: string): DTNode | undefined {
        if (path === "/") {
            return this.devicetree.root;
        }

        const segments = path.split("/").filter(s => s.length > 0);

        let current: DTNode = this.devicetree.root;
        for (const segment of segments) {
            const child = current.children.find(c => get_full_node_name(c) === segment);
            if (child === undefined) {
                return undefined;
            }
            current = child;
        }

        return current;
    }

    public print(): string {
        return print_dts(this.devicetree);
    }
}

if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

    test("Print empty DTS", () => {
        const dt = DeviceTree.new_empty();
        const dts = dt.print();

        expect(dts).toStrictEqual(`/dts-v1/;
/ {
};
`);
    });

    test("Overwrite node and print DTS", () => {

        const dts_path = path.resolve(__dirname, '../test/dts_source', 'rpi.prepro.dts');
        const content = fs.readFileSync(dts_path, 'utf8');

        const dt = DeviceTree.new_from_string(content);

        if (typeof dt === 'string') {
            expect(false);
            return;
        }

        console.log("TREE:");
        for (const [node, path] of dt.as_stream().filter((node) => node.name === 'spi')) {
            console.log(DeviceTree.node_to_ref(node, path));
        }
        console.log("==================================");

    });

    const base_dts_source = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
        };
    };
};`;

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    test("resolve_identifier - finds node by label", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const result = base.resolve_identifier("spi0");
        expect(result).toBeDefined();
        expect(result?.kind).toBe("label");
    });

    test("resolve_identifier - finds node by &label", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const result = base.resolve_identifier("&spi0");
        expect(result).toBeDefined();
        expect(result?.kind).toBe("label");
    });

    test("resolve_identifier - finds node by path", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        expect(base.resolve_identifier("/soc/spi@7e204000")).toBeDefined();
    });

    test("resolve_identifier - returns undefined for unknown label", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        expect(base.resolve_identifier("nonexistent")).toBeUndefined();
    });
}