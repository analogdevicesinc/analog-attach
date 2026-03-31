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

export function search_node_in_dts(document: DtsDocument, node_name: string): { found_node: DtsNode, parent: string } | undefined {

    const { name, unit } = split_node_key(node_name);

    const node = search_node_impl(document.root, [document.root.name], name, unit);

    return node;
}

export function search_node_in_unresolved_overlays(unresolved_overlays: Array<UnresolvedOverlay>, node_name: string): { node: DtsNode, parent: string } | undefined {

    const { name, unit } = split_node_key(node_name);

    for (const unresolved of unresolved_overlays) {

        const node = search_node_impl(unresolved.overlay_node, [unresolved.overlay_node.name], name, unit);

        if (node !== undefined) {
            return { node: node.found_node, parent: node.parent };
        }
    }

    return undefined;
}

function search_node_impl(root: DtsNode, path: string[], name: string, unit?: string): { found_node: DtsNode, parent: string } | undefined {

    if (root.name === name && root.unit_addr === unit) {
        const actual_path: string = (() => {
            let output = path.join("/");
            if (output.startsWith("//")) {
                return output.slice(1);
            }
            return output;
        })();

        return {
            found_node: root,
            parent: root.labels.at(-1) ?? actual_path
        };
    }

    for (const child of root.children) {
        const next = search_node_impl(child, [...path, child.name], name, unit);

        if (next === undefined) {
            continue;
        } else {
            return next;
        }
    }

    return;
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