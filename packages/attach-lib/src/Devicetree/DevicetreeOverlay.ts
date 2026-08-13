import { INodeBuilderBase, NodeBuilder } from "./NodeBuilder";
import { PropertyBuilder } from "./PropertyBuilder";

import {
    DTNode,
    DTLabel,
    DTPath,
    get_full_node_name,
    DTProperty,
    is_dt_flag,
    DTO,
    parse_dto,
    print_dto
} from "./Parser";

import * as fs from 'node:fs';
import { Result } from "../result";
import { DeviceTree } from "./Devicetree";
import { DTReference, FoundNodeResult, TraversalOrder } from "./Types";
import { Stream } from "./Stream";

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
                return "Failed to parse overlay!";
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
        target: DTLabel | DTPath,
        nodes: INodeBuilderBase | undefined,
        properties: DTProperty | DTProperty[] | undefined
    ): DTReference | undefined {
        const existing = this.find_fragment(target);

        if (existing !== undefined) {
            const overlay_node = existing.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) {
                return undefined;
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

            return this.fragment_to_ref(existing);
        }

        if (this.base_dts !== undefined) {
            if (target.kind === "label") {
                if (this.base_dts.get_node_by_label(target) === undefined) {
                    return undefined;
                }
            } else if (target.kind === "path" && this.base_dts.get_node_by_path(target) === undefined) {
                return undefined;
            }
        }

        const fragment = target.kind === "label"
            ? this.create_label_fragment(target, nodes, properties)
            : this.create_path_fragment(target, nodes, properties);

        return this.fragment_to_ref(fragment);
    }

    private find_fragment(target: DTLabel | DTPath): DTNode | undefined {
        for (const fragment of this.get_fragments()) {
            if (target.kind === "label") {
                const property = fragment.properties.find(p => p.name === "target");
                if (property === undefined || is_dt_flag(property.value)) {
                    continue;
                }
                const matches = property.value.some(v =>
                    v.kind === "array" && v.elements.some(element => element.kind === "label" && element.name === target.name)
                );
                if (matches) {
                    return fragment;
                }
            } else if (target.kind === "path") {
                const property = fragment.properties.find(p => p.name === "target-path");
                if (property === undefined || is_dt_flag(property.value)) {
                    continue;
                }
                const matches = property.value.some(v => v.kind === "string" && v.value === target.path);
                if (matches) {
                    return fragment;
                }
            }
        }

        return undefined;
    }

    private fragment_to_ref(fragment: DTNode): DTReference {
        return {
            node_name: get_full_node_name(fragment),
            full_path: { kind: "path", labels: [], path: `/${get_full_node_name(fragment)}` },
            labels: fragment.labels.map(entry => ({ kind: "label", labels: [], name: entry }))
        };
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

    private create_label_fragment(
        target_label: DTLabel,
        node: INodeBuilderBase | undefined,
        properties: DTProperty | DTProperty[] | undefined
    ): DTNode {
        const targetProperty = PropertyBuilder.build_cell_array()
            .with_tagged_values(PropertyBuilder.tag_label(target_label.name))
            .with_name("target")
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

    private create_path_fragment(
        target_path: DTPath,
        node: INodeBuilderBase | undefined,
        properties: DTProperty | DTProperty[] | undefined
    ): DTNode {
        const targetProperty = PropertyBuilder.build_string()
            .with_value(target_path.path)
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

    public remove_node(reference: DTReference | DTLabel | DTPath): boolean {
        // DTReference has no kind discriminant — detect by its unique property
        if ("node_name" in reference) {
            if (reference.labels.length > 0) {
                return this.remove_by_label(reference.labels[0]!.name);
            }
            return this.remove_by_base_path(reference.full_path.path);
        }
        if (reference.kind === "label") {
            return this.remove_by_label(reference.name);
        }
        return this.remove_by_base_path(reference.path);
    }

    public remove_property(target: DTReference | DTLabel | DTPath, property: string): boolean {
        if ("node_name" in target) {
            if (target.labels.length > 0) {
                return this.remove_property_by_label(target.labels[0]!.name, property);
            }
            return this.remove_property_by_path(target.full_path.path, property);
        }
        if (target.kind === "label") {
            return this.remove_property_by_label(target.name, property);
        }
        return this.remove_property_by_path(target.path, property);
    }

    private remove_property_by_label(label_name: string, property: string): boolean {
        for (const fragment of this.get_fragments()) {
            const overlay_node = fragment.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) { continue; }

            const root_path = this.get_fragment_root_path(fragment);

            if (root_path !== undefined && this.base_dts !== undefined) {
                const reference = this.base_dts.resolve_identifier(label_name);

                if (reference !== undefined) {
                    const dt_node = reference.kind === "path"
                        ? this.base_dts.get_node_by_path(reference)
                        : this.base_dts.get_node_by_label(reference);

                    if (dt_node?.full_path.path === root_path) {
                        return this.remove_property_from_overlay_node(fragment, overlay_node, property);
                    }
                }
            }

            const child = this.find_labeled_in_overlay(overlay_node, label_name);

            if (child !== undefined) {
                const property_index = child.properties.findIndex(p => p.name === property);
                if (property_index === -1) { continue; }

                child.properties.splice(property_index, 1);

                return true;
            }
        }
        return false;
    }

    private remove_property_by_path(path: string, property: string): boolean {
        for (const fragment of this.get_fragments()) {
            const root_path = this.get_fragment_root_path(fragment);
            if (root_path === undefined) { continue; }

            const overlay_node = fragment.children.find(c => c.name === "__overlay__");
            if (overlay_node === undefined) { continue; }

            if (path === root_path) {
                return this.remove_property_from_overlay_node(fragment, overlay_node, property);
            }

            const normalized_root = root_path === "/" ? "" : root_path;
            if (!path.startsWith(normalized_root + "/")) { continue; }

            const relative_path = path.slice(normalized_root.length + 1);
            const segments = relative_path.split("/").filter(s => s.length > 0);
            if (segments.length === 0) { continue; }

            const child = this.find_in_overlay_by_segments(overlay_node, segments);
            if (child === undefined) { continue; }

            const property_index = child.properties.findIndex(p => p.name === property);
            if (property_index === -1) { continue; }

            child.properties.splice(property_index, 1);

            return true;
        }
        return false;
    }

    private remove_property_from_overlay_node(fragment: DTNode, overlay_node: DTNode, property: string): boolean {
        const property_index = overlay_node.properties.findIndex(p => p.name === property);
        if (property_index === -1) { return false; }

        overlay_node.properties.splice(property_index, 1);

        if (overlay_node.children.length === 0 && overlay_node.properties.length === 0) {
            const index = this.overlay.root.children.indexOf(fragment);
            if (index !== -1) { this.overlay.root.children.splice(index, 1); }
            this.renumber_fragments();
        }

        return true;
    }

    private find_labeled_in_overlay(parent: DTNode, label_name: string): DTNode | undefined {
        for (const child of parent.children) {
            if (child.labels.includes(label_name)) { return child; }

            const found = this.find_labeled_in_overlay(child, label_name);

            if (found !== undefined) { return found; }
        }

        return undefined;
    }

    private find_in_overlay_by_segments(parent: DTNode, segments: string[]): DTNode | undefined {
        const [head, ...rest] = segments;
        if (head === undefined) { return undefined; }

        const child = parent.children.find(c => get_full_node_name(c) === head);
        if (child === undefined) { return undefined; }

        return rest.length === 0 ? child : this.find_in_overlay_by_segments(child, rest);
    }

    private remove_by_label(label_name: string): boolean {
        for (const fragment of this.get_fragments()) {
            const overlay_node = fragment.children.find(c => c.name === "__overlay__");

            if (overlay_node === undefined) { continue; }

            if (!this.find_and_remove_labeled(overlay_node, label_name)) { continue; }

            if (overlay_node.children.length === 0 && overlay_node.properties.length === 0) {
                const index = this.overlay.root.children.indexOf(fragment);
                if (index !== -1) { this.overlay.root.children.splice(index, 1); }
            }

            this.renumber_fragments();

            return true;
        }
        return false;
    }

    private find_and_remove_labeled(parent: DTNode, label_name: string): boolean {
        for (let index = 0; index < parent.children.length; index++) {
            const child = parent.children[index]!;

            if (child.labels.includes(label_name)) {
                parent.children.splice(index, 1);
                return true;
            }

            if (this.find_and_remove_labeled(child, label_name)) { return true; }
        }

        return false;
    }

    private remove_by_base_path(path: string): boolean {
        for (const fragment of this.get_fragments()) {
            const root_path = this.get_fragment_root_path(fragment);

            if (root_path === undefined) { continue; }

            const normalized_root = root_path === "/" ? "" : root_path;

            if (!path.startsWith(normalized_root + "/")) { continue; }

            const relative_path = path.slice(normalized_root.length + 1);
            const relative_segments = relative_path.split("/").filter(s => s.length > 0);

            if (relative_segments.length === 0) { continue; }

            const overlay_node = fragment.children.find(c => c.name === "__overlay__");

            if (overlay_node === undefined) { continue; }
            if (!this.find_and_remove_by_segments(overlay_node, relative_segments)) { continue; }

            if (overlay_node.children.length === 0 && overlay_node.properties.length === 0) {
                const index = this.overlay.root.children.indexOf(fragment);
                if (index !== -1) { this.overlay.root.children.splice(index, 1); }
            }

            this.renumber_fragments();

            return true;
        }
        return false;
    }

    private find_and_remove_by_segments(parent: DTNode, segments: string[]): boolean {
        if (segments.length === 0) { return false; }

        const head = segments[0]!;
        const index = parent.children.findIndex(c => get_full_node_name(c) === head);

        if (index === -1) { return false; }

        if (segments.length === 1) {
            parent.children.splice(index, 1);
            return true;
        }

        return this.find_and_remove_by_segments(parent.children[index]!, segments.slice(1));
    }

    private get_fragment_root_path(fragment: DTNode): string | undefined {
        // label-targeted: target = <&label>
        const target_property = fragment.properties.find(p => p.name === "target");

        if (target_property !== undefined && !is_dt_flag(target_property.value)) {
            for (const v of target_property.value) {
                if (v.kind !== "array") { continue; }

                for (const element of v.elements) {
                    if (element.kind !== "label") { continue; }

                    const name = element.name.startsWith("&") ? element.name.slice(1) : element.name;

                    if (this.base_dts !== undefined) {
                        const reference = this.base_dts.get_node_by_label({ kind: "label", labels: [], name });

                        if (reference !== undefined) { return reference.full_path.path; }
                    }

                    return undefined;
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

    public deref_node(reference: DTReference): DTNode | undefined {
        const path = reference.full_path.path;

        if (path === "/") {
            return this.overlay.root;
        }

        const segments = path.split("/").filter(s => s.length > 0);

        let current: DTNode = this.overlay.root;

        for (const segment of segments) {
            const child = current.children.find(c => get_full_node_name(c) === segment);

            if (child === undefined) {
                return undefined;
            }

            current = child;
        }

        return current;
    }

    public as_stream(order: TraversalOrder = "DFS"): Stream<DTNode, DTPath> {
        return new Stream(this.as_generator(this.overlay.root, "/", order));
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

    public get_fragments(): DTNode[] {
        return this.as_stream()
            .filter((node) => node.name === "fragment")
            .toArray()
            .map(([node]) => node);
    }

    public find_node(target: DTReference | DTPath | DTLabel): FoundNodeResult | undefined {
        if ("node_name" in target) {
            return this.find_node(target.full_path);
        }

        if (target.kind === "path") {
            const path = target.path;

            for (const fragment of this.get_fragments()) {
                const overlay_node = fragment.children.find(c => c.name === "__overlay__");
                if (overlay_node === undefined) { continue; }

                const root_path = this.get_fragment_root_path(fragment) ?? "";

                if (path === root_path) {
                    const is_in_base = this.base_dts?.get_node_by_path(target) !== undefined;

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

                const is_in_base = this.base_dts?.get_node_by_path(target) !== undefined;
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
        const label_name = target.name;

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
                const reference = in_base.kind === "path"
                    ? this.base_dts.get_node_by_path(in_base)
                    : this.base_dts.get_node_by_label(in_base);

                if (reference !== undefined) {
                    const target_path = reference.full_path.path;

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

    public print(): string {
        return print_dto(this.overlay);
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
        const result = overlay.find_node({ kind: "label", labels: [], name: "imu1" });
        expect(result).toBeDefined();
        expect(result?.is_in_base).toBe(false);
    });

    test("find_node - is_in_base false for node only in overlay", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = overlay.find_node({ kind: "label", labels: [], name: "imu1" });
        expect(result).toBeDefined();
        expect(result?.is_in_base).toBe(false);
    });

    test("find_node - returns undefined for unknown label", () => {
        const base = DeviceTree.new_from_string(base_dts_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        expect(overlay.find_node({ kind: "label", labels: [], name: "nonexistent" })).toBeUndefined();
    });
}