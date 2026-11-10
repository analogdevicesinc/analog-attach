// Main entry point for attach-lib package.
// The public surface is restricted to what the CLI (packages/cli) consumes; add exports
// here deliberately rather than via `export *`.

// Binding pipeline, validation and structural types
export { Attach, type BindingParseError } from './Attach/Attach.js';
export {
    PARSE_STEPS,
    fixup_passes,
    expand_pattern,
    AttachEnumType,
    is_list,
    is_open,
    is_open_list,
    list_cell,
    matrix_cell,
    property_definition,
    type ParseOptions,
    type StepInfo,
    type FixupPass,
    type TraceEvent,
    type PipelineTracer,
    type SchemaPaths,
    type ControllerContext,
    type ResolvedProperty,
    type PatternPropertyRule,
    type PropertyPatternRule,
    type ParsedBinding,
    type PropertyDefinition,
    type PatternExpansion,
    type AttachType,
    type Cell,
    type EnumOption,
    type List,
} from './Bindings/index.js';
export { populate_binding, populate_properties, type PopulateOptions } from './Attach/Populate.js';
export { Result } from './result.js';
export { references_to, unresolved_references, unresolved_targets, type ReferenceTo, type UnresolvedReference, type UnresolvedTarget } from './Devicetree/checks/References.js';
export { node_data, node_data_json } from './Attach/NodeData.js';
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
} from './Devicetree/syntax/AST.js';
export { is_enabled, cell_extract_first_value, type LocatedNode, type NodeTarget } from './Devicetree/nodes/Access.js';
export { print_property, type OverlaySyntax, type DtoPrintOptions } from './Devicetree/syntax/Printer.js';
export type { CellInput, CellValue, NumberRepr } from './Devicetree/build/Cells.js';
export { NodeBuilder } from './Devicetree/build/NodeBuilder.js';
export { PropertyBuilder } from './Devicetree/build/PropertyBuilder.js';
export { DeviceTree } from './Devicetree/DeviceTree.js';
export { DeviceTreeOverlay, type FoundNodeResult } from './Devicetree/DeviceTreeOverlay.js';

// Unit address and label utilities (Group C)
export {
    parse_unit_address,
    format_unit_address,
    encode_reg_address,
    decode_reg_address,
    next_free_unit_address,
    sync_unit_address_from_reg,
    unit_radix,
    type UnitRadix,
    type SyncResult,
} from './Devicetree/nodes/UnitAddress.js';
export { address_cells_of, ensure_address_cells, type AddressCells } from './Devicetree/AddressCells.js';
export {
    is_valid_label,
    is_valid_node_name,
    is_valid_unit_address,
    label_from_compatible,
    unique_label,
    choose_label,
    type LabelChoice,
} from './Devicetree/nodes/Labels.js';
export { add_node, type AddNodeRequest, type AddNodeNote, type AddNodeResult } from './Devicetree/AddNode.js';
export { reg_conflicts, sibling_reg_conflicts, chip_select_overflows, sibling_chip_select_overflows, reg_entries, is_active, type RegConflict, type ChipSelectOverflow, type ChipSelects, type RegEntry } from './Devicetree/checks/RegConflicts.js';

// Intelligence: queries, parent suggestions, layers, interrupt parent
export * from './Intelligence/index.js';
