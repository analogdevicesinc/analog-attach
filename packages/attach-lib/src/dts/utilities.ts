import type { DtsNode } from './ast';

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