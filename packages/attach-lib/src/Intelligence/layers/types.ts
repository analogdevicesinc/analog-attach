import { ParsedBinding, ResolvedProperty } from "../../Attach/AttachTypes.js";
import { DeviceTree } from "../../Devicetree/index.js";
import { PathAndLabel } from "../parents.js";

// Where a node sits in the combined base tree + overlay. Layers that reason
// about physical wiring (e.g. board descriptions) infer slots from it.
export type NodePlacement = {
    /** Absolute path of the node itself. */
    node_path: string;
    /** Absolute path of the parent node ("/" for top-level nodes). */
    parent_path: string;
    /** First cell of the node's `reg`, when it is a number. */
    reg?: bigint;
    /** Other enabled children of the parent (base tree merged with the overlay). */
    siblings: { name: string; reg?: bigint }[];
};

export type PropertyContext = {
    /** Base device tree. */
    devicetree: DeviceTree;
    /** Current node values as validator-input JSON (see `dt_to_validator_input`). */
    data: string;
    /** Same semantics as the `parent_name` argument of `query_devicetree`. */
    parent_name?: string;
    placement?: NodePlacement;
    /** The node's resolved binding, when the consumer has one: lets the binding layer offer values it pins. */
    binding?: Pick<ParsedBinding, "required_properties" | "properties">;
};

// One DTS cell element. Kept structured so each consumer can serialise it
// (CLI `--with` syntax, webview widgets, DTS text).
export type SuggestedCell = bigint | { label: string } | { macro: string };

export type ValueSuggestion = {
    /** Cell rows: `<a b>, <c d>` is `[[a, b], [c, d]]`. Empty when the value is `strings` or a `flag`. */
    rows: SuggestedCell[][];
    /** A string-list value (`"a", "b"`) instead of cells. */
    strings?: string[];
    /** A boolean property: present (true) or absent (false), instead of cells. */
    flag?: boolean;
    display: string;
    /** Name of the layer that produced the suggestion. */
    source: string;
    /** Provenance within the source (e.g. board slot ids). */
    slots?: string[];
    /** Extra caveat, e.g. "in use by adc@0". */
    note?: string;
};

export type PlacementSuggestion = {
    parent: PathAndLabel;
    reg?: bigint;
    slot?: string;
    display: string;
    source: string;
};

// A layer of context used when configuring a peripheral. Layers are stacked
// from least to most system-specific (binding → devicetree → board → …); each
// operation receives the results of the layers below it and may annotate,
// narrow or extend them. Every operation is optional.
export interface IntelligenceLayer {
    readonly name: string;

    /** Schema-level refinement of a binding's properties. */
    refine_properties?(properties: ResolvedProperty[], context: PropertyContext): ResolvedProperty[];

    /** Concrete candidate values for one property of the node in `context`. */
    suggest_values?(property: string, context: PropertyContext, lower: ValueSuggestion[]): ValueSuggestion[];

    /** Where a device with this binding can be attached. */
    suggest_placement?(binding: ParsedBinding, devicetree: DeviceTree, lower: PlacementSuggestion[]): PlacementSuggestion[];
}
