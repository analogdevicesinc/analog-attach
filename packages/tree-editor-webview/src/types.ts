import { FormElement } from "extension-protocol";

export type TreeNode = {
    // ui state
    label: string;
    hasErrors?: boolean;
    expanded: boolean;
    selected?: boolean;
    children?: TreeNode[];
    // node data
    data: FormElement;
}

/**
 * A single segment in a navigation path.
 *
 * Stores enough information to uniquely identify a node even when siblings
 * share the same `key` (e.g. multiple `memory` nodes aliased as sram0 / sram1).
 *
 * Resolution priority: uid → key + label → key only.
 */
export interface PathSegment {
    /** FormElement.key – the DTS node name */
    key: string;
    /** TreeNode.label (alias || key) – disambiguates siblings with the same key */
    label: string;
    /** FormObjectElement.deviceUID – present on nodes that the backend assigns a UUID */
    uid?: string;
}