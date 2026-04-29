import type {
  DtsDocument,
  DtsNode,
  DtsProperty,
  UnresolvedOverlay,
} from "../dts/ast.js";
// FIXME: Should ast be in the dts folder or should it be in AttachLib at the base level

import {
  print_property,
} from "../dts/printer.js";

/**
 * Builds a map of paths to labels for the entire document tree.
 * This allows us to lookup if any path has a label.
 */
function buildLabelMap(root: DtsNode): Map<string, string> {
  const labelMap = new Map<string, string>();

  function traverse(node: DtsNode, currentPath: string) {
    const nodeKey = node.name === '/' ? '/' : (node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name);
    const nodePath = node.name === '/' ? '/' : `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${nodeKey}`;

    if (node.labels && node.labels.length > 0) {
      labelMap.set(nodePath, node.labels[0]);
    }

    for (const child of node.children) {
      traverse(child, nodePath);
    }
  }

  traverse(root, '');
  return labelMap;
}


/**
 * Print a DtsDocument as a device tree overlay (.dtso) containing only nodes
 * and properties that have been modified by the user (marked with modifiedByUser flag).
 *
 * This generates overlay syntax with label references when available, falling back to path references.
 */
export function printDtso(document: DtsDocument): string {
  const indent = "\t";
  const out: string[] = [];

  out.push("/dts-v1/;\n", "/plugin/;\n\n");

  // Build label map so we can save it simply as a label
  const labelMap = buildLabelMap(document.root);

  // Find all nodes that need to be printed as top-level overlay targets
  const overlayTargets = findOverlayTargets(document.root, labelMap);

  for (const target of overlayTargets) {
    const content = printOverlayTarget(target, indent);
    if (content) {
      out.push(content);
    }
  }

  // Print any unresolved overlays
  if (document.unresolved_overlays) {
    for (const unresolvedOverlay of document.unresolved_overlays) {
      const content = printUnresolvedOverlay(unresolvedOverlay, indent);
      if (content) {
        out.push(content);
      }
    }
  }

  return out.join("");
}

/**
 * Represents a target node for overlay printing
 */
interface OverlayTarget {
  node: DtsNode;
  path: string;
  label?: string;
  modifiedProperties: DtsProperty[];
  modifiedChildren: DtsNode[];
}

/**
 * Find all nodes that should be printed as top-level overlay targets.
 * This identifies the optimal points to reference with labels or paths,
 * prioritizing labeled nodes and avoiding redundant targets.
 */
function findOverlayTargets(root: DtsNode, labelMap: Map<string, string>): OverlayTarget[] {
  const targets: OverlayTarget[] = [];

  function traverse(node: DtsNode, currentPath: string): boolean {
    const nodeKey = node.name === '/' ? '/' : (node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name);
    const nodePath = node.name === '/' ? '/' : `${currentPath}${currentPath.endsWith('/') ? '' : '/'}${nodeKey}`;

    const modifiedProperties = node.properties.filter(p => p.modified_by_user);
    const modifiedChildren: DtsNode[] = [];

    for (const child of node.children) {
      if (!hasModifications(child)) {
        continue;
      }

      if (isUserCreatedSubtree(child)) {
        // This child (and its descendants) are entirely new, so they must be emitted inside the current target.
        modifiedChildren.push(child);
        continue;
      }

      const childHandledSeparately = traverse(child, nodePath);

      if (!childHandledSeparately) {
        // No additional handling needed at this level because the child's modifications
        // were fully emitted as deeper targets.
        continue;
      }
    }

    const shouldCreateTarget = modifiedProperties.length > 0 || modifiedChildren.length > 0;

    if (shouldCreateTarget) {
      const label = labelMap.get(nodePath);
      targets.push({
        node,
        path: nodePath,
        label,
        modifiedProperties,
        modifiedChildren
      });
      return true;
    }

    return false;
  }

  traverse(root, '');
  return targets;
}

/**
 * Print a single overlay target
 */
function printOverlayTarget(target: OverlayTarget, indent: string): string {
  // Determine how to reference this target
  const referenceName = target.label ? `&${target.label}` : `&{${target.path}}`;

  let out = `${referenceName} {\n`;
  const pad = indent.repeat(1);
  const hasStatusProperty = target.modifiedProperties.some(property => property.name === 'status');
  const hasNewChildNode = target.modifiedChildren.some(child => child.modified_by_user);
  const needsStatusProperty = !hasStatusProperty && hasNewChildNode;
  if (needsStatusProperty) {
    out += `${pad}status = "okay";\n`;
  }

  // Print modified properties
  for (const property of target.modifiedProperties) {
    out += print_property(property, indent, 1);
  }

  // Print modified children (these are children without their own labels)
  for (const child of target.modifiedChildren) {
    out += printChildNode(child, indent, 1, target.path);
  }

  out += `};\n`;
  return out;
}

/**
 * Print a child node within an overlay target
 */
function printChildNode(node: DtsNode, indent: string, depth: number, parentPath: string): string {
  const pad = indent.repeat(depth);
  const currentKey = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
  const currentPath = `${parentPath}${parentPath.endsWith('/') ? '' : '/'}${currentKey}`;

  // Child nodes within labeled parents use simple names
  let name = node.unit_addr ? `${node.name}@${node.unit_addr}` : node.name;
  const labels = (node.labels ?? []).map((l) => `${l}: `).join("");

  let out = `${pad}${labels}${name} {\n`;

  // Print all properties (both modified and unmodified in child context)
  const modifiedProperties = node.properties.filter(p => p.modified_by_user);
  for (const property of modifiedProperties) {
    out += print_property(property, indent, depth + 1);
  }

  // Print modified children recursively
  for (const child of node.children) {
    if (hasModifications(child)) {
      out += printChildNode(child, indent, depth + 1, currentPath);
    }
  }

  out += `${pad}};\n`;
  return out;
}


/** Check if a node or any of its descendants have modifications */
function hasModifications(node: DtsNode): boolean {
  // Check if the node itself is modified
  if (node.modified_by_user) {
    return true;
  }

  // Check if any properties are modified
  if (node.properties.some(property => property.modified_by_user)) {
    return true;
  }

  // Check if any children have modifications
  return node.children.some(child => hasModifications(child));
}

/** Determine if the node represents content created by the user (not present in the base tree). */
function isUserCreatedSubtree(node: DtsNode): boolean {
  return node.created_by_user === true;
}

/**
 * Print an unresolved overlay
 */
function printUnresolvedOverlay(unresolvedOverlay: UnresolvedOverlay, indent: string): string {
  // Determine how to reference the target
  const referenceName = unresolvedOverlay.overlay_target_ref.ref.kind === 'label'
    ? `&${unresolvedOverlay.overlay_target_ref.ref.name}`
    : `&{${unresolvedOverlay.overlay_target_ref.ref.path}}`;

  let out = `${referenceName} {\n`;
  const pad = indent.repeat(1);
  const hasStatusProperty = unresolvedOverlay.overlay_node.properties.some(property => property.name === 'status');
  const hasNewChildNode = unresolvedOverlay.overlay_node.children.some(child => child.modified_by_user);
  const needsStatusProperty = !hasStatusProperty && hasNewChildNode;
  if (needsStatusProperty) {
    out += `${pad}status = "okay";\n`;
  }

  // Print all properties from the overlay node
  for (const property of unresolvedOverlay.overlay_node.properties) {
    out += print_property(property, indent, 1);
  }

  // Print all children from the overlay node
  for (const child of unresolvedOverlay.overlay_node.children) {
    out += printChildNode(child, indent, 1, '');
  }

  out += `};\n`;
  return out;
}
