import { INodeBuilderBase, NodeBuilder, PropertyBuilder } from "./DTBuilder/DTBuilder";
import { DTS, DTO, DTNode, parse_dts, parse_dto, DTLabel, DTPath, get_full_node_name } from "./dts";
import { print_dts, print_dto, print_property, print_node } from "./dts/printer";
import path from 'node:path';
import * as fs from 'node:fs';

type DTReference = {
    node_name: string,
    full_path: DTPath,
    labels: DTLabel[],
};

export type TraversalOrder = "DFS" | "BFS";

class Stream<T, P = never> implements Iterable<[P] extends [never] ? T : [T, P]> {
    constructor(private iterable: Iterable<[P] extends [never] ? T : [T, P]>) { }

    [Symbol.iterator]() {
        return this.iterable[Symbol.iterator]();
    }

    filter(predicate: (value: T, path: P) => boolean): Stream<T, P> {
        // eslint-disable-next-line unicorn/no-this-assignment
        const self = this;

        return new Stream<T, P>(
            (function* () {
                for (const item of self) {
                    if (Array.isArray(item)) {
                        const [value, path] = item as [T, P];
                        if (predicate(value, path)) {
                            yield item;
                        }
                    } else {
                        if (predicate(item as T, undefined as P)) {
                            yield item;
                        }
                    }
                }
            })()
        );
    }

    toArray(): ([P] extends [never] ? T : [T, P])[] {
        return [...this];
    }
}

export class DeviceTree {

    private devicetree: DTS;

    private constructor(devicetree: DTS) {
        this.devicetree = devicetree;
    }

    static new_from_string(devicetree_content: string): DeviceTree | string {
        try {
            const dts = parse_dts(devicetree_content);

            if (typeof dts === 'string') {
                return "Failed to parse!";
            }

            return new DeviceTree(dts);
        } catch (error) {
            return error instanceof Error ? error.message : "Failed to parse!";
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

        deref_parent.children = deref_parent.children.filter((entry) => get_full_node_name(entry) === target.node_name);

        return;
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

    static node_to_ref(node: DTNode, path: DTPath): DTReference {
        return {
            node_name: get_full_node_name(node),
            full_path: path,
            labels: node.labels.map(entry => ({ kind: "label", labels: [], name: entry }))
        };
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
}