import { DeviceTree, DTNode, is_enabled, type LocatedNode } from "../Devicetree/index.js";

export function find_nodes(
    dt: DeviceTree,
    predicate: (node: DTNode) => boolean,
): LocatedNode[] {
    return dt.as_stream()
        .filter((element) => predicate(element))
        .toArray()
        .map(([node, path]) => ({ node, path: path.path }));
}

export function node_label(node: DTNode): string | undefined {
    return node.labels.at(-1);
}

export function phandle_name(located: LocatedNode): string {
    return node_label(located.node) ?? `&{${located.path}}`;
}

export function phandle_names(
    dt: DeviceTree,
    predicate: (node: DTNode) => boolean,
): string[] {
    return find_nodes(dt, predicate).map(located => phandle_name(located));
}

export function labelled_providers(
    dt: DeviceTree,
    predicate: (node: DTNode) => boolean,
): { label: string; node: DTNode }[] {
    return find_nodes(dt, predicate).flatMap(({ node }) => {
        const label = node_label(node);
        return label === undefined || !is_enabled(node) ? [] : [{ label, node }];
    });
}
