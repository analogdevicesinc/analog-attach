// Public API surface: types and core operations.
export * from "./ast.js";
export { parse_dts, parse_dts_and_label_map as parseDtsWithLabelMap, ensure_node_by_path } from "./parser.js";
export { print_dts as printDts } from "./printer.js";
export { merge_document as mergeDocument, merge_node as mergeNode } from "./merge.js";
export { markNodesModified } from "./utilities.js";
