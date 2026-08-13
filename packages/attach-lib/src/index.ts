// Main entry point for attach-lib package
// Re-export all public APIs

export * from './Attach/Attach.js';
export * from './Attach/AttachTypes.js';
export * from './Attach/DtBindingSchema.js';
export * from './Attach/StructuralTypes.js';
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
export * from './Devicetree/index.js';

// binding resolving
export * from './Bindings/index.js';

// DT Query — legacy implementation kept for internal use; only extract_compatible re-exported
export { extract_compatible } from './DtQuery.js';
// New intelligence module (DeviceTree-based)
export * from './Intelligence/index.js';

// BigInt Serialization
export * from './BigIntSerializer.js';
