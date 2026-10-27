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
                // A later fragment for the same node may already set it, and its value is the one applied.
                const root = this.get_fragment_root_path(existing);
                const properties_ = Array.isArray(properties) ? properties : [properties];
                for (const property of properties_) {
                    const holder = (root === undefined ? undefined : this.property_node(root, property.name)) ?? overlay_node;
                    const index = holder.properties.findIndex(p => p.name === property.name);
                    if (index === -1) {
                        holder.properties.push(property);
                    } else {
                        holder.properties[index] = property;
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

    /**
     * The first fragment with an `__overlay__` for the node `target` resolves
     * to, whatever label or path its own target names (`&i2c_arm` and `&i2c1`
     * are one node). Without a resolved node, the one whose target is written
     * the same way.
     */
    private find_fragment(target: NodeTarget): DTNode | undefined {
        const normalized = normalize_target(target);
        const path = normalized.kind === "label" ? this.label_path(normalized.name, new Set()) : normalized.path;
        if (path !== undefined) {
            const for_node = this.get_fragments().find(fragment =>
                fragment.children.some(c => c.name === "__overlay__") && this.get_fragment_root_path(fragment) === path);
            if (for_node !== undefined) { return for_node; }
        }

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

    /** Remove the property from every overlay node for the target's node, so no fragment still sets it. */
    public remove_property(target: NodeTarget, property: string): boolean {
        const found = this.find_node(target);
        if (found === undefined) { return false; }

        let removed = false;
        for (const node of this.overlay_nodes_at(found.node_path)) {
            const index = node.properties.findIndex(p => p.name === property);
            if (index === -1) { continue; }
            node.properties.splice(index, 1);
            removed = true;
        }
        if (!removed) { return false; }

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

    /**
     * The absolute path a fragment applies to. A label target is looked up in
     * the overlay first, as dtc does: a label on another fragment's body, or on
     * a node in one, names where that body ends up (`i2cbus: __overlay__` in a
     * fragment for `&i2c_arm` makes `&i2cbus` the I2C bus). Then in the base.
     */
    public get_fragment_root_path(fragment: DTNode): string | undefined {
        return this.fragment_root_path(fragment, new Set());
    }

    private fragment_root_path(fragment: DTNode, visited: Set<DTNode>): string | undefined {
        // label-targeted: target = <&label>
        const target_property = fragment.properties.find(p => p.name === "target");

        if (target_property !== undefined && !is_dt_flag(target_property.value)) {
            for (const v of target_property.value) {
                if (v.kind !== "array") { continue; }

                for (const element of v.elements) {
                    if (element.kind === "label") {
                        const name = element.name.startsWith("&") ? element.name.slice(1) : element.name;

                        return this.label_path(name, new Set([...visited, fragment]));
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

    /** Where a fragment target's label points: the overlay's own label first, as in dtc, then the base's. */
    private label_path(name: string, visited: Set<DTNode>): string | undefined {
        const local = this.overlay_label_path(name, visited);
        if (local !== undefined) { return local.path; }
        return this.base_dts?.locate(name)?.path;
    }

    /**
     * Where a label on a fragment body, or on a node in one, ends up once the
     * overlay is applied. `path` is undefined when the label is the overlay's
     * but its fragment's target can't be placed. Fragments in `visited` are
     * skipped, so targets that name each other don't loop.
     */
    private overlay_label_path(name: string, visited: Set<DTNode>): { path: string | undefined } | undefined {
        const find = (node: DTNode): string[] | undefined => {
            if (node.labels.includes(name)) { return []; }
            for (const child of node.children) {
                const below = find(child);
                if (below !== undefined) { return [get_full_node_name(child), ...below]; }
            }
            return undefined;
        };

        for (const fragment of this.get_fragments()) {
            if (visited.has(fragment)) { continue; }
            const body = fragment.children.find(c => c.name === "__overlay__" || c.name === "__dormant__");
            const relative = body === undefined ? undefined : find(body);
            if (relative === undefined) { continue; }

            const root = this.fragment_root_path(fragment, new Set([...visited, fragment]));
            if (root === undefined) { return { path: undefined }; }
            if (relative.length === 0) { return { path: root }; }
            return { path: `${root === "/" ? "" : root}/${relative.join("/")}` };
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
            // A label on the body itself (`i2cbus: __overlay__`) names the target.
            const overlay_node = fragment.children.find(c => c.name === "__overlay__");
            const target_path = overlay_node?.labels.includes(label_name) === true ? this.get_fragment_root_path(fragment) : undefined;
            if (overlay_node !== undefined && target_path !== undefined) {
                return {
                    node: overlay_node,
                    path: target_path,
                    node_path: target_path,
                    parent_node: undefined,
                    fragment_root_path: target_path,
                    is_in_base: this.base_dts?.node_exists(target_path) ?? false,
                };
            }

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

        const overlay_nodes = this.overlay_nodes_at(path);
        if (overlay_nodes.length === 0 && base_node === undefined) { return undefined; }

        const properties = [...(base_node?.properties ?? [])];
        for (const property of this.overlay_properties(path)) {
            const index = properties.findIndex(p => p.name === property.name);
            if (index === -1) { properties.push(property); }
            else { properties[index] = property; }
        }

        return {
            name: base_node?.name ?? overlay_nodes[0]?.name ?? path.split("/").at(-1) ?? "",
            unit_addr: base_node?.unit_addr ?? overlay_nodes[0]?.unit_addr,
            labels: [...(base_node?.labels ?? []), ...overlay_nodes.flatMap(node => node.labels)],
            properties,
            children: [...this.effective_children(path).values()],
        };
    }

    /**
     * The overlay's nodes for the node at absolute `path`, in file order, which
     * is the order dtc applies them in: the `__overlay__` of each fragment
     * targeting it, and the node at its place under a fragment targeting an
     * ancestor. A fragment whose target can't be placed counts from `/`, as in
     * `find_node`.
     */
    public overlay_nodes_at(path: string): DTNode[] {
        const nodes: DTNode[] = [];
        for (const fragment of this.get_fragments()) {
            const body = fragment.children.find(c => c.name === "__overlay__");
            if (body === undefined) { continue; }
            const root = this.get_fragment_root_path(fragment) ?? "";
            if (root === path) { nodes.push(body); continue; }

            const prefix = root.endsWith("/") ? root : `${root}/`;
            if (!path.startsWith(prefix)) { continue; }
            let node: DTNode | undefined = body;
            for (const segment of path.slice(prefix.length).split("/")) {
                node = node?.children.find(c => get_full_node_name(c) === segment);
            }
            if (node !== undefined) { nodes.push(node); }
        }
        return nodes;
    }

    /** The properties the overlay sets on the node at `path`: over all its overlay nodes, a later one's value wins. */
    public overlay_properties(path: string): DTProperty[] {
        const properties: DTProperty[] = [];
        for (const node of this.overlay_nodes_at(path)) {
            for (const property of node.properties) {
                const index = properties.findIndex(p => p.name === property.name);
                if (index === -1) { properties.push(property); }
                else { properties[index] = property; }
            }
        }
        return properties;
    }

    /**
     * What the overlay writes to the node at `path`, as one node: its overlay
     * nodes merged in file order (a later property wins, children with one
     * name are patched together). Undefined when the overlay doesn't touch it.
     */
    public merged_overlay_node(path: string): DTNode | undefined {
        const nodes = this.overlay_nodes_at(path);
        const [first] = nodes;
        if (first === undefined) { return undefined; }
        const children = new Map<string, DTNode>();
        for (const child of nodes.flatMap(node => node.children)) {
            const name = get_full_node_name(child);
            const existing = children.get(name);
            children.set(name, existing === undefined ? child : patch_node(existing, child));
        }
        return {
            ...first,
            labels: nodes.flatMap(node => node.labels),
            properties: this.overlay_properties(path),
            children: [...children.values()],
        };
    }

    /** The overlay node whose value of `property` applies to the node at `path`: the last one that sets it. */
    public property_node(path: string, property: string): DTNode | undefined {
        const nodes = this.overlay_nodes_at(path);
        for (let index = nodes.length - 1; index >= 0; index--) {
            const node = nodes[index];
            if (node?.properties.some(p => p.name === property) === true) { return node; }
        }
        return undefined;
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
     * label name to absolute path. Overlay labels override base labels. A
     * fragment's body counts whether it is `__overlay__` or `__dormant__` (one
     * `__overrides__` may switch on), and a label on the body itself names the
     * fragment's target, as dtc's symbols do once the overlay is applied.
     */
    public all_labels(): Map<string, string> {
        const labels = new Map<string, string>();
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

        const base_root = this.base_dts?.node_at("/");
        if (base_root !== undefined) { collect(base_root, "/"); }

        for (const fragment of this.get_fragments()) {
            const body = fragment.children.find(c => c.name === "__overlay__" || c.name === "__dormant__");
            if (body === undefined) { continue; }
            collect(body, this.get_fragment_root_path(fragment) ?? "");
        }

        return labels;
    }

    /**
     * The labels a new node can't take: `all_labels`, plus the labels on
     * fragment nodes (`busfrag: fragment@100`), which name the fragment itself
     * and are mapped to its path in the overlay file.
     */
    public taken_labels(): Map<string, string> {
        const labels = this.all_labels();
        for (const fragment of this.get_fragments()) {
            for (const label of fragment.labels) {
                if (!labels.has(label)) { labels.set(label, `/${get_full_node_name(fragment)}`); }
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

    const fan_base = `/dts-v1/;\n/ {\n\tsoc {\n\t\ti2c1: i2c@7e804000 {};\n\t};\n};`;
    const fan_overlay = `/dts-v1/;\n/plugin/;\n/ {\n\tbusfrag: fragment@100 {\n\t\ttarget = <&i2c1>;\n\t\ti2cbus: __overlay__ {\n\t\t\tstatus = "okay";\n\t\t};\n\t};\n\tfragment@0 {\n\t\ttarget = <&i2cbus>;\n\t\t__dormant__ {\n\t\t\temc2301: emc2301@2f { reg = <0x2f>; };\n\t\t};\n\t};\n};`;

    test("all_labels — a label on __overlay__ names the target; __dormant__ bodies count", () => {
        const base = DeviceTree.new_from_string(fan_base);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(fan_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const labels = overlay.all_labels();
        expect(labels.get("i2cbus")).toBe("/soc/i2c@7e804000");
        expect(labels.get("emc2301")).toBe("/soc/i2c@7e804000/emc2301@2f");
        expect(labels.has("busfrag")).toBe(false);
    });

    test("taken_labels — adds the labels on fragment nodes", () => {
        const base = DeviceTree.new_from_string(fan_base);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(fan_overlay, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const labels = overlay.taken_labels();
        expect(labels.get("busfrag")).toBe("/fragment@100");
        expect([...labels.keys()].sort()).toEqual(["busfrag", "emc2301", "i2c1", "i2cbus"]);
    });

    const overlay_on = (base_source: string, overlay_source: string): DeviceTreeOverlay => {
        const base = DeviceTree.new_from_string(base_source);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return overlay;
    };
    const fragment_with = (overlay: DeviceTreeOverlay, unit: string): DTNode => {
        const fragment = overlay.get_fragments().find(f => f.unit_addr === unit);
        if (fragment === undefined) { throw new TypeError(`no fragment@${unit}`); }
        return fragment;
    };

    test("get_fragment_root_path — a target labelled on another fragment's body, or a node in one", () => {
        const overlay = overlay_on(fan_base, `/dts-v1/;\n/plugin/;\n/ {\n\tfragment@100 {\n\t\ttarget = <&i2c1>;\n\t\ti2cbus: __overlay__ {\n\t\t\tmux: mux@70 { reg = <0x70>; };\n\t\t};\n\t};\n\tfragment@0 {\n\t\ttarget = <&i2cbus>;\n\t\t__overlay__ {\n\t\t\tadc@48 { reg = <0x48>; };\n\t\t};\n\t};\n\tfragment@1 {\n\t\ttarget = <&mux>;\n\t\t__overlay__ { status = "okay"; };\n\t};\n};`);
        expect(overlay.get_fragment_root_path(fragment_with(overlay, "0"))).toBe("/soc/i2c@7e804000");
        expect(overlay.get_fragment_root_path(fragment_with(overlay, "1"))).toBe("/soc/i2c@7e804000/mux@70");
        expect([...overlay.effective_children("/soc/i2c@7e804000").keys()]).toEqual(["mux@70", "adc@48"]);
        expect(overlay.find_node("/soc/i2c@7e804000/adc@48")?.is_in_base).toBe(false);
        expect(overlay.find_node("i2cbus")).toMatchObject({ node_path: "/soc/i2c@7e804000", is_in_base: true });
    });

    test("get_fragment_root_path — the overlay's label wins over the base's, as in dtc", () => {
        const overlay = overlay_on(fan_base, `/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget-path = "/";\n\t\t__overlay__ {\n\t\t\ti2c1: i2c-gpio@1 {};\n\t\t};\n\t};\n\tfragment@1 {\n\t\ttarget = <&i2c1>;\n\t\t__overlay__ { status = "okay"; };\n\t};\n};`);
        expect(overlay.get_fragment_root_path(fragment_with(overlay, "1"))).toBe("/i2c-gpio@1");
    });

    const two_labels = `/dts-v1/;\n/ {\n\tsoc {\n\t\ti2c_arm: i2c1: i2c@7e804000 {};\n\t};\n};`;
    const I2C = "/soc/i2c@7e804000";
    const frequency = (value: bigint): DTProperty => PropertyBuilder.build_cell_array()
        .with_tagged_values(PropertyBuilder.tag_number(value))
        .with_name("clock-frequency")
        .build();

    test("add_fragment — reuses the fragment for the node whatever label or path names it", () => {
        const overlay = overlay_on(two_labels, `/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&i2c_arm>;\n\t\t__overlay__ { status = "okay"; };\n\t};\n};`);
        expect(overlay.add_fragment("i2c1", undefined, frequency(100_000n))).toBe(true);
        expect(overlay.add_fragment({ kind: "path", labels: [], path: I2C }, undefined, frequency(400_000n))).toBe(true);
        expect(overlay.get_fragments()).toHaveLength(1);
        expect(overlay.overlay_properties(I2C).map(p => p.name)).toEqual(["status", "clock-frequency"]);
        expect(overlay.remove_property("i2c1", "clock-frequency")).toBe(true);
        expect(overlay.overlay_properties(I2C).map(p => p.name)).toEqual(["status"]);
    });

    const split = `/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&i2c_arm>;\n\t\t__overlay__ { status = "okay"; clock-frequency = <100000>; };\n\t};\n\tfragment@1 {\n\t\ttarget = <&i2c1>;\n\t\t__overlay__ {\n\t\t\t#address-cells = <1>;\n\t\t\tclock-frequency = <400000>;\n\t\t\tadc@48 { reg = <0x48>; };\n\t\t};\n\t};\n\tfragment@2 {\n\t\ttarget-path = "/";\n\t\t__overlay__ {\n\t\t\tsoc {\n\t\t\t\ti2c@7e804000 { #size-cells = <0>; };\n\t\t\t};\n\t\t};\n\t};\n};`;

    test("overlay_nodes_at — every fragment for the node, in file order; a later value wins", () => {
        const overlay = overlay_on(two_labels, split);
        expect(overlay.overlay_nodes_at(I2C)).toHaveLength(3);
        expect(overlay.overlay_properties(I2C).map(p => p.name)).toEqual(["status", "clock-frequency", "#address-cells", "#size-cells"]);
        expect(overlay.effective_node(I2C)?.properties.find(p => p.name === "clock-frequency")).toEqual(frequency(400_000n));
        expect(overlay.property_node(I2C, "clock-frequency")).toBe(overlay.overlay_nodes_at(I2C)[1]);
        expect(overlay.property_node(I2C, "#size-cells")).toBe(overlay.overlay_nodes_at(I2C)[2]);
        expect(overlay.property_node(I2C, "nope")).toBeUndefined();
        const merged = overlay.merged_overlay_node(I2C);
        expect(merged?.properties.map(p => p.name)).toEqual(["status", "clock-frequency", "#address-cells", "#size-cells"]);
        expect(merged?.children.map(c => get_full_node_name(c))).toEqual(["adc@48"]);
        expect(overlay.merged_overlay_node("/soc")?.children.map(c => get_full_node_name(c))).toEqual(["i2c@7e804000"]);
        expect(overlay.merged_overlay_node("/nowhere")).toBeUndefined();
    });

    test("add_fragment / remove_property — a property goes where its applied value is, and goes from every fragment", () => {
        const overlay = overlay_on(two_labels, split);
        overlay.add_fragment("i2c_arm", undefined, frequency(1_000_000n));
        const [first, second] = overlay.overlay_nodes_at(I2C);
        expect(first?.properties.find(p => p.name === "clock-frequency")).toEqual(frequency(100_000n));
        expect(second?.properties.find(p => p.name === "clock-frequency")).toEqual(frequency(1_000_000n));
        expect(overlay.remove_property("i2c1", "clock-frequency")).toBe(true);
        expect(overlay.property_node(I2C, "clock-frequency")).toBeUndefined();
        expect(overlay.remove_property("i2c1", "clock-frequency")).toBe(false);
    });

    test("get_fragment_root_path — targets that name each other resolve to nothing", () => {
        const overlay = overlay_on(fan_base, `/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&b>;\n\t\ta: __overlay__ {};\n\t};\n\tfragment@1 {\n\t\ttarget = <&a>;\n\t\tb: __overlay__ {};\n\t};\n};`);
        expect(overlay.get_fragment_root_path(fragment_with(overlay, "0"))).toBeUndefined();
        expect(overlay.get_fragment_root_path(fragment_with(overlay, "1"))).toBeUndefined();
    });
}
