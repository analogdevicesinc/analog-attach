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

export function search_node_in_dts(document: DtsDocument, node_name: string): DtsNode | undefined {

    const { name, unit } = split_node_key(node_name);

    const node = search_node_impl(document.root, name, unit);

    return node;
}

export function search_node_in_unresolved_overlays(unresolved_overlays: Array<UnresolvedOverlay>, node_name: string): DtsNode | undefined {

    const { name, unit } = split_node_key(node_name);

    for (const unresolved of unresolved_overlays) {
        const node = search_node_impl(unresolved.overlay_node, name, unit);
        if (node !== undefined) {
            return node;
        }
    }

    return undefined;
}

function search_node_impl(root: DtsNode, name: string, unit?: string): DtsNode | undefined {

    for (const child of root.children) {
        if (child.name === name && child.unit_addr === unit) {
            return child;
        }
        search_node_impl(child, name, unit);
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