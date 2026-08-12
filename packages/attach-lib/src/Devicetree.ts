import { INodeBuilderBase, NodeBuilder } from "./DTBuilder/NodeBuilder";
import { PropertyBuilder } from "./DTBuilder/PropertyBuilder";

import {
    print_dts,
    print_dto,
    DTS,
    DTNode,
    parse_dts,
    parse_dto,
    DTLabel,
    DTPath,
    get_full_node_name,
    DTProperty,
    is_dt_flag,
    DTO
} from "./DTBuilder/parser";

import path from 'node:path';
import * as fs from 'node:fs';
import { Result } from "./result";

export type DTReference = {
    node_name: string,
    full_path: DTPath,
    labels: DTLabel[],
};

export type TraversalOrder = "DFS" | "BFS";

export type UnitAddr = { value: bigint; repr: "hex" | "dec" };

export type FoundNodeResult = {
    node: DTNode;
    path: string;
    node_path: string;
    parent_node: DTNode | undefined;
    fragment_root_path: string;
    is_in_base: boolean;
};

function format_unit_addr_part(addr: UnitAddr): string {
    return addr.repr === "hex"
        ? addr.value.toString(16)
        : addr.value.toString(10);
}

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

    /**
     * Find a node in this overlay by a free-form string identifier.
     * Accepted forms: bare-label  |  &label  |  label/child  |  /abs/path  |  &{/abs/path}
     *
     * First pass: search each fragment's __overlay__ subtree for a node matching the segments.
     * Second pass: if the identifier names a base node that is already a fragment target,
     *   return that fragment's __overlay__ root (parent_node will be undefined).
     */
    public find_node(identifier: string): FoundNodeResult | undefined {
        let search_label_in_base: string | undefined;
        let segments: string[];

        const clean = identifier.startsWith("&") ? identifier.slice(1) : identifier;

        if (clean.startsWith("{/") && clean.endsWith("}")) {
            const abs = clean.slice(1, -1);
            segments = abs.split("/").filter(s => s.length > 0);
        } else if (identifier.startsWith("/")) {
            segments = identifier.split("/").filter(s => s.length > 0);
        } else {
            const slash = clean.indexOf("/");
            if (slash === -1) {
                segments = [clean];
                search_label_in_base = clean;
            } else {
                search_label_in_base = clean.slice(0, slash);
                segments = [clean.slice(0, slash), ...clean.slice(slash + 1).split("/")];
            }
        }

        for (const fragment of this.get_fragments()) {
            const root_path = this.get_fragment_root_path(fragment) ?? "";
            const result = this.find_node_in_fragment(fragment, segments);
            if (result === undefined) { continue; }

            const effective_id = search_label_in_base ?? identifier;
            const is_in_base = this.base_dts !== undefined &&
                this.base_dts.resolve_identifier(effective_id) !== undefined;

            const abs_path = root_path === "/"
                ? `/${segments.join("/")}`
                : `${root_path}/${segments.join("/")}`;

            const abs_node_path = root_path === "/"
                ? `/${result.actual_segments.join("/")}`
                : `${root_path}/${result.actual_segments.join("/")}`;

            return {
                node: result.node,
                path: abs_path,
                node_path: abs_node_path,
                parent_node: result.parent_node,
                fragment_root_path: root_path,
                is_in_base,
            };
        }

        // Second pass: identifier names a base node that is a fragment target —
        // return the fragment's __overlay__ root as the found node.
        if (this.base_dts !== undefined && segments.length === 1) {
            const in_base = this.base_dts.resolve_identifier(search_label_in_base ?? identifier);
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
}