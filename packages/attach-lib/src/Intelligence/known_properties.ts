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
                    description: property.value.description,
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
                    description: property.value.description,
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

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const property = (key: string, value: ResolvedProperty["value"]): ResolvedProperty => ({ key, value });
    const run = (...properties: ResolvedProperty[]) => insert_known_structures(properties);

    test("spi-3wire / spi-cpol / spi-cpha become boolean", () => {
        const result = run(
            property("spi-3wire", { _t: "generic", description: "a" }),
            property("spi-cpol", { _t: "generic", description: "b" }),
            property("spi-cpha", { _t: "generic", description: "c" }),
        );
        for (const p of result) {
            expect(p.value._t).toBe("boolean");
        }
        expect((result[0]!.value as { description?: string }).description).toBe("a");
    });

    test("clock-frequency becomes uint64 integer", () => {
        const [result] = run(property("clock-frequency", { _t: "generic" }));
        expect(result!.value).toStrictEqual({
            _t: "integer",
            description: "Legacy property for single, fixed frequency clocks",
            minimum: 0n,
            maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn,
        });
    });

    test("opp-hz becomes uint64 matrix, bounds from array", () => {
        const [result] = run(property("opp-hz", { _t: "array", minItems: 2, maxItems: 4, description: "d" }));
        expect(result!.value).toStrictEqual({
            _t: "matrix",
            minItems: 1,
            maxItems: 1,
            description: "d",
            values: [{
                _t: "number_array",
                minimum: 0n,
                maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn,
                minItems: 2,
                maxItems: 4,
            }],
        });
    });

    test("opp-hz defaults items to 1 when not array", () => {
        const [result] = run(property("opp-hz", { _t: "generic" }));
        expect(result!.value._t).toBe("matrix");
        if (result!.value._t === "matrix") {
            const inner = result!.value.values[0]!;
            expect("minItems" in inner && inner.minItems).toBe(1);
            expect("maxItems" in inner && inner.maxItems).toBe(1);
        }
    });

    test("mount-matrix becomes 9-element string_array", () => {
        const [result] = run(property("mount-matrix", { _t: "generic", description: "e" }));
        expect(result!.value).toStrictEqual({
            _t: "string_array",
            minItems: 9,
            maxItems: 9,
            unique_items: false,
            description: "e",
        });
    });

    test("gpio-controller stays unchanged when not generic", () => {
        const [result] = run(property("gpio-controller", { _t: "boolean" }));
        expect(result!.value._t).toBe("boolean");
    });

    test("gpio-controller / interrupt-controller become boolean from generic", () => {
        const result = run(
            property("gpio-controller", { _t: "generic", description: "f" }),
            property("interrupt-controller", { _t: "generic", description: "g" }),
        );
        expect(result[0]!.value).toStrictEqual({ _t: "boolean", description: "f" });
        expect(result[1]!.value).toStrictEqual({ _t: "boolean", description: "g" });
    });

    test("reg array becomes matrix", () => {
        const [result] = run(property("reg", { _t: "array", minItems: 1, maxItems: 2, description: "h" }));
        expect(result!.value).toStrictEqual({
            _t: "matrix",
            minItems: 1,
            maxItems: 2,
            description: "h",
            values: [{ _t: "number_array", minItems: 1, maxItems: 1, minimum: 0n, maximum: 0xFF_FF_FF_FFn }],
        });
    });

    test("reg non-array is untouched", () => {
        const [result] = run(property("reg", { _t: "generic" }));
        expect(result!.value._t).toBe("generic");
    });

    test("-bits suffix → uint32 number_array, bounds from array", () => {
        const [result] = run(property("resolution-bits", { _t: "array", minItems: 1, maxItems: 3, description: "i" }));
        expect(result!.value).toStrictEqual({
            _t: "number_array",
            minItems: 1,
            maxItems: 3,
            minimum: 0n,
            maximum: 0xFF_FF_FF_FFn,
            description: "i",
        });
    });

    test("-bits suffix defaults items to 1 from non-array", () => {
        const [result] = run(property("resolution-bits", { _t: "generic" }));
        expect(result!.value._t).toBe("number_array");
        if (result!.value._t === "number_array") {
            expect(result!.value.minItems).toBe(1);
            expect(result!.value.maxItems).toBe(1);
        }
    });

    test("-microvolt suffix → int32 number_array (drops any existing min/max)", () => {
        const [result] = run(property("vcc-microvolt", {
            _t: "array", minItems: 2, maxItems: 2, description: "j",
        }));
        expect(result!.value).toStrictEqual({
            _t: "number_array",
            minItems: 2,
            maxItems: 2,
            minimum: -2_147_483_648n,
            maximum: 2_147_483_647n,
            description: "j",
        });
    });

    test("-bps suffix → uint32 integer", () => {
        const [result] = run(property("current-speed-bps", { _t: "generic", description: "k" }));
        expect(result!.value).toStrictEqual({
            _t: "integer",
            minimum: 0n,
            maximum: 0xFF_FF_FF_FFn,
            description: "k",
        });
    });

    test("-hz suffix (not opp-hz) → uint32 matrix, bounds from array", () => {
        const [result] = run(property("clock-output-hz", { _t: "array", minItems: 1, maxItems: 2, description: "l" }));
        expect(result!.value).toStrictEqual({
            _t: "matrix",
            minItems: 1,
            maxItems: 1,
            description: "l",
            values: [{
                _t: "number_array",
                minimum: 0n,
                maximum: 0xFF_FF_FF_FFn,
                minItems: 1,
                maxItems: 2,
            }],
        });
    });

    test("-ms suffix applies (but wakeup-gap-ms and refresh-interval-ms are excluded)", () => {
        const [a, b, c] = run(
            property("timeout-ms", { _t: "generic" }),
            property("rvell,wakeup-gap-ms", { _t: "generic" }),
            property("refresh-interval-ms", { _t: "generic" }),
        );
        expect(a!.value._t).toBe("number_array");
        expect(b!.value._t).toBe("generic");
        expect(c!.value._t).toBe("generic");
    });

    test("-ohms suffix applies (but ti,*-plate-ohms is excluded)", () => {
        const [a, b] = run(
            property("pull-up-ohms", { _t: "generic" }),
            property("ti,x-plate-ohms", { _t: "generic" }),
        );
        expect(a!.value._t).toBe("number_array");
        expect(b!.value._t).toBe("generic");
    });

    test("object properties are recursed", () => {
        const [result] = run(property("port", {
            _t: "object",
            properties: [property("spi-3wire", { _t: "generic" })],
        }));
        expect(result!.value._t).toBe("object");
        if (result!.value._t === "object") {
            expect(result!.value.properties[0]!.value._t).toBe("boolean");
        }
    });
}
