export {
    is_interrupt_controller,
    is_clock,
    is_regulator,
    is_gpio_controller,
    is_dma_controller,
    is_pwm_controller,
} from "./predicates.js";

export {
    query_devicetree,
    cell_extract_first_value,
    value_to_macro,
    is_gpio_property,
    INTERRUPT_MACROS,
    GPIO_MACROS,
} from "./query.js";

export {
    parent_path_string,
    suggest_parents,
    suggest_parents_impl,
    extract_compatible,
    DTCommDeviceTypes,
    type PathAndLabel,
} from "./parents.js";

export { insert_known_structures } from "./known_properties.js";

// Layered intelligence: binding → devicetree → board → …
export type {
    IntelligenceLayer,
    NodePlacement,
    PropertyContext,
    SuggestedCell,
    ValueSuggestion,
    PlacementSuggestion,
} from "./layers/types.js";
export { IntelligenceStack } from "./layers/stack.js";
export { binding_layer } from "./layers/binding.js";
export { devicetree_layer } from "./layers/devicetree.js";
export { placement_from_overlay } from "./layers/placement.js";

// Board descriptions (HATs, capes, shields, …) as an intelligence layer
export type {
    BoardDescription,
    BoardBus,
    BoardSlot,
    BoardSignal,
    BoardChipSelect,
    BusType,
    SignalKind,
} from "./board/types.js";
export { BUS_TYPES, SIGNAL_KINDS } from "./board/types.js";
export { parse_board_description } from "./board/parse.js";
export {
    bus_chip_selects,
    exclusions_of,
    exclusive_slots,
    gpio_usage,
    shared_with,
    slot_primary_reg,
    type ExclusionSide,
    type GpioUse,
    type SharedLine,
    type SlotExclusion,
} from "./board/derived.js";
export { resolve_bus_paths, slots_for_placement, type SlotInference } from "./board/slots.js";
export { board_layer, describe_slot, describe_placement, type BoardLayer } from "./board/layer.js";

// Interrupt parent resolution
export {
    effective_interrupt_parent,
    base_lookup,
    overlay_lookup,
    type InterruptParentInfo,
    type NodeLookup,
} from "./interrupt_parent.js";
