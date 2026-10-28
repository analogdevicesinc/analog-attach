export {
    is_interrupt_controller,
    is_clock,
    is_regulator,
    is_gpio_controller,
    is_dma_controller,
    is_pwm_controller,
} from "./predicates.js";

export {
    find_nodes,
    node_label,
    phandle_name,
    phandle_names,
    labelled_providers,
} from "./providers.js";

export {
    query_devicetree,
    value_to_macro,
    is_gpio_property,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    gpio_row_cells,
    type GpioRowCell,
    type MacroDefinition,
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

// Layered intelligence: binding → devicetree → …
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
export { devicetree_layer, creatable_providers } from "./layers/devicetree.js";
export { placement_from_overlay } from "./layers/placement.js";

// Interrupt parent resolution
export {
    effective_interrupt_parent,
    base_lookup,
    overlay_lookup,
    type InterruptParentInfo,
    type NodeLookup,
} from "./interrupt_parent.js";
