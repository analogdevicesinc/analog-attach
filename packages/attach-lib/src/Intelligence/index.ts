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
    INTERRUPT_MACROS,
    GPIO_MACROS,
} from "./query.js";

export {
    suggest_parents,
    suggest_parents_impl,
    DTCommDeviceTypes,
    type PathAndLabel,
} from "./parents.js";

export { insert_known_structures } from "./known_properties.js";
