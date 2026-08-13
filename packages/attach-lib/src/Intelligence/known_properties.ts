import { ResolvedProperty } from "../Attach/AttachTypes.js";

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
