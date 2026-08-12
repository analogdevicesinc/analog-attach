import type { DTS, DTNode } from './Devicetree/Parser';

export function get_node_key(n: DTNode): string {
  if (n.name === '/') {
    return '/';
  }

  return `${n.name}@${n.unit_addr ?? ""}`;
}

export function search_node_in_dts(document: DTS, node_identifier: string): { found_node: DTNode, parent: string } | undefined {
  const [name, unit_addr] = node_identifier.split("@");
  return search_node_impl(document.root, [document.root.name], name, unit_addr);
}

function search_node_impl(root: DTNode, path: string[], name: string, unit?: string): { found_node: DTNode, parent: string } | undefined {

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

export function assert_never(_: never): never {
  throw new Error("Didn't expect to get here");
}
