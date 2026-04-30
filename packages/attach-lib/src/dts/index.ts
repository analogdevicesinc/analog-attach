// Public API surface: types and core operations.
export * from "./ast.js";
export { parse_dts, parse_dto, ensure_node_by_path } from "./parser.js";
export { print_dts as printDts, print_dto, print_value } from "./printer.js";
export { merge_document as mergeDocument, merge_node as mergeNode } from "./merge.js";
export { markNodesModified, search_node_in_dts, } from "./utilities.js";
