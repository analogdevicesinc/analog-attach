import { INodeBuilderBase, NodeBuilder } from "./NodeBuilder";
import { PropertyBuilder } from "./PropertyBuilder";

import {
    DTLabel,
    DTNode,
    DTPath,
    get_full_node_name,
    DTProperty,
    is_dt_flag,
    DTO,
    parse_dto,
    print_dto,
    format_parse_error
} from "./Parser";

import * as fs from 'node:fs';
import { Result } from "../result";
import { DeviceTree } from "./Devicetree";
import { FoundNodeResult, TraversalOrder } from "./Types";
import { Stream } from "./Stream";
import { type LocatedNode, type NodeTarget, normalize_target, patch_node, parent_path as access_parent_path } from "./Access";

export class DeviceTreeOverlay {

    private overlay: DTO;
    private readonly base_dts: DeviceTree | undefined;

    private constructor(overlay: DTO, base_dts: DeviceTree | undefined) {
        this.overlay = overlay;
        this.base_dts = base_dts;
    }

    static new_from_string(content: string, base_dts?: DeviceTree): DeviceTreeOverlay | string {
        try {
            const dto = parse_dto(content);

            if (Result.is_err(dto)) {
                return `Failed to parse overlay: ${format_parse_error(dto.error)}`;
            }

            return new DeviceTreeOverlay(dto.value.dto, base_dts);
        } catch (error) {
            return error instanceof Error ? error.message : "Failed to parse overlay!";
        }
    }

    static new_from_file(file_path: string, base_dts?: DeviceTree): DeviceTreeOverlay | string {
        try {
            const content = fs.readFileSync(file_path, 'utf8');
            return DeviceTreeOverlay.new_from_string(content, base_dts);
        } catch (error) {
            return error instanceof Error ? error.message : "Failed to read file!";
        }
    }

    static new_empty(base_dts?: DeviceTree): DeviceTreeOverlay {
        return new DeviceTreeOverlay(
            {
                root: {
                    name: "/",
                    unit_addr: undefined,
                    labels: [],
                    children: [],
                    properties: [],
                },
            },
            base_dts,
        );
    }

    public get_base_dts(): DeviceTree | undefined {
        return this.base_dts;
    }

    public add_fragment(
        target: NodeTarget,
        nodes: INodeBuilderBase | undefined,
        properties: DTProperty | DTProperty[] | undefined
    ): boolean {
        const existing = this.find_fragment(target);

        if (existing !== undefined) {
            const overlay_node = existing.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) {
                return false;
            }

            if (nodes !== undefined) {
                overlay_node.children.push(nodes.build());
            }

            if (properties !== undefined) {
                const properties_ = Array.isArray(properties) ? properties : [properties];
                for (const property of properties_) {
                    const index = overlay_node.properties.findIndex(p => p.name === property.name);
                    if (index === -1) {
                        overlay_node.properties.push(property);
                    } else {
                        overlay_node.properties[index] = property;
                    }
                }
            }

            return true;
        }

        if (this.base_dts !== undefined && !this.base_dts.node_exists(target)) {
            return false;
        }

        this.create_fragment(target, nodes, properties);

        return true;
    }

    /**
     * The overlay node that writes to the node at absolute `path`: the existing
     * overlay node, or the `__overlay__` of a fragment targeting the base node
     * (reused or created, by label when the base node has one).
     */
    public ensure_node(path: string): DTNode | undefined {
        const found = this.find_node(path);
        if (found !== undefined) { return found.node; }

        const located = this.base_dts?.locate(path);
        if (this.base_dts !== undefined && located === undefined) { return undefined; }

        const label = located?.node.labels[0];
        const target: DTLabel | DTPath = label === undefined
            ? { kind: "path", labels: [], path: located?.path ?? path }
            : { kind: "label", labels: [], name: label };
        // eslint-disable-next-line unicorn/no-useless-undefined
        if (!this.add_fragment(target, undefined, undefined)) { return undefined; }
        return this.find_node(target)?.node;
    }

    private find_fragment(target: NodeTarget): DTNode | undefined {
        const normalized = normalize_target(target);
        for (const fragment of this.get_fragments()) {
            if (normalized.kind === "label") {
                const property = fragment.properties.find(p => p.name === "target");
                if (property === undefined || is_dt_flag(property.value)) {
                    continue;
                }
                const matches = property.value.some(v =>
                    v.kind === "array" && v.elements.some(element => element.kind === "label" && element.name === normalized.name)
                );
                if (matches) {
                    return fragment;
                }
            } else if (normalized.kind === "path") {
                const target_path_property = fragment.properties.find(p => p.name === "target-path");
                if (target_path_property !== undefined && !is_dt_flag(target_path_property.value)) {
                    const matches = target_path_property.value.some(v => v.kind === "string" && v.value === normalized.path);
                    if (matches) { return fragment; }
                }

                const target_property = fragment.properties.find(p => p.name === "target");
                if (target_property !== undefined && !is_dt_flag(target_property.value)) {
                    const matches = target_property.value.some(v =>
                        v.kind === "array" && v.elements.some(element => element.kind === "path" && element.path === normalized.path)
                    );
                    if (matches) { return fragment; }
                }
            }
        }

        return undefined;
    }

    private next_fragment_unit_addr(): number {
        let max = -1;
        for (const fragment of this.get_fragments()) {
            if (fragment.unit_addr === undefined) { continue; }
            const n = Number.parseInt(fragment.unit_addr, 10);
            if (!Number.isNaN(n) && n > max) { max = n; }
        }
        return max + 1;
    }

    private create_fragment(
        target: NodeTarget,
        node: INodeBuilderBase | undefined,
        properties: DTProperty | DTProperty[] | undefined
    ): DTNode {
        const normalized = normalize_target(target);

        const targetProperty = normalized.kind === "label"
            ? PropertyBuilder.build_cell_array()
                .with_tagged_values(PropertyBuilder.tag_label(normalized.name))
                .with_name("target")
                .build()
            : PropertyBuilder.build_string()
                .with_value(normalized.path)
                .with_name("target-path")
                .build();

        const overlayNode = NodeBuilder.new()
            .with_name("__overlay__")
            .with_children(node)
            .with_properties(properties);

        const fragment = NodeBuilder.new()
            .with_name("fragment")
            .with_unit_address(this.next_fragment_unit_addr().toString())
            .with_properties(targetProperty)
            .with_children(overlayNode)
            .build();

        this.overlay.root.children.push(fragment);
        return fragment;
    }

    public remove_node(target: NodeTarget): boolean {
        const found = this.find_node(target);
        if (found === undefined || found.parent_node === undefined) { return false; }

        const node_name = get_full_node_name(found.node);
        found.parent_node.children = found.parent_node.children.filter(c => get_full_node_name(c) !== node_name);

        this.cleanup_empty_fragments();
        return true;
    }

    public remove_property(target: NodeTarget, property: string): boolean {
        const found = this.find_node(target);
        if (found === undefined) { return false; }

        const index = found.node.properties.findIndex(p => p.name === property);
        if (index === -1) { return false; }

        found.node.properties.splice(index, 1);

        this.cleanup_empty_fragments();
        return true;
    }

    private cleanup_empty_fragments(): void {
        this.overlay.root.children = this.overlay.root.children.filter(child => {
            if (child.name !== "fragment") { return true; }
            const overlay_node = child.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) { return true; }
            return overlay_node.children.length > 0 || overlay_node.properties.length > 0;
        });
        this.renumber_fragments();
    }

    public get_fragment_root_path(fragment: DTNode): string | undefined {
        // label-targeted: target = <&label>
        const target_property = fragment.properties.find(p => p.name === "target");

        if (target_property !== undefined && !is_dt_flag(target_property.value)) {
            for (const v of target_property.value) {
                if (v.kind !== "array") { continue; }

                for (const element of v.elements) {
                    if (element.kind === "label") {
                        const name = element.name.startsWith("&") ? element.name.slice(1) : element.name;

                        if (this.base_dts !== undefined) {
                            const located = this.base_dts.locate(name);

                            if (located !== undefined) { return located.path; }
                        }

                        return undefined;
                    }

                    if (element.kind === "path") {
                        if (this.base_dts !== undefined && this.base_dts.node_exists(element.path)) {
                            return element.path;
                        }
                        return undefined;
                    }
                }
            }
        }

        // path-targeted: target-path = "/abs/path"
        const target_path_property = fragment.properties.find(p => p.name === "target-path");

        if (target_path_property !== undefined && !is_dt_flag(target_path_property.value)) {
            for (const v of target_path_property.value) {
                if (v.kind === "string") { return v.value; }
            }
        }

        return undefined;
    }

    private renumber_fragments(): void {
        let index = 0;

        for (const fragment of this.get_fragments()) {
            fragment.unit_addr = index.toString();
            index++;
        }
    }

    public as_stream(order: TraversalOrder = "DFS"): Stream<LocatedNode> {
        return new Stream(this.as_generator(this.overlay.root, "/", order));
    }

    private *as_generator(root: DTNode, currentPath: string, order: TraversalOrder): Generator<LocatedNode> {
        if (order === "DFS") {
            yield { node: root, path: currentPath };

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

                yield { node, path: nodePath };

                for (const child of node.children) {
                    const childPath = nodePath === "/"
                        ? `/${get_full_node_name(child)}`
                        : `${nodePath}/${get_full_node_name(child)}`;

                    queue.push([child, childPath]);
                }
            }
        }
    }

    public get_fragments(): DTNode[] {
        return this.as_stream()
            .filter(({ node }) => node.name === "fragment")
            .toArray()
            .map(({ node }) => node);
    }

    public find_node(target: NodeTarget): FoundNodeResult | undefined {
        const t = normalize_target(target);
        if (t.kind === "path") {
            const path = t.path;

            for (const fragment of this.get_fragments()) {
                const overlay_node = fragment.children.find(c => c.name === "__overlay__");
                if (overlay_node === undefined) { continue; }

                const root_path = this.get_fragment_root_path(fragment) ?? "";

                if (path === root_path) {
                    const is_in_base = this.base_dts?.node_exists(t) ?? false;

                    return {
                        node: overlay_node,
                        path: path,
                        node_path: path,
                        parent_node: undefined,
                        fragment_root_path: root_path,
                        is_in_base,
                    };
                }

                const normalized_root = root_path === "/" ? "" : root_path;
                if (!path.startsWith(normalized_root + "/")) { continue; }

                const relative_path = path.slice(normalized_root.length + 1);
                const segments = relative_path.split("/").filter(s => s.length > 0);
                if (segments.length === 0) { continue; }

                const result = this.find_node_in_fragment(fragment, segments);
                if (result === undefined) { continue; }

                const is_in_base = this.base_dts?.node_exists(t) ?? false;
                const abs_node_path = `${normalized_root}/${result.actual_segments.join("/")}`;

                return {
                    node: result.node,
                    path: path,
                    node_path: abs_node_path,
                    parent_node: result.parent_node,
                    fragment_root_path: root_path,
                    is_in_base,
                };
            }

            return undefined;
        }

        // DTLabel search
        const label_name = t.name;

        for (const fragment of this.get_fragments()) {
            const result = this.find_node_in_fragment(fragment, [label_name]);
            if (result === undefined) { continue; }

            const is_in_base = this.base_dts !== undefined &&
                this.base_dts.resolve_identifier(label_name) !== undefined;

            const root_path = this.get_fragment_root_path(fragment) ?? "";
            const abs_node_path = root_path === "/"
                ? `/${result.actual_segments.join("/")}`
                : `${root_path}/${result.actual_segments.join("/")}`;

            return {
                node: result.node,
                path: abs_node_path,
                node_path: abs_node_path,
                parent_node: result.parent_node,
                fragment_root_path: root_path,
                is_in_base,
            };
        }

        // Second pass: label names a base node that is a fragment target —
        // return the fragment's __overlay__ root as the found node.
        if (this.base_dts !== undefined) {
            const in_base = this.base_dts.resolve_identifier(label_name);

            if (in_base !== undefined) {
                const located = this.base_dts.locate(in_base);

                if (located !== undefined) {
                    const target_path = located.path;

                    for (const fragment of this.get_fragments()) {
                        if (this.get_fragment_root_path(fragment) === target_path) {
                            const overlay_node = fragment.children.find(c => c.name === "__overlay__");

                            if (overlay_node !== undefined) {
                                return {
                                    node: overlay_node,
                                    path: target_path,
                                    node_path: target_path,
                                    parent_node: undefined,
                                    fragment_root_path: target_path,
                                    is_in_base: true,
                                };
                            }
                        }
                    }
                }
            }
        }

        return undefined;
    }

    private find_node_in_fragment(
        fragment: DTNode,
        segments: string[],
    ): { node: DTNode; parent_node: DTNode | undefined; actual_segments: string[] } | undefined {
        if (segments.length === 0) { return undefined; }
        const overlay_node = fragment.children.find(c => c.name === "__overlay__");
        if (overlay_node === undefined) { return undefined; }

        let current: DTNode = overlay_node;
        let parent: DTNode | undefined = undefined;
        const actual_segments: string[] = [];

        for (const segment of segments) {
            const seg = segment!;
            const child = current.children.find(c =>
                get_full_node_name(c) === seg ||
                c.labels.includes(seg) ||
                (c.name === seg && c.unit_addr === undefined)
            );
            if (child === undefined) { return undefined; }
            actual_segments.push(get_full_node_name(child));
            parent = current;
            current = child;
        }

        return { node: current, parent_node: parent, actual_segments };
    }

    public delete_all(): void {
        this.overlay.root.children = [];
    }

    /** Remove a direct child of the overlay root by full name (e.g. `__overrides__`, `fragment@2`). */
    public remove_root_node(name: string): boolean {
        const index = this.overlay.root.children.findIndex(child => get_full_node_name(child) === name);
        if (index === -1) { return false; }
        this.overlay.root.children.splice(index, 1);
        return true;
    }

    /**
     * Merge base and overlay children of the node at `parent_path`.
     * An overlay child with the same full name as a base child patches it.
     */
    public effective_children(parent_path: string): Map<string, DTNode> {
        const children = new Map<string, DTNode>();

        for (const child of this.base_dts?.node_at(parent_path)?.children ?? []) {
            children.set(get_full_node_name(child), child);
        }

        for (const fragment of this.get_fragments()) {
            const overlay_node = fragment.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) { continue; }
            const root = this.get_fragment_root_path(fragment);
            if (root === undefined) { continue; }

            let cursor: DTNode | undefined;
            if (root === parent_path) {
                cursor = overlay_node;
            } else if (parent_path.startsWith(root + "/") || (root === "/" && parent_path.startsWith("/"))) {
                const relative = root === "/" ? parent_path.slice(1) : parent_path.slice(root.length + 1);
                let node: DTNode | undefined = overlay_node;
                for (const segment of relative.split("/")) {
                    if (node === undefined) { break; }
                    node = node.children.find(c => get_full_node_name(c) === segment);
                }
                cursor = node;
            } else if ((access_parent_path(root) ?? "/") === parent_path) {
                const sibling_name = root.slice(root.lastIndexOf("/") + 1);
                const existing = children.get(sibling_name);
                children.set(sibling_name, existing === undefined
                    ? overlay_node
                    : patch_node(existing, overlay_node));
                continue;
            }
            if (cursor === undefined) { continue; }

            for (const child of cursor.children) {
                const child_name = get_full_node_name(child);
                const existing = children.get(child_name);
                children.set(child_name, existing === undefined ? child : patch_node(existing, child));
            }
        }

        return children;
    }

    /**
     * Build the effective node at `path`: for `/`, the root with properties from
     * all fragments targeting `/`; for other paths, the base node patched by overlay props.
     */
    public effective_node(path: string): DTNode | undefined {
        const base_node = this.base_dts?.node_at(path);

        const found = this.find_node(path);
        if (found === undefined && base_node === undefined) { return undefined; }

        const properties = [...(base_node?.properties ?? [])];
        if (found !== undefined) {
            for (const property of found.node.properties) {
                const index = properties.findIndex(p => p.name === property.name);
                if (index === -1) { properties.push(property); }
                else { properties[index] = property; }
            }
        }

        return {
            name: base_node?.name ?? found?.node.name ?? path.split("/").at(-1) ?? "",
            unit_addr: base_node?.unit_addr ?? found?.node.unit_addr,
            labels: [...(base_node?.labels ?? []), ...(found?.node.labels ?? [])],
            properties,
            children: [...this.effective_children(path).values()],
        };
    }

    /**
     * The base tree with the overlay applied, as one tree: every node as
     * `effective_node` builds it, so the overlay's nodes, properties and labels
     * are in it. Undefined without a base.
     */
    public merged_tree(): DeviceTree | undefined {
        if (this.base_dts === undefined) { return undefined; }
        const build = (path: string): DTNode | undefined => {
            const node = this.effective_node(path);
            if (node === undefined) { return undefined; }
            const children = [...this.effective_children(path).keys()].flatMap(name => {
                const child = build(path === "/" ? `/${name}` : `${path}/${name}`);
                return child === undefined ? [] : [child];
            });
            return { ...node, children };
        };
        const root = build("/");
        return root === undefined ? undefined : DeviceTree.new_from_root(root);
    }

    /**
     * Collect every label in the base tree and the overlay, returning a map from
     * label name to absolute path. Overlay labels override base labels.
     */
    public all_labels(): Map<string, string> {
        const labels = new Map<string, string>();

        if (this.base_dts !== undefined) {
            const collect = (node: DTNode, path: string): void => {
                for (const label of node.labels) {
                    labels.set(label, path);
                }
                for (const child of node.children) {
                    const child_name = get_full_node_name(child);
                    const child_path = path === "/" ? `/${child_name}` : `${path}/${child_name}`;
                    collect(child, child_path);
                }
            };
            const root = this.base_dts.node_at("/");
            if (root !== undefined) { collect(root, "/"); }
        }

        for (const fragment of this.get_fragments()) {
            const overlay_node = fragment.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) { continue; }
            const root = this.get_fragment_root_path(fragment) ?? "";
            const collect_overlay = (node: DTNode, path: string): void => {
                for (const label of node.labels) {
                    labels.set(label, path);
                }
                for (const child of node.children) {
                    const child_name = get_full_node_name(child);
                    const child_path = path === "/" ? `/${child_name}` : `${path}/${child_name}`;
                    collect_overlay(child, child_path);
                }
            };
            for (const child of overlay_node.children) {
                const child_name = get_full_node_name(child);
                const child_path = root === "/" ? `/${child_name}` : `${root}/${child_name}`;
                collect_overlay(child, child_path);
            }
        }

        return labels;
    }

    public print(options?: import("./Printer.js").DtoPrintOptions): string {
        return print_dto(this.overlay, undefined, options);
    }
}

if (import.meta.vitest !== undefined) {

    const { test, expect } = import.meta.vitest;

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


    test("find_node - finds overlay-added node by label", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = overlay.find_node("imu1");
        expect(result).toBeDefined();
        expect(result?.is_in_base).toBe(false);
    });

    test("find_node - is_in_base false for node only in overlay", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = overlay.find_node("imu1");
        expect(result).toBeDefined();
        expect(result?.is_in_base).toBe(false);
    });

    test("find_node - returns undefined for unknown label", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        expect(overlay.find_node("nonexistent")).toBeUndefined();
    });

    test("print/reparse roundtrip - target element name has no & prefix", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const printed = overlay.print();
        const reparsed = DeviceTreeOverlay.new_from_string(printed, base);
        if (typeof reparsed === "string") { throw new TypeError(`reparse failed: ${reparsed}`); }

        const fragment = reparsed.get_fragments()[0];
        expect(fragment).toBeDefined();
        const target = fragment!.properties.find(p => p.name === "target");
        expect(target).toBeDefined();
        if (target === undefined || is_dt_flag(target.value)) { throw new Error("bad target"); }
        const element = target.value[0];
        if (element === undefined || element.kind !== "array") { throw new Error("bad element"); }
        const reference = element.elements[0];
        if (reference === undefined || reference.kind !== "label") { throw new Error("bad ref"); }
        expect(reference.name).toBe("spi0");
    });

    test("add_fragment reuses existing label fragment", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const before = overlay.get_fragments().length;
        overlay.add_fragment("spi0", undefined, undefined);
        expect(overlay.get_fragments().length).toBe(before);
    });

    test("ensure_node — reuses the overlay node, creates a fragment for a base-only node", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t\tbus {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        expect(overlay.ensure_node("/soc/spi@7e204000/adi,ad7124-8@0")?.labels).toEqual(["imu1"]);
        expect(overlay.ensure_node("/soc/spi@7e204000")?.name).toBe("__overlay__");
        expect(overlay.get_fragments()).toHaveLength(1);

        expect(overlay.ensure_node("/soc/bus")?.name).toBe("__overlay__");
        expect(overlay.print()).toContain(`target-path = "/soc/bus"`);
        expect(overlay.ensure_node("/soc/missing")).toBeUndefined();
        expect(overlay.get_fragments()).toHaveLength(2);
    });

    const overlay_with_path_target = `/dts-v1/;
/plugin/;

/ {
    fragment@0 {
        target = <&{/soc/spi@7e204000}>;
        __overlay__ {
            adc@0 {
                compatible = "adi,ad7124-8";
                reg = <0>;
            };
        };
    };
};`;

    test("target = <&{/path}> normalised to target-path", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_path_target, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const fragment = overlay.get_fragments()[0];
        expect(fragment).toBeDefined();
        const tp = fragment!.properties.find(p => p.name === "target-path");
        expect(tp).toBeDefined();
        if (tp === undefined || is_dt_flag(tp.value)) { throw new Error("bad tp"); }
        expect(tp.value[0]).toMatchObject({ kind: "string", value: "/soc/spi@7e204000" });
    });

    test("find_node resolves node under path-targeted fragment", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_path_target, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = overlay.find_node("/soc/spi@7e204000/adc@0");
        expect(result).toBeDefined();
        expect(result?.node_path).toBe("/soc/spi@7e204000/adc@0");
    });

    test("remove_root_node - drops a root child and keeps root properties and fragments", () => {
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;
/plugin/;
/ {
    compatible = "brcm,bcm2711";
    __overrides__ { cs_pin = <&imu1>, "reg:0"; };
};
${overlay_with_imu.replace("/dts-v1/;\n/plugin/;\n", "")}`);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        expect(overlay.remove_root_node("__overrides__")).toBe(true);
        expect(overlay.remove_root_node("__overrides__")).toBe(false);

        const printed = overlay.print();
        expect(printed).not.toContain("__overrides__");
        expect(printed).toContain(`compatible = "brcm,bcm2711";`);
        expect(printed).toContain("fragment@0");
        expect(typeof DeviceTreeOverlay.new_from_string(printed)).not.toBe("string");
    });

    test("print label mode — label target becomes &spi0 {}", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\treg = <0>;\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const printed = overlay.print({ syntax: "label" });
        expect(printed).toContain("&spi0 {");
        expect(printed).not.toContain("fragment@0");
        expect(printed).not.toContain("__overlay__");
        expect(printed).toContain("adc@0");
    });

    test("print label mode — target-path becomes &{/path}", () => {
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&{/} {\n\tmy-node {\n\t};\n};`);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const printed = overlay.print({ syntax: "label" });
        expect(printed).toContain("&{/} {");
        expect(printed).not.toContain("fragment");
    });

    test("print label mode — round trip: parse(print(label)) ≡ parse(print(fragment))", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\treg = <0>;\n\t\tcompatible = "adi,ad7124-8";\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const fragment_text = overlay.print({ syntax: "fragment" });
        const label_text = overlay.print({ syntax: "label" });

        const re_fragment = DeviceTreeOverlay.new_from_string(fragment_text, base);
        const re_label = DeviceTreeOverlay.new_from_string(label_text, base);
        if (typeof re_fragment === "string") { throw new TypeError(re_fragment); }
        if (typeof re_label === "string") { throw new TypeError(re_label); }

        expect(re_label.print({ syntax: "fragment" })).toBe(re_fragment.print({ syntax: "fragment" }));
    });

    test("print label mode — empty overlay prints / {};", () => {
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n/ {\n};`);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const printed = overlay.print({ syntax: "label" });
        expect(printed).toContain("/ {\n};");
    });

    test("effective_children merges base and overlay children", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t\t#address-cells = <1>;\n\t\t\t#size-cells = <0>;\n\t\t\tspidev@0 { reg = <0>; };\n\t\t\tspidev@1 { reg = <1>; };\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tspidev@0 { status = "disabled"; };\n\tadc@2 { reg = <2>; };\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const children = overlay.effective_children("/soc/spi@7e204000");
        expect(children.has("spidev@0")).toBe(true);
        expect(children.has("spidev@1")).toBe(true);
        expect(children.has("adc@2")).toBe(true);
        const patched = children.get("spidev@0");
        expect(patched?.properties.some(p => p.name === "status")).toBe(true);
        expect(patched?.properties.some(p => p.name === "reg")).toBe(true);
    });

    test("effective_children — overlay-only parent", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc@0 {\n\t\tchannel@0 { reg = <0>; };\n\t};\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const children = overlay.effective_children("/soc/spi@7e204000/adc@0");
        expect(children.has("channel@0")).toBe(true);
    });

    test("all_labels collects from base and overlay", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {\n\t\t};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc: adc@0 { reg = <0>; };\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const labels = overlay.all_labels();
        expect(labels.get("spi0")).toBe("/soc/spi@7e204000");
        expect(labels.get("adc")).toBe("/soc/spi@7e204000/adc@0");
    });

    test("all_labels — overlay label in second fragment", () => {
        const base = DeviceTree.new_from_string(`/dts-v1/;\n/ {\n\tsoc {\n\t\tspi0: spi@7e204000 {};\n\t\tspi1: spi@7e205000 {};\n\t};\n};`);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(`/dts-v1/;\n/plugin/;\n\n&spi0 {\n\tadc: adc@0 { reg = <0>; };\n};\n&spi1 {\n\tdac: dac@0 { reg = <0>; };\n};`, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const labels = overlay.all_labels();
        expect(labels.get("adc")).toBe("/soc/spi@7e204000/adc@0");
        expect(labels.get("dac")).toBe("/soc/spi@7e205000/dac@0");
    });
}
