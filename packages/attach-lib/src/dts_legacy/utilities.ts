import type { DtsDocument, DtsNode, UnresolvedOverlay } from './ast';

/** Mark all nodes and properties in the tree as modified by user */
export function markNodesModified(node: DtsNode) {
    node.modified_by_user = true;

    // Mark all properties
    for (const property of node.properties) {
        property.modified_by_user = true;
    }

    // Recursively mark children
    for (const child of node.children) {
        markNodesModified(child);
    }
}

export function get_node_key(n: DtsNode): string {
    if (n.name === '/') {
        return '/';
    }

    return n.unit_addr ? `${n.name}@${n.unit_addr}` : n.name;
}

/**
 * Search a document for a node identified by, in priority order:
 * - `&{/absolute/path}` or bare `/absolute/path`
 * - `&label` or a bare label
 */
export function search_node_in_dts(document: DtsDocument, node_identifier: string): { found_node: DtsNode, found_path: string, parent: string, parent_node?: DtsNode } | undefined {

    const identifier = node_identifier.trim();

    if (identifier.startsWith("&{") && identifier.endsWith("}")) {
        return search_node_by_path(document.root, identifier.slice(2, -1));
    }

    if (identifier.startsWith("&")) {
        const label = identifier.slice(1);
        return search_node_by_predicate(document.root, [document.root.name], (node) => node.labels.includes(label));
    }

    if (identifier.startsWith("/")) {
        return search_node_by_path(document.root, identifier);
    }

    return search_node_by_predicate(document.root, [document.root.name], (node) => node.labels.includes(identifier));
}

export function search_node_in_unresolved_overlays(unresolved_overlays: Array<UnresolvedOverlay>, node_name: string): { node: DtsNode, parent: string, parent_node?: DtsNode } | undefined {

    const { name, unit } = split_node_key(node_name);

    for (const unresolved of unresolved_overlays) {

        const node = search_node_by_predicate(
            unresolved.overlay_node,
            [unresolved.overlay_node.name],
            (candidate) => candidate.name === name && candidate.unit_addr === unit
        );

        if (node !== undefined) {
            return { node: node.found_node, parent: node.parent, parent_node: node.parent_node };
        }
    }

    return undefined;
}

function search_node_by_predicate(root: DtsNode, path: string[], predicate: (node: DtsNode) => boolean, parent_node?: DtsNode): { found_node: DtsNode, found_path: string, parent: string, parent_node?: DtsNode } | undefined {

    const node_path = build_path(path);

    if (predicate(root)) {
        return {
            found_node: root,
            found_path: node_path,
            parent: root.labels.at(-1) ?? node_path,
            parent_node: parent_node
        };
    }

    for (const child of root.children) {
        const child_key = child.unit_addr !== undefined ? `${child.name}@${child.unit_addr}` : child.name;
        const next = search_node_by_predicate(child, [...path, child_key], predicate, root);

        if (next === undefined) {
            continue;
        } else {
            return next;
        }
    }

    return;
}

function build_path(path: string[]): string {
    const output = path.join("/");

    if (output.startsWith("//")) {
        return output.slice(1);
    }

    return output;
}

/** Resolve a node by absolute path like `/soc/interrupt-controller@40000`, tracking its immediate parent along the way. */
function search_node_by_path(root: DtsNode, path: string): { found_node: DtsNode, found_path: string, parent: string, parent_node?: DtsNode } | undefined {
    if (path === "" || path[0] !== '/') {
        return undefined;
    }

    const parts = path.split('/').slice(1);

    let current: DtsNode = root;
    let parent_node: DtsNode | undefined;

    if (!(parts.length === 1 && parts[0] === "")) {
        for (const part of parts) {
            if (part === "") {
                continue;
            }

            const { name, unit } = split_node_key(part);

            const next: DtsNode | undefined = current.children.find(
                (n) => n.name === name && (unit ? n.unit_addr === unit : true)
            );

            if (next === undefined) {
                return undefined;
            }

            parent_node = current;
            current = next;
        }
    }

    return {
        found_node: current,
        found_path: path,
        parent: current.labels.at(-1) ?? path,
        parent_node: parent_node
    };
}

export function split_node_key(node_key: string): { name: string; unit?: string } {
    const at = node_key.indexOf('@');

    if (at === -1) {
        return { name: node_key };
    }

    return {
        name: node_key.slice(0, at),
        unit: node_key.slice(at + 1)
    };
}
