import { parse_dts, ensure_node_by_path } from "../dts/parser.js";
import { merge_document, merge_node, find_node_by_label, find_node_by_path, type MergeOptions } from "../dts/merge.js";
import type { DtsDocument, DtsNode, } from "../dts/ast.js";
import { markNodesModified } from "../dts/utilities.js";

/** Parse a DTSO string and return an overlay document structure */
export function parseDtso(text: string): DtsDocument {
  // DTSO files are essentially DTS files with overlay syntax
  // They can start with:
  // 1. Root nodes (/ { ... })
  // 2. Label references (&label { ... })
  // 3. Path references (&{/path} { ... })
  return parse_dts(text, true);
}

/**
 * Merge a DTSO overlay into an existing document. TODO: eventually delete this
 * @param baseDocument The base device tree document
 * @param dtsoText The DTSO overlay text to merge
 * @param modifiedByUser If true, mark all nodes/properties from the overlay with modifiedByUser flag
 * @returns The merged document
 */
export function mergeDtso(baseDocument: DtsDocument, dtsoText: string, modifiedByUser: boolean = true): DtsDocument {
  // Parse the DTSO
  const overlayDocument = parseDtso(dtsoText);

  // Deep clone the base document to avoid modifying the original
  const mergedDocument = structuredClone(baseDocument);

  // Mark all nodes in the overlay with modifiedByUser flag if requested
  if (modifiedByUser) {
    markNodesModified(overlayDocument.root);
  }

  // Merge the overlay into the base document
  // The merge function already preserves the order from the base document for existing nodes
  const mergeOptions: MergeOptions | undefined = modifiedByUser ? { mark_created_nodes: true } : undefined;
  merge_document(mergedDocument, overlayDocument, mergeOptions);

  // Process any unresolved overlays from the DTSO
  if (overlayDocument.unresolved_overlays) {
    for (const unresolvedOverlay of overlayDocument.unresolved_overlays) {
      // Try to resolve the reference now that we have the base document
      let target: DtsNode | undefined;
      target = unresolvedOverlay.overlay_target_ref.ref.kind === 'label' ?
        find_node_by_label(mergedDocument.root, unresolvedOverlay.overlay_target_ref.ref.name) :
        find_node_by_path(mergedDocument.root, unresolvedOverlay.overlay_target_ref.ref.path);

      if (target) {
        // Mark the overlay nodes as modified
        if (modifiedByUser) {
          markNodesModified(unresolvedOverlay.overlay_node);
        }
        // Apply the overlay
        merge_node(target, unresolvedOverlay.overlay_node, mergeOptions);
        continue;
      }

      // Fallback: unresolved overlay. Prefer attaching under a placeholder
      // named after the label/path to keep a meaningful parent in UI.
      let fallbackParent: DtsNode | undefined;

      if (unresolvedOverlay.overlay_target_ref.ref.kind === 'label') {
        const placeholderName = unresolvedOverlay.overlay_target_ref.ref.name;
        fallbackParent = mergedDocument.root.children.find(
          (c) => c.name === placeholderName && c.unit_addr === undefined
        );
        if (!fallbackParent) {
          fallbackParent = {
            _uuid: crypto.randomUUID(),
            name: placeholderName,
            unit_addr: undefined,
            labels: [],
            properties: [],
            children: [],
            deleted: false,
            created_by_user: true,
            modified_by_user: true,
          };
          mergedDocument.root.children.push(fallbackParent);
        }
      } else {
        // Path ref: ensure a placeholder path exists (/a/b/c) to attach under
        const path = unresolvedOverlay.overlay_target_ref.ref.path;
        fallbackParent = ensure_node_by_path(mergedDocument.root, path);
        fallbackParent.modified_by_user = true;
      }

      console.warn(`Could not resolve overlay target: ${unresolvedOverlay.overlay_target_ref.ref.kind === 'label'
        ? unresolvedOverlay.overlay_target_ref.ref.name
        : unresolvedOverlay.overlay_target_ref.ref.path
        }, attaching overlay contents to placeholder '${fallbackParent.name}'.`);

      if (modifiedByUser) {
        markNodesModified(unresolvedOverlay.overlay_node);
      }

      merge_node(fallbackParent, unresolvedOverlay.overlay_node, mergeOptions);
    }
  }

  return mergedDocument;
}

/**
 * Check if a DTSO string contains any overlay syntax
 * (references starting with & or /plugin/ directive)
 */
export function isDtsoOverlay(text: string): boolean {
  // Quick check for common overlay patterns
  return text.includes('/plugin/') || /^\s*&/.test(text.trim());
}

/**
 * Parse DTSO and extract information about which nodes are being overlaid
 */
export interface DtsoOverlayInfo {
  /** Nodes referenced by label */
  labelReferences: string[];
  /** Nodes referenced by path */
  pathReferences: string[];
  /** Whether this is a plugin-style overlay */
  isPlugin: boolean;
}
