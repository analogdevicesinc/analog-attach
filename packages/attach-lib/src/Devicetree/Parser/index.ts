// Public API surface: types and core operations.
export * from "./AST.js";
export type { DTSParseResult } from "./Parser.js";
export { parse_dts, parse_dto } from "./Parser.js";
export { print_dts, print_dto, print_value, print_property } from "../Printer.js";
