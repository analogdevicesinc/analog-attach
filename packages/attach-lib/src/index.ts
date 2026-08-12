// Main entry point for attach-lib package
// Re-export all public APIs

export * from './Attach.js';
export * from './AttachTypes.js';
export * from './DtBindingSchema.js';
export * from './StructuralTypes.js';
export * from './RegexExpansion.js';

// DTS parsing and manipulation — legacy (dts_legacy types prefixed with Dts*)
export {
    type DtsDocument, type DtsNode, type DtsProperty, type DtsValue, type DtsValueComponent,
    type DtsString, type DtsByteArray, type DtsCellArray, type DtsReference,
    type CellArrayNumber, type CellArrayU64, type ConstExpression, type Macro,
    type UnresolvedOverlay, type DtsMetadata, type AbsolutePathToDTSNode,
    isDtsMetadata, isAbsolutePathToDTSNode, isArrayOfAbsolutePathToDTSNode,
    parseDtsWithLabelMap, ensure_node_by_path,
    printDts,
    mergeDocument, mergeNode,
    markNodesModified, search_node_in_dts, search_node_in_unresolved_overlays, get_node_key,
} from './dts_legacy/index.js';
export * from './dtso/index.js';

// New DTS AST, parser, printer, and ergonomic wrappers
export * from './Devicetree/parser/index.js';
export { DeviceTree, DeviceTreeOverlay, type DTReference, type TraversalOrder, type UnitAddr, type FoundNodeResult } from './Devicetree.js';
export { NodeBuilder, type INodeBuilderBase } from './Devicetree/NodeBuilder.js';
export { PropertyBuilder } from './Devicetree/PropertyBuilder.js';
export type { CellValue } from './Devicetree/Types.js';

// binding resolving
export * from './binding-processor/index.js';

// DT Query — legacy implementation kept for internal use; only extract_compatible re-exported
export { extract_compatible } from './DtQuery.js';
// New intelligence module (DeviceTree-based)
export * from './intelligence/index.js';

// BigInt Serialization
export * from './BigIntSerializer.js';
