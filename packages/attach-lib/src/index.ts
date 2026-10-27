// Main entry point for attach-lib package.
// The public surface is restricted to what attach-cli consumes; add exports
// here deliberately rather than via `export *`.

// Binding pipeline, validation and structural types
export { Attach, type ParseOptions, type BindingParseError } from './Attach/Attach.js';
export { populate_binding, populate_properties, type PopulateOptions } from './Attach/Populate.js';
export type { SchemaPaths } from './Bindings/Context.js';
export { Result } from './result.js';
export { type ControllerContext, filter_vendor_peripheral_properties } from './Bindings/VendorPeripheralFilter.js';
export type { ResolvedProperty, PatternPropertyRule, PropertyPatternRule, ParsedBinding } from './Bindings/ParsedBinding.js';
export { expand_pattern, type PatternExpansion } from './RegexExpansion.js';
export { unresolved_references, unresolved_targets, type UnresolvedReference, type UnresolvedTarget } from './Devicetree/References.js';
export {
    AttachEnumType,
    is_list,
    is_open,
    is_open_list,
    list_cell,
    type AttachType,
    type Cell,
    type EnumOption,
    type List,
} from './Bindings/StructuralTypes.js';
export { dt_to_validator_input, validator_input_json } from './Attach/DTxBinding.js';
export { missing_required, PROPERTY_DEPENDENCIES } from './Attach/NodeState.js';

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
export { is_enabled, cell_extract_first_value, type LocatedNode, type NodeTarget } from './Devicetree/Access.js';
export { print_property, type OverlaySyntax, type DtoPrintOptions } from './Devicetree/Printer.js';
export type { CellValue, FoundNodeResult, NumberRepr } from './Devicetree/Types.js';
export { NodeBuilder } from './Devicetree/NodeBuilder.js';
export { PropertyBuilder } from './Devicetree/PropertyBuilder.js';
export { DeviceTree } from './Devicetree/Devicetree.js';
export { DeviceTreeOverlay } from './Devicetree/DevicetreeOverlay.js';

// Unit address and label utilities (Group C)
export {
    parse_unit_address,
    format_unit_address,
    address_cells_of,
    encode_reg_address,
    decode_reg_address,
    next_free_unit_address,
    ensure_address_cells,
    sync_unit_address_from_reg,
    unit_radix,
    type AddressCells,
    type UnitRadix,
    type SyncResult,
} from './Devicetree/UnitAddress.js';
export {
    is_valid_label,
    label_from_compatible,
    unique_label,
    choose_label,
    type LabelChoice,
} from './Devicetree/Labels.js';
export { add_node, type AddNodeRequest, type AddNodeNote, type AddNodeResult } from './Devicetree/AddNode.js';
export { reg_conflicts, sibling_reg_conflicts, chip_select_overflows, sibling_chip_select_overflows, reg_entries, is_active, type RegConflict, type ChipSelectOverflow, type RegEntry } from './Devicetree/RegConflicts.js';

// Intelligence: queries, parent suggestions, layers, board, interrupt parent
export * from './Intelligence/index.js';
