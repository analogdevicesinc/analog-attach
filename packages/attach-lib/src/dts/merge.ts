import type { DtsDocument, DtsNode, DtsProperty } from './ast.js';
import { get_node_key, split_node_key } from './utilities.js';

export interface MergeOptions {
  /** When true, mark any newly created nodes as user-created. */
  mark_created_nodes?: boolean;
}

/**
*  Merge all properties from `from` into `into`, preserving earliest order. 
*/
function merge_properties(into: DtsNode, from: DtsNode) {
  const property_index_map = new Map<string, number>();

  let index = 0;
  for (const p of into.properties) {
    property_index_map.set(p.name, index++);
  }

  // Track if any properties are being merged
  let has_modifications = false;

  for (const p of from.properties) {
    const pos = property_index_map.get(p.name);

    if (pos === undefined) {
      const new_property = structuredClone(p);

      into.properties.push(new_property);
      property_index_map.set(p.name, into.properties.length - 1);
    } else {
      // incoming wins in content, but preserve base document order
      const incoming: DtsProperty = structuredClone(p);

      incoming.labels = [...incoming.labels, ...into.properties[pos].labels];

      // Preserve modifiedByUser flag from incoming
      into.properties[pos] = incoming;
    }

    has_modifications = true;
  }

  // If any properties were added/modified, mark the node as modified
  if (has_modifications && from.modified_by_user) {
    into.modified_by_user = true;
  }
}

export function merge_node(
  into: DtsNode,
  from: DtsNode,
  options?: MergeOptions,
) {
  // If the source node is marked as modified, mark the target as well
  if (from.modified_by_user) {
    into.modified_by_user = true;
  }

  into.deleted = false;

  // TODO: this is questionable but maybe spec?
  const set = new Set<string>;

  for (let index = from.labels.length; index > 0; index--) {
    set.add(from.labels[index - 1]);
  }

  for (const l of into.labels) {
    set.add(l);
  }

  into.labels = [...set];

  merge_properties(into, from);

  // Merge children recursively while tracking renames when provided
  const child_index_map = new Map<string, number>();
  let index = 0;

  for (const c of into.children) {
    child_index_map.set(get_node_key(c), index++);
  }

  for (const child of from.children) {
    const key = get_node_key(child);
    const pos = child_index_map.get(key);

    if (pos === undefined) {
      // Need to deep clone to avoid modifying the original
      const new_child = structuredClone(child);

      if (options?.mark_created_nodes) {
        new_child.created_by_user = true;
      }

      // eslint-disable-next-line unicorn/no-array-reverse
      new_child.labels = new_child.labels.reverse();

      into.children.push(new_child);
      child_index_map.set(key, into.children.length - 1);
    } else {
      const target = into.children[pos];

      merge_node(target, child, options);
    }
  }
}
/** 
* Merge two documents while reporting label renames during node merges. 
*/
export function merge_document(
  into: DtsDocument,
  from: DtsDocument,
  options?: MergeOptions,
) {
  // TODO: if only one memreserve can exist maybe this doesn't apply
  into.memreserves.push(...from.memreserves);
  merge_node(into.root, from.root, options);
}

export function find_node_by_label(root: DtsNode, label: string): DtsNode | undefined {
  if (root.labels.includes(label)) {
    return root;
  }

  for (const child of root.children) {
    const found = find_node_by_label(child, label);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/** 
* Resolve a node by absolute path like `/soc/interrupt-controller@40000`. 
*/
export function find_node_by_path(root: DtsNode, path: string): DtsNode | undefined {
  // path is like /soc/interrupt-controller@40000
  if (path === "" || path[0] !== '/') {
    return undefined;
  }

  const parts = path.split('/').slice(1); // remove leading ''
  let current: DtsNode | undefined = root;
  if (parts.length === 1 && parts[0] === "") {
    return current;
  }

  for (const part of parts) {
    if (current === undefined) {
      return undefined;
    }

    if (part === undefined) {
      continue;
    }

    const { name: name, unit: unit_addr } = split_node_key(part);

    current = current.children.find((n) => n.name === name && (unit_addr ? n.unit_addr === unit_addr : true));

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

export function delete_node_by_label(root: DtsNode, label: string): boolean {
  return delete_where(root, (n) => n.labels.includes(label));
}

export function delete_node_by_key(root: DtsNode, key: string): boolean {
  return delete_where(root, (n) => get_node_key(n) === key);
}

function delete_where(parent: DtsNode, pred: (n: DtsNode) => boolean): boolean {
  for (const child of parent.children) {

    if (pred(child) === true) {
      delete_node(child);
      return true;
    }

    if (delete_where(child, pred) === true) {
      return true;
    }
  }

  return false;
}

function delete_node(node: DtsNode) {

  node.deleted = true;
  node.properties = [];
  node.labels = [];

  for (const property of node.properties) {
    property.deleted = true;
    property.labels = [];
  }

  for (const child of node.children) {
    delete_node(child);
  }
}