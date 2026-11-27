import { INodeBuilderBase } from "./build/NodeBuilder.js";
import { PropertyBuilder } from "./build/PropertyBuilder.js";

import {
	print_dts,
	DTS,
	DTNode,
	parse_dts,
	DTLabel,
	DTPath,
	get_full_node_name,
	DTProperty,
	format_parse_error,
	is_dt_flag,
} from "./syntax/index.js";

import { Result } from "../result.js";
import type { UnitAddr } from "./nodes/UnitAddress.js";
import { type LocatedNode, type NodeTarget, normalize_target, parent_path as access_parent_path, has_compatible } from "./nodes/Access.js";

export class Stream<T> implements Iterable<T> {
	constructor(private iterable: Iterable<T>) { }

	[Symbol.iterator]() {
		return this.iterable[Symbol.iterator]();
	}

	filter(predicate: (value: T) => boolean): Stream<T> {
		// eslint-disable-next-line unicorn/no-this-assignment
		const self = this;

		return new Stream<T>(
			(function* () {
				for (const item of self) {
					if (predicate(item)) {
						yield item;
					}
				}
			})()
		);
	}

	toArray(): T[] {
		return [...this];
	}
}

/** Every node of the tree under `root` (at `path`) with its path, depth-first, `root` first. */
export function* walk_nodes(root: DTNode, path: string): Generator<LocatedNode> {
	yield { node: root, path };
	for (const child of root.children) {
		const name = get_full_node_name(child);
		yield* walk_nodes(child, path === "/" ? `/${name}` : `${path}/${name}`);
	}
}

/** The first node under `root`, depth-first, `root` first, that has the label, with its path: `walk_nodes`, building only the path it returns. */
function find_label(root: DTNode, label: string): LocatedNode | undefined {
	const trail: DTNode[] = [];
	const search = (node: DTNode): DTNode | undefined => {
		if (node.labels.includes(label)) { return node; }
		for (const child of node.children) {
			trail.push(child);
			const found = search(child);
			if (found !== undefined) { return found; }
			trail.pop();
		}
		return undefined;
	};
	const node = search(root);
	return node === undefined ? undefined : { node, path: `/${trail.map(entry => get_full_node_name(entry)).join("/")}` };
}

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
				return `Failed to parse: ${format_parse_error(dts.error)}`;
			}

			return new DeviceTree(dts.value.dts);
		} catch (error) {
			return error instanceof Error ? error.message : "Failed to parse!";
		}
	}

	/** A tree from a root built elsewhere, such as an overlay merged with its base (`DeviceTreeOverlay.merged_tree`). */
	static new_from_root(root: DTNode): DeviceTree {
		return new DeviceTree({ memreserves: [], root });
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

	public as_stream(): Stream<LocatedNode> {
		return new Stream(walk_nodes(this.devicetree.root, "/"));
	}

	public add_node(node: INodeBuilderBase, parent: NodeTarget): DTNode | undefined {
		const located = this.locate(parent);
		if (located === undefined) { return undefined; }

		located.node.children.push(node.build());

		return;
	}

	public remove_node(target: NodeTarget): DTNode | undefined {
		const located = this.locate(target);
		if (located === undefined) { return undefined; }

		const parent = this.get_parent(located.path);
		if (parent === undefined) { return undefined; }

		const node_name = located.path.slice(located.path.lastIndexOf("/") + 1);
		parent.node.children = parent.node.children.filter(entry => get_full_node_name(entry) !== node_name);

		return;
	}

	public move_node(target: NodeTarget, new_parent: NodeTarget): LocatedNode | undefined {
		const located = this.locate(target);
		if (located === undefined) { return undefined; }

		this.remove_node(located.path);

		const new_parent_located = this.locate(new_parent);
		if (new_parent_located === undefined) { return undefined; }

		new_parent_located.node.children.push(located.node);

		const new_path = new_parent_located.path === "/"
			? `/${get_full_node_name(located.node)}`
			: `${new_parent_located.path}/${get_full_node_name(located.node)}`;

		return { node: located.node, path: new_path };
	}

	public rename_node(target: NodeTarget, new_name: string): boolean {
		const located = this.locate(target);
		if (located === undefined) { return false; }

		located.node.name = new_name;
		return true;
	}

	public set_unit_addr(target: NodeTarget, addr: UnitAddr | UnitAddr[] | undefined): boolean {
		const located = this.locate(target);
		if (located === undefined) { return false; }

		if (addr === undefined) {
			located.node.unit_addr = undefined;
			return true;
		}

		const parts = Array.isArray(addr) ? addr : [addr];
		located.node.unit_addr = parts.map(element => format_unit_addr_part(element)).join(",");
		return true;
	}

	public set_status(target: NodeTarget, status: "okay" | "disabled" | "reserved" | "fail" | "fail-sss"): boolean {
		const property = PropertyBuilder.build_string()
			.with_value(status)
			.with_name("status")
			.build();

		return this.set_property(target, property);
	}

	public get_parent(target: NodeTarget): LocatedNode | undefined {
		const located = this.locate(target);
		if (located === undefined) { return undefined; }

		const pp = access_parent_path(located.path);
		if (pp === undefined) { return undefined; }

		const parent_node = this.node_at(pp);
		if (parent_node === undefined) { return undefined; }

		return { node: parent_node, path: pp };
	}

	public locate(target: NodeTarget): LocatedNode | undefined {
		const t = normalize_target(target);
		if (t.kind === "path") {
			const node = this.node_at(t.path);
			return node === undefined ? undefined : { node, path: t.path };
		}
		return find_label(this.devicetree.root, t.name);
	}

	public node_exists(target: NodeTarget): boolean {
		const t = normalize_target(target);
		if (t.kind === "path") { return this.node_at(t.path) !== undefined; }
		return find_label(this.devicetree.root, t.name) !== undefined;
	}

	/**
	 * The absolute path the alias `name` of `/aliases` names: a string, or a
	 * `&label` / `&{/path}` reference as the source writes it. Undefined when
	 * the tree has no such alias or it names no node.
	 */
	public alias_path(name: string): string | undefined {
		const alias = this.node_at("/aliases")?.properties.find(p => p.name === name);
		if (alias === undefined || is_dt_flag(alias.value)) { return undefined; }
		const [value] = alias.value;
		if (value?.kind === "string") { return this.node_exists(value.value) ? value.value : undefined; }
		if (value?.kind === "path") { return this.node_exists(value.path) ? value.path : undefined; }
		if (value?.kind === "label") { return this.locate(value.name.startsWith("&") ? value.name.slice(1) : value.name)?.path; }
		return undefined;
	}

	public resolve_identifier(identifier: string): DTLabel | DTPath | undefined {
		const stripped = identifier.startsWith("&") ? identifier.slice(1) : identifier;

		if (stripped.startsWith("{/") && stripped.endsWith("}")) {
			const abs = stripped.slice(1, -1);
			if (this.node_at(abs) === undefined) { return undefined; }
			return { kind: "path", labels: [], path: abs };
		}

		if (identifier.startsWith("/")) {
			if (this.node_at(identifier) === undefined) { return undefined; }
			return { kind: "path", labels: [], path: identifier };
		}

		const dt_label: DTLabel = { kind: "label", labels: [], name: stripped };
		return this.node_exists(dt_label) ? dt_label : undefined;
	}

	public get_nodes_with_compatible(compatible: string): LocatedNode[] {
		return this.as_stream()
			.filter(located => has_compatible(located.node, compatible))
			.toArray();
	}

	public get_property(target: NodeTarget, property: string): DTProperty | undefined {
		const located = this.locate(target);
		if (located === undefined) { return undefined; }

		return located.node.properties.find(p => p.name === property);
	}

	public set_property(target: NodeTarget, property: DTProperty): boolean {
		const located = this.locate(target);
		if (located === undefined) { return false; }

		const existing_index = located.node.properties.findIndex(p => p.name === property.name);
		if (existing_index === -1) {
			located.node.properties.push(property);
		} else {
			located.node.properties[existing_index] = property;
		}

		return true;
	}

	public remove_property(target: NodeTarget, property: string): boolean {
		const located = this.locate(target);
		if (located === undefined) { return false; }

		const original_length = located.node.properties.length;
		located.node.properties = located.node.properties.filter(p => p.name !== property);

		return located.node.properties.length < original_length;
	}

	public node_at(path: string): DTNode | undefined {
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

	const base_dts_source = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
        };
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

	test("locate - a label names the first node that has it, depth-first, with its path", () => {
		const tree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            twice: adc@0 { reg = <0>; };
        };
        twice: spi@7e204800 { };
    };
};`);
		if (typeof tree === "string") { throw new TypeError(tree); }
		expect(tree.locate("spi0")?.path).toBe("/soc/spi@7e204000");
		expect(tree.locate("twice")?.path).toBe("/soc/spi@7e204000/adc@0");
		expect(tree.locate("twice")?.node.properties.map(p => p.name)).toEqual(["reg"]);
		expect(tree.locate("missing")).toBeUndefined();
		expect(tree.node_exists({ kind: "label", labels: [], name: "spi0" })).toBe(true);
		expect(tree.node_exists({ kind: "label", labels: [], name: "missing" })).toBe(false);
	});
}
