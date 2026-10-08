// Main entry point for attach-lib package.
// The public surface is restricted to what attach-cli consumes; add exports
// here deliberately rather than via `export *`.

// Binding pipeline, validation and structural types
export { Attach, type PopulateOptions } from './Attach/Attach.js';
export type { ResolvedProperty, PatternPropertyRule, ParsedBinding } from './Attach/AttachTypes.js';
export {
    AttachEnumType,
    to_attach_array,
    type AttachArray,
    type AttachType,
} from './Attach/StructuralTypes.js';
export { dt_to_validator_input } from './Attach/DTxBinding.js';

// DTS AST, printer and ergonomic wrappers
export {
    get_full_node_name,
    is_dt_flag,
    type DTNode,
    type DTProperty,
    type DTValue,
    type DTLabel,
    type DTPath,
    type CellArrayElement,
} from './Devicetree/Parser/AST.js';
export { print_property, type OverlaySyntax, type DtoPrintOptions } from './Devicetree/Printer.js';
export type { CellValue, FoundNodeResult } from './Devicetree/Types.js';
export { NodeBuilder } from './Devicetree/NodeBuilder.js';
export { PropertyBuilder } from './Devicetree/PropertyBuilder.js';
export { DeviceTree } from './Devicetree/Devicetree.js';
export { DeviceTreeOverlay } from './Devicetree/DevicetreeOverlay.js';

// Intelligence: queries, parent suggestions and layers
export {
    query_devicetree,
    cell_extract_first_value,
    INTERRUPT_MACROS,
    GPIO_MACROS,
} from './Intelligence/query.js';
export { parent_path_string, suggest_parents, extract_compatible } from './Intelligence/parents.js';
export { insert_known_structures } from './Intelligence/known_properties.js';
export type {
    NodePlacement,
    SuggestedCell,
    ValueSuggestion,
} from './Intelligence/layers/types.js';
export { IntelligenceStack } from './Intelligence/layers/stack.js';
export { placement_from_overlay } from './Intelligence/layers/placement.js';

// Board descriptions
export type { BoardDescription } from './Intelligence/board/types.js';
export { parse_board_description } from './Intelligence/board/parse.js';
export { bus_chip_selects, exclusions_of, exclusive_slots, gpio_usage, shared_with, type GpioUse, type SharedLine, type SlotExclusion } from './Intelligence/board/derived.js';
export { board_layer, describe_slot, describe_placement, type BoardLayer } from './Intelligence/board/layer.js';
