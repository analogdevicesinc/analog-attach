import { ParsedBinding, ResolvedProperty } from "./AttachTypes.js";
import { DtsDocument, DtsNode, DtsProperty } from "./dts/ast.js";
import { AttachArray, AttachEnumType, FixedIndex } from "./StructuralTypes.js";

export enum DTCommDeviceTypes {
    SPI,
    I2C,
    FIXED_CLOCK,
    REGULATOR_FIXED,
}

export type PathAndLabel = {
    path: string[],
    label?: string,
};

export function value_to_macro(value: number, names: string[]): string | undefined {

    if (
        INTERRUPT_MACROS.every((entry) => names.includes(entry.name)) &&
        INTERRUPT_MACROS.length === names.length
    ) {
        return INTERRUPT_MACROS.find((entry) => entry.value === value)?.name;
    }

    if (
        GPIO_MACROS.every((entry) => names.includes(entry.name)) &&
        GPIO_MACROS.length === names.length
    ) {
        return GPIO_MACROS.find((entry) => entry.value === value)?.name;
    }

    return;
}

export const INTERRUPT_MACROS: { name: string, value: number }[] = [
    { name: "IRQ_TYPE_NONE", value: 0 },
    { name: "IRQ_TYPE_EDGE_RISING", value: 1 },
    { name: "IRQ_TYPE_EDGE_FALLING", value: 2 },
    { name: "IRQ_TYPE_EDGE_BOTH", value: 2 | 1 },
    { name: "IRQ_TYPE_LEVEL_HIGH", value: 4 },
    { name: "IRQ_TYPE_LEVEL_LOW", value: 8 }
];

export const GPIO_MACROS: { name: string, value: number }[] = [
    { name: "GPIO_ACTIVE_HIGH", value: 0 },
    { name: "GPIO_ACTIVE_LOW", value: 1 },
    { name: "GPIO_PUSH_PULL", value: 0 },
    { name: "GPIO_SINGLE_ENDED", value: 2 },
    { name: "GPIO_LINE_OPEN_SOURCE", value: 0 },
    { name: "GPIO_LINE_OPEN_DRAIN", value: 4 },
    { name: "GPIO_OPEN_DRAIN", value: 2 | 4 },
    // eslint-disable-next-line unicorn/prefer-math-trunc
    { name: "GPIO_OPEN_SOURCE", value: 2 | 0 },
    { name: "GPIO_PERSISTENT", value: 0 },
    { name: "GPIO_TRANSITORY", value: 8 },
    { name: "GPIO_PULL_UP", value: 16 },
    { name: "GPIO_PULL_DOWN", value: 32 },
    { name: "GPIO_PULL_DISABLE", value: 64 },
];

export function suggest_parents(devicetree: DtsDocument, node: ParsedBinding): PathAndLabel[] {

    const compatible = extract_compatible(node);

    if (compatible !== undefined) {

        if (compatible.includes("fixed-clock")) {
            return suggest_parents_impl(devicetree, [DTCommDeviceTypes.FIXED_CLOCK]);
        }

        if (compatible.includes("regulator-fixed")) {
            return suggest_parents_impl(devicetree, [DTCommDeviceTypes.REGULATOR_FIXED]);
        }
    }

    const spi_max_frequency = node.properties.some((value) => value.key === "spi-max-frequency");
    // eslint-disable-next-line unicorn/prevent-abbreviations
    const i2c_example = node.examples.some((example) => { return example.includes("i2c {"); });

    let suggestions: PathAndLabel[] = [];

    if (spi_max_frequency === true) {
        suggestions = [...suggestions, ...suggest_parents_impl(devicetree, [DTCommDeviceTypes.SPI])];
    }

    if (i2c_example === true) {
        suggestions = [...suggestions, ...suggest_parents_impl(devicetree, [DTCommDeviceTypes.I2C])];
    }

    // TODO: how to know to suggest i2c as well?

    // TODO: No suggestion means what ?
    return suggestions;
}

export function suggest_parents_impl(devicetree: DtsDocument, parent_types: DTCommDeviceTypes[]): PathAndLabel[] {

    let suggestions: PathAndLabel[] = [];

    for (const parent_type of parent_types) {
        switch (parent_type) {
            case DTCommDeviceTypes.I2C: {
                // eslint-disable-next-line unicorn/prevent-abbreviations
                const i2c_devices = filter_nodes_impl(
                    devicetree.root,
                    '/',
                    (node: DtsNode) => {

                        if (node.name !== 'i2c') {
                            return false;
                        }

                        const compatible_property = node.properties.find((property) => property.name === 'compatible');

                        if (compatible_property === undefined) {
                            return false;
                        }

                        const address_cells_property = node.properties.find((property) => property.name === "#address-cells");
                        const size_cells_property = node.properties.find((property) => property.name === "#size-cells");

                        if (address_cells_property === undefined || size_cells_property === undefined) {
                            return false;
                        }

                        return true;
                    });

                const paths: PathAndLabel[] = i2c_devices.map(
                    (device) => {
                        return {
                            path: ['/', ...device.path.split('/').slice(1)],
                            label: device.node.labels.at(0)
                        };
                    }
                );

                suggestions = [...suggestions, ...paths];

                break;
            }
            case DTCommDeviceTypes.SPI: {
                const spi_devices = filter_nodes_impl(
                    devicetree.root,
                    '/',
                    (node: DtsNode) => {
                        if (node.name !== 'spi') {
                            return false;
                        }

                        const compatible_property = node.properties.find((property) => property.name === 'compatible');

                        if (compatible_property === undefined) {
                            return false;
                        }

                        const address_cells_property = node.properties.find((property) => property.name === "#address-cells");
                        const size_cells_property = node.properties.find((property) => property.name === "#size-cells");

                        if (address_cells_property === undefined || size_cells_property === undefined) {
                            return false;
                        }

                        return true;
                    });

                const paths = spi_devices.map((device) => {
                    return {
                        path: ['/', ...device.path.split('/').slice(1)],
                        label: device.node.labels.at(0)
                    };
                });
                suggestions = [...suggestions, ...paths];

                break;
            }
            case DTCommDeviceTypes.FIXED_CLOCK: {
                const clock_definitions = filter_nodes_impl(
                    devicetree.root,
                    '/',
                    (node: DtsNode) => {
                        if (node.name !== 'clocks') {
                            return false;
                        }

                        // FIXME: This does not work with the
                        // linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
                        // that gets auto-preprocessed because it adds a
                        // compatible = "simple-bus"; to the "clocks" node.
                        // IDK if the issue is from these rules or the dts
                        // or the preprocess command (doubt).

                        // const compatible_property = node.properties.find(
                        //     (property) => property.name === 'compatible'
                        // );

                        // if (compatible_property !== undefined) {
                        //     return false;
                        // }

                        const clock_cells = node.properties.find(
                            (property) => property.name === "#clock-cells"
                        );

                        if (clock_cells !== undefined) {
                            return false;
                        }

                        return true;
                    });

                const paths = clock_definitions.map((device) => {
                    return {
                        path: ['/', ...device.path.split('/').slice(1)],
                        label: device.node.labels.at(0) ?? device.node.name
                    };
                });
                suggestions = [...suggestions, ...paths];

                break;
            }
            case DTCommDeviceTypes.REGULATOR_FIXED: {
                const paths = [{
                    path: ['/'],
                    label: '/'
                }];

                suggestions = [...suggestions, ...paths];

                break;
            }
            default: {
                const _x: never = parent_type;
                throw new Error("Exhaustion check failed");
            }
        }
    }

    return suggestions;
}

/**
 * @abstract Query a devicetree to find recommendations for the value of a property 
 * @returns {DtsNode[] | undefined} For a caller it might be of interest to know no query has been run
 */
export function query_devicetree(
    devicetree: DtsDocument,
    properties: ResolvedProperty[],
    data: string,
    parent_name?: string
): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);
    const parsed_data = JSON.parse(data);

    for (const property of properties_clone) {
        switch (property.key) {
            case "interrupt-parent": {

                let is_set = parsed_data["interrupt-parent"];

                if (is_set === undefined && parent_name !== undefined) {
                    const inherited = get_inherited_property(devicetree, parent_name, "interrupt-parent");

                    if (inherited !== undefined) {
                        is_set = cell_extract_first_value(inherited);
                    }
                } else if (
                    is_set !== undefined &&
                    Array.isArray(is_set) &&
                    is_set.length === 1 &&
                    typeof is_set[0] === 'string'
                ) {
                    is_set = is_set[0];
                }

                const interrupt_controllers = filter_nodes(devicetree.root, DTQuery.interrupt_controllers);

                const phandles: string[] = [];

                for (const interrupt_controller of interrupt_controllers) {

                    phandles.push(interrupt_controller.node.labels.at(-1) ?? `&{${interrupt_controller.path}}`);
                }

                if (is_set !== undefined) {

                    const set_interrupt_parent = is_set;

                    const parent = interrupt_controllers.find(
                        (value) => {
                            const name = value.node.labels.at(-1) ?? `&{${value.path}}`;
                            return name === set_interrupt_parent;
                        }
                    );

                    if (parent !== undefined) {

                        const interrupt_cells = parent.node.properties.find((value) => value.name === '#interrupt-cells');
                        if (interrupt_cells !== undefined) {
                            const new_length = cell_extract_first_value(interrupt_cells);

                            if (new_length !== undefined && typeof new_length === 'bigint') {

                                const new_interrupt = properties_clone.find((value) => value.key === "interrupts");

                                if (new_interrupt !== undefined &&
                                    new_interrupt.value._t === 'array'
                                ) {

                                    const new_value: AttachArray = {
                                        _t: 'fixed_index',
                                        prefixItems: [],
                                        minItems: Number(new_length),
                                        maxItems: Number(new_length)
                                    };

                                    for (let index = 0; index < Number(new_length) - 1; index++) {
                                        new_value.prefixItems.push({ _t: "number" });
                                    }

                                    new_value.prefixItems.push(
                                        {
                                            _t: "enum",
                                            enum: INTERRUPT_MACROS.map((value) => value.name),
                                            enum_type: AttachEnumType.MACRO
                                        });

                                    new_interrupt.value = {
                                        _t: "matrix",
                                        minItems: new_interrupt.value.minItems,
                                        maxItems: new_interrupt.value.maxItems,
                                        values: [new_value]
                                    };
                                }

                            }

                        }

                    }

                }

                property.value = {
                    _t: "enum_array",
                    minItems: 1,
                    maxItems: 1,
                    enum: phandles,
                    default: is_set,
                    enum_type: AttachEnumType.PHANDLE,
                };

                continue;
            }
            case "clocks": {
                const clocks = filter_nodes(devicetree.root, DTQuery.clocks);

                const phandles: string[] = [];

                for (const clock of clocks) {
                    phandles.push(clock.node.labels.at(-1) ?? `&{${clock.path}}`);
                }

                property.value = {
                    _t: "matrix",
                    minItems: 1,
                    maxItems: 1,
                    values: [
                        {
                            _t: "fixed_index",
                            minItems: 1,
                            maxItems: 1,
                            prefixItems: [
                                {
                                    _t: "enum",
                                    enum: phandles,
                                    enum_type: AttachEnumType.PHANDLE,
                                }
                            ]
                        }
                    ]
                };

                continue;
            }
            case "dmas": {

                let set_dma = parsed_data[property.key];

                if (set_dma === undefined ||
                    (Array.isArray(set_dma) && set_dma.length === 0)
                ) {

                    if (property.value._t !== 'array') {
                        continue;
                    }

                    const dmas = filter_nodes(devicetree.root, DTQuery.dmas);

                    const phandles: string[] = [];

                    for (const dma of dmas) {
                        phandles.push(dma.node.labels.at(-1) ?? `&{${dma.path}}`);
                    }

                    const prefix_items: FixedIndex[] = [{ _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE }];

                    property.value = {
                        _t: 'matrix',
                        minItems: property.value.minItems,
                        maxItems: property.value.maxItems,
                        values: [
                            {
                                _t: "fixed_index",
                                minItems: 1,
                                maxItems: 1,
                                prefixItems: prefix_items
                            }
                        ]
                    };

                    continue;
                } else if (
                    Array.isArray(set_dma) &&
                    set_dma.length > 0
                ) {
                    set_dma = set_dma.every((entry) => Array.isArray(entry)) ? set_dma[0][0] : set_dma[0];

                    const dmas = filter_nodes(devicetree.root, DTQuery.dmas);

                    const phandles: string[] = [];

                    for (const dma of dmas) {
                        phandles.push(dma.node.labels.at(-1) ?? `&{${dma.path}}`);
                    }

                    const node = dmas.find((value) => value.node.labels.at(-1) === set_dma);

                    if (node === undefined) {
                        // TODO: error handling
                        continue;
                    }

                    const dma_cells = node.node.properties.find((value) => value.name === "#dma-cells");

                    if (dma_cells !== undefined) {
                        const new_length = cell_extract_first_value(dma_cells);

                        if (new_length !== undefined && typeof new_length === 'bigint'
                        ) {
                            const new_value: AttachArray = {
                                _t: 'fixed_index',
                                prefixItems: [],
                                minItems: Number(new_length) + 1,
                                maxItems: Number(new_length) + 1,
                            };

                            new_value.prefixItems.push(
                                {
                                    _t: "enum",
                                    enum: phandles,
                                    default: set_dma,
                                    enum_type: AttachEnumType.PHANDLE
                                }
                            );

                            for (let index = 0; index < Number(new_length); index++) {
                                new_value.prefixItems.push(
                                    {
                                        _t: "number",
                                        minimum: 0n,
                                        maximum: 0xFF_FF_FF_FFn,
                                    }
                                );
                            }

                            property.value = {
                                _t: 'matrix',
                                minItems: "minItems" in property.value ? property.value.minItems : 1,
                                maxItems: "maxItems" in property.value ? property.value.maxItems : 1,
                                values: [
                                    new_value
                                ]
                            };
                        }
                    }

                    continue;
                }
            }
            case "pwms": {

                let set_pwm = parsed_data[property.key];

                if (set_pwm === undefined ||
                    (Array.isArray(set_pwm) && set_pwm.length === 0)
                ) {

                    if (property.value._t !== 'array') {
                        continue;
                    }

                    const pwms = filter_nodes(devicetree.root, DTQuery.pwms);

                    const phandles: string[] = [];

                    for (const pwm of pwms) {
                        phandles.push(pwm.node.labels.at(-1) ?? `&{${pwm.path}}`);
                    }

                    const prefix_items: FixedIndex[] = [{ _t: "enum", enum: phandles, enum_type: AttachEnumType.PHANDLE }];

                    property.value = {
                        _t: 'matrix',
                        minItems: property.value.minItems,
                        maxItems: property.value.maxItems,
                        values: [
                            {
                                _t: "fixed_index",
                                minItems: 1,
                                maxItems: 1,
                                prefixItems: prefix_items
                            }
                        ]
                    };

                    continue;
                } else if (
                    property.value._t === 'matrix' &&
                    Array.isArray(set_pwm) &&
                    set_pwm.length > 0 &&
                    set_pwm.every((entry) => Array.isArray(entry))
                ) {
                    set_pwm = set_pwm[0][0];

                    const pwms = filter_nodes(devicetree.root, DTQuery.pwms);

                    const phandles: string[] = [];

                    for (const pwm of pwms) {
                        phandles.push(pwm.node.labels.at(-1) ?? `&{${pwm.path}}`);
                    }

                    const node = pwms.find((value) => value.node.labels.at(-1) === set_pwm);

                    if (node === undefined) {
                        // TODO: error handling
                        continue;
                    }

                    const pwm_cells = node.node.properties.find((value) => value.name === "#pwm-cells");

                    if (pwm_cells !== undefined) {
                        const new_length = cell_extract_first_value(pwm_cells);

                        if (new_length !== undefined && typeof new_length === 'bigint'
                        ) {
                            const new_value: AttachArray = {
                                _t: 'fixed_index',
                                prefixItems: [],
                                minItems: Number(new_length),
                                maxItems: Number(new_length),
                            };

                            new_value.prefixItems.push(
                                {
                                    _t: "enum",
                                    enum: phandles,
                                    default: set_pwm,
                                    enum_type: AttachEnumType.PHANDLE
                                }
                            );

                            for (let index = 0; index < Number(new_length); index++) {
                                new_value.prefixItems.push({ _t: "number" });
                            }

                            property.value = {
                                _t: 'matrix',
                                minItems: property.value.minItems,
                                maxItems: property.value.maxItems,
                                values: [
                                    new_value
                                ]
                            };
                        }
                    }

                    continue;
                }
            }
        }

        if (property.key.endsWith("-supply")) {
            const regulators = filter_nodes(devicetree.root, DTQuery.regulators);

            const phandles: string[] = [];

            for (const regulator of regulators) {

                phandles.push(regulator.node.labels.at(-1) ?? `&{${regulator.path}}`);
            }

            property.value = {
                _t: "enum_array",
                minItems: 1,
                maxItems: 1,
                enum: phandles,
                enum_type: AttachEnumType.PHANDLE,
            };

            continue;
        }

        if (property.key.endsWith("-gpios") || property.key === "gpios" || property.key === "gpio") {

            let set_controller = parsed_data[property.key];

            if (
                set_controller === undefined ||
                (Array.isArray(set_controller) && set_controller.length === 0)
            ) {
                const gpio_controllers = filter_nodes(devicetree.root, DTQuery.gpios);

                const phandles: string[] = [];

                for (const gpio_controller of gpio_controllers) {
                    phandles.push(gpio_controller.node.labels.at(-1) ?? `&{${gpio_controller.path}}`);
                }

                property.value = {
                    _t: "enum_array",
                    minItems: 1,
                    maxItems: 1,
                    enum: phandles,
                    enum_type: AttachEnumType.PHANDLE,
                };

                continue;
            } else if (
                Array.isArray(set_controller) &&
                set_controller.length > 0 &&
                typeof set_controller[0] === 'string'
            ) {
                set_controller = set_controller[0];

                const gpio_controllers = filter_nodes(devicetree.root, DTQuery.gpios);

                const phandles: string[] = [];

                for (const gpio_controller of gpio_controllers) {
                    phandles.push(gpio_controller.node.labels.at(-1) ?? `&{${gpio_controller.path}}`);
                }

                const node = gpio_controllers.find((value) => value.node.labels.at(-1) === set_controller);

                if (node === undefined) {
                    // TODO: error handling
                    continue;
                }

                const gpio_cells = node.node.properties.find((value) => value.name === "#gpio-cells");

                if (gpio_cells !== undefined) {
                    const new_length = cell_extract_first_value(gpio_cells);

                    if (new_length !== undefined && typeof new_length === 'bigint') {
                        const new_value: AttachArray = {
                            _t: 'fixed_index',
                            prefixItems: [],
                            minItems: Number(new_length),
                            maxItems: Number(new_length),
                        };

                        new_value.prefixItems.push(
                            {
                                _t: "enum",
                                enum: phandles,
                                default: set_controller,
                                enum_type: AttachEnumType.PHANDLE
                            }
                        );

                        for (let index = 0; index < Number(new_length) - 1; index++) {
                            new_value.prefixItems.push({ _t: "number" });
                        }

                        new_value.prefixItems.push(
                            {
                                _t: "enum",
                                enum: GPIO_MACROS.map((value) => value.name),
                                enum_type: AttachEnumType.MACRO
                            }
                        );

                        property.value = new_value;
                    }
                }
            }

            continue;
        }
    }

    return properties_clone;
}

export function insert_known_structures(properties: ResolvedProperty[]): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);

    for (const property of properties_clone) {

        if (property.value._t === 'object') {
            property.value.properties = insert_known_structures(property.value.properties);
            continue;
        }

        switch (property.key) {
            case "spi-3wire": {
                property.value = {
                    _t: "boolean",
                    description: property.value.description,
                };
                break;
            }
            case "spi-cpol": {
                property.value = {
                    _t: "boolean",
                    description: property.value.description,
                };
                break;
            }
            case "spi-cpha": {
                property.value = {
                    _t: "boolean",
                    description: property.value.description,
                };
                break;
            }
            case "clock-frequency": {
                property.value = {
                    _t: "integer",
                    description: "Legacy property for single, fixed frequency clocks",
                    minimum: 0n,
                    maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn,
                };
                break;
            }
            // uint64-matrix
            case "opp-hz": {
                const minItems = property.value._t === "array" ? (property.value.minItems === undefined ? 1 : property.value.minItems) : 1;
                const maxItems = property.value._t === "array" ? (property.value.maxItems === undefined ? 1 : property.value.maxItems) : 1;
                const description = property.value.description === undefined ? undefined : property.value.description;

                // TODO: not sure
                property.value = {
                    _t: "matrix",
                    minItems: 1,
                    maxItems: 1,
                    values: [
                        {
                            _t: "number_array",
                            minimum: 0n,
                            maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn,
                            //typeSize: 64,
                            minItems: minItems,
                            maxItems: maxItems,
                        }
                    ],
                    description: description
                };
                break;
            }
            case "mount-matrix": {
                property.value = {
                    _t: "string_array",
                    minItems: 9,
                    maxItems: 9,
                    unique_items: false,
                };
                break;
            }
            case "gpio-controller": {
                if (property.value._t === "generic") {
                    const description = property.value.description === undefined ? undefined : property.value.description;
                    property.value = {
                        _t: "boolean",
                        description: description,
                    };
                }
                break;
            }
            case "interrupt-controller": {
                if (property.value._t === "generic") {
                    const description = property.value.description === undefined ? undefined : property.value.description;
                    property.value = {
                        _t: "boolean",
                        description: description
                    };
                }
                break;
            }
            case "reg": {

                if (property.value._t !== 'array') {
                    break;
                }

                property.value = {
                    _t: "matrix",
                    minItems: property.value.minItems,
                    maxItems: property.value.maxItems,
                    values: [
                        {
                            _t: "number_array",
                            minItems: 1,
                            maxItems: 1,
                            minimum: 0n,
                            maximum: 0xFF_FF_FF_FFn,
                        }
                    ]
                };

                break;
            }
        }

        // uint32-array
        if (
            property.key.endsWith("-bits") ||
            property.key.endsWith("-kBps") ||
            property.key.endsWith("-mhz") ||
            property.key.endsWith("-sec") ||
            new RegExp('(?<!(rvell,wakeup-gap|refresh-interval))-ms$').test(property.key) ||
            property.key.endsWith("-us") ||
            property.key.endsWith("-ns") ||
            property.key.endsWith("-ps") ||
            property.key.endsWith("-mm") ||
            property.key.endsWith("-microamp") ||
            property.key.endsWith("-nanoamp") ||
            property.key.endsWith("-picoamp") ||
            property.key.endsWith("-microamp-hours") ||
            new RegExp('(?<!ti,[xy]-plate)-ohms$').test(property.key) ||
            property.key.endsWith("-micro-ohms") ||
            property.key.endsWith("-microwatts") ||
            property.key.endsWith("-milliwatts") ||
            property.key.endsWith("-microwatt-hours") ||
            property.key.endsWith("-picofarads") ||
            property.key.endsWith("-femtofarads") ||
            property.key.endsWith("-kelvin")
        ) {
            const minItems = property.value._t === "array" ? (property.value.minItems === undefined ? 1 : property.value.minItems) : 1;
            const maxItems = property.value._t === "array" ? (property.value.maxItems === undefined ? 1 : property.value.maxItems) : 1;
            const description = property.value.description === undefined ? undefined : property.value.description;

            property.value = {
                _t: "number_array",
                minItems: minItems,
                maxItems: maxItems,
                minimum: 0n,
                maximum: 0xFF_FF_FF_FFn,
                description: description
            };
        }

        // int32-array
        if (
            property.key.endsWith("-percent") ||
            property.key.endsWith("-bp") ||
            property.key.endsWith("-db") ||
            property.key.endsWith("-microvolt") ||
            property.key.endsWith("-millicelsius") ||
            property.key.endsWith("-pascal") ||
            property.key.endsWith("-kpascal") ||
            property.key.endsWith("-celsius")
        ) {
            const minItems = property.value._t === "array" ? (property.value.minItems === undefined ? 1 : property.value.minItems) : 1;
            const maxItems = property.value._t === "array" ? (property.value.maxItems === undefined ? 1 : property.value.maxItems) : 1;
            const description = property.value.description === undefined ? undefined : property.value.description;

            property.value = {
                _t: "number_array",
                minItems: minItems,
                maxItems: maxItems,
                minimum: -2_147_483_648n,
                maximum: 2_147_483_647n,
                description: description
            };
        }

        // uint32
        if (property.key.endsWith("-bps")) {
            const description = property.value.description === undefined ? undefined : property.value.description;

            property.value = {
                _t: "integer",
                minimum: 0n,
                maximum: 0xFF_FF_FF_FFn,
                description: description
            };
        }

        // uint32-matrix
        if (new RegExp("(^(?!opp)).*-hz$").test(property.key)) {
            const minItems = property.value._t === "array" ? (property.value.minItems === undefined ? 1 : property.value.minItems) : 1;
            const maxItems = property.value._t === "array" ? (property.value.maxItems === undefined ? 1 : property.value.maxItems) : 1;
            const description = property.value.description === undefined ? undefined : property.value.description;

            // TODO: not sure
            property.value = {
                _t: "matrix",
                minItems: 1,
                maxItems: 1,
                values: [
                    {
                        _t: "number_array",
                        minimum: 0n,
                        maximum: 0xFF_FF_FF_FFn,
                        minItems: minItems,
                        maxItems: maxItems,
                    }
                ],
                description: description
            };
        }

    }

    return properties_clone;
}

enum DTQuery {
    interrupt_controllers,
    clocks,
    regulators,
    gpios,
    dmas,
    pwms,
};

type Predicate = (node: DtsNode) => boolean;

/**
 * @abstract Provides the predicate to apply over the nodes of the devicetree.
 * Can be exposed so users can provide their own implementation
 * @param {DTQuery} query Query identifier
 * @returns {Predicate} Predicate to be applied
 */
function get_query(query: DTQuery): Predicate {

    switch (query) {
        case DTQuery.interrupt_controllers: {
            return (node: DtsNode): boolean => {

                const interrupt_controller_flag = node.properties.find(
                    (value) => value.name === "interrupt-controller" && value.value === undefined
                );

                if (interrupt_controller_flag !== undefined) {
                    return true;
                }

                return false;
            };
        }
        case DTQuery.clocks: {
            return (node: DtsNode): boolean => {

                const fixed_clock_compatible = node.properties.find(
                    (value) => value.name === "compatible" &&
                        value.value !== undefined &&
                        value.value.components.length === 1 &&
                        value.value.components[0].kind === "string" &&
                        value.value.components[0].value === "fixed-clock"
                );

                if (fixed_clock_compatible !== undefined) {
                    return true;
                }

                // TODO: add more clock types

                return false;

            };
        }
        case DTQuery.regulators: {
            return (node: DtsNode): boolean => {

                const regulator_fixed_compatible = node.properties.find(
                    (value) => value.name === "compatible" &&
                        value.value !== undefined &&
                        value.value.components.length === 1 &&
                        value.value.components[0].kind === "string" &&
                        value.value.components[0].value === "regulator-fixed"
                );

                if (regulator_fixed_compatible !== undefined) {
                    return true;
                }

                // TODO: add more clock types

                return false;
            };
        }
        case DTQuery.gpios: {
            return (node: DtsNode) => {
                const compatible_property = node.properties.find(
                    (property) => property.name === 'compatible'
                );

                if (compatible_property === undefined) {
                    return false;
                }

                const gpio_controller = node.properties.find(
                    (property) => property.name === "gpio-controller" && property.value === undefined
                );

                const gpio_cells = node.properties.find(
                    (property) => property.name === "#gpio-cells"
                );

                if (gpio_controller === undefined || gpio_cells === undefined) {
                    return false;
                }

                return true;
            };
        }
        case DTQuery.dmas: {
            return (node: DtsNode) => {
                const compatible_property = node.properties.find(
                    (property) => property.name === 'compatible'
                );

                if (compatible_property === undefined) {
                    return false;
                }

                const dma_cells = node.properties.find(
                    (property) => property.name === "#dma-cells"
                );

                if (dma_cells === undefined) {
                    return false;
                }

                return true;
            };
        }
        case DTQuery.pwms: {
            return (node: DtsNode) => {
                const compatible_property = node.properties.find(
                    (property) => property.name === 'compatible'
                );

                if (compatible_property === undefined) {
                    return false;
                }

                const pwm_cells = node.properties.find(
                    (property) => property.name === "#pwm-cells"
                );

                if (pwm_cells === undefined) {
                    return false;
                }

                return true;
            };
        }
        default: {
            const _x: never = query;
            throw new Error("Failed exhaustiveness check!");
        }
    }

}

function filter_nodes(root: DtsNode, query: DTQuery): { node: DtsNode, path: string }[] {
    const pred = get_query(query);
    return filter_nodes_impl(root, "/", pred);
}

function filter_nodes_impl(root: DtsNode, path: string, pred: Predicate): { node: DtsNode, path: string }[] {

    let nodes: { node: DtsNode, path: string }[] = [];

    if (pred(root)) {
        nodes.push(
            {
                node: root,
                path: path
            }
        );
    }

    for (const child of root.children) {
        let new_path = "";

        const child_name = child.unit_addr === undefined ? `${child.name}` : `${child.name}@${child.unit_addr}`;
        new_path = path === "/" ? `${path}${child_name}` : `${path}/${child_name}`;

        const child_nodes = filter_nodes_impl(child, new_path, pred);
        nodes = [...nodes, ...child_nodes];
    }

    return nodes;
}

export function cell_extract_first_value(property: DtsProperty): bigint | string | undefined {

    if (property.value === undefined) { return; }
    if (property.value.components[0].kind !== 'array') { return; }
    if (property.value.components[0].elements.at(0) === undefined) { return; }

    const item = property.value.components[0].elements[0].item;

    switch (item.kind) {
        case "expression":
        case "number":
        case "u64":
        case "macro":
            {
                return item.value;
            }
        case "ref":
            {
                return item.ref.kind === "label" ? item.ref.name : item.ref.path;
            }
        default:
            {
                const _x: never = item;
                throw new Error("Failed exhaustive check!");
            }
    }
}

function get_inherited_property(devicetree: DtsDocument, parent_name: string, property_to_search: string): DtsProperty | undefined {
    const parent = filter_nodes_impl(
        devicetree.root,
        "/",
        (node: DtsNode) => {
            const name = node.unit_addr === undefined ? `${node.name}` : `${node.name}@${node.unit_addr}`;
            return name === parent_name;
        }
    );

    if (parent.length === 1) {
        const parent_interrupt_parent = parent[0].node.properties.find((node) => node.name === property_to_search);

        if (parent_interrupt_parent === undefined && parent[0].path !== '/') {
            let new_parent = parent[0].path.split('/').at(-2);

            if (new_parent === undefined) {
                return;
            }

            if (new_parent === '') {
                new_parent = '/';
            }

            return get_inherited_property(devicetree, new_parent, property_to_search);
        } else {

            return parent_interrupt_parent;
        }
    }

    return;
}

export function extract_compatible(node: ParsedBinding): string[] | undefined {

    const compatible = node.properties.find((value) => value.key === "compatible");

    if (compatible === undefined) {
        return;
    }

    if (compatible.value._t === "enum_array") {
        let compatible_accumulator: string[] = [];

        for (const entry of compatible.value.enum) {
            if (typeof entry === 'string') {
                compatible_accumulator.push(entry);
            } else if (Array.isArray(entry)) {
                compatible_accumulator = [...compatible_accumulator, ...entry];
            }
        }

        return compatible_accumulator;
    } else if (compatible.value._t === 'const') {
        return [compatible.value.const];
    }
}
