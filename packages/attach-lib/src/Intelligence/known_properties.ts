import { ResolvedProperty } from "../Bindings/ParsedBinding.js";
import { AttachType } from "../Bindings/StructuralTypes.js";

function array_bounds(value: AttachType): { minItems: number; maxItems: number } {
    if (value._t === "array") {
        return { minItems: value.minItems ?? 1, maxItems: value.maxItems ?? 1 };
    }
    return { minItems: 1, maxItems: 1 };
}

type SuffixRule = {
    test: RegExp;
    make(bounds: { minItems: number; maxItems: number }, description: string | undefined): AttachType;
};

const uint32_array = (bounds: { minItems: number; maxItems: number }, description: string | undefined): AttachType => ({
    _t: "number_array", ...bounds, minimum: 0n, maximum: 0xFF_FF_FF_FFn, description,
});

const int32_array = (bounds: { minItems: number; maxItems: number }, description: string | undefined): AttachType => ({
    _t: "number_array", ...bounds, minimum: -2_147_483_648n, maximum: 2_147_483_647n, description,
});

const uint32_matrix = (bounds: { minItems: number; maxItems: number }, description: string | undefined): AttachType => ({
    _t: "matrix", minItems: 1, maxItems: 1,
    values: [{ _t: "number_array", minimum: 0n, maximum: 0xFF_FF_FF_FFn, ...bounds }],
    description,
});

const suffix_rules: SuffixRule[] = [
    { test: /-bits$/, make: uint32_array },
    { test: /-kBps$/, make: uint32_array },
    { test: /-mhz$/, make: uint32_array },
    { test: /-sec$/, make: uint32_array },
    { test: /(?<!(rvell,wakeup-gap|refresh-interval))-ms$/, make: uint32_array },
    { test: /-us$/, make: uint32_array },
    { test: /-ns$/, make: uint32_array },
    { test: /-ps$/, make: uint32_array },
    { test: /-mm$/, make: uint32_array },
    { test: /-microamp$/, make: uint32_array },
    { test: /-nanoamp$/, make: uint32_array },
    { test: /-picoamp$/, make: uint32_array },
    { test: /-microamp-hours$/, make: uint32_array },
    { test: /(?<!ti,[xy]-plate)-ohms$/, make: uint32_array },
    { test: /-micro-ohms$/, make: uint32_array },
    { test: /-microwatts$/, make: uint32_array },
    { test: /-milliwatts$/, make: uint32_array },
    { test: /-microwatt-hours$/, make: uint32_array },
    { test: /-picofarads$/, make: uint32_array },
    { test: /-femtofarads$/, make: uint32_array },
    { test: /-kelvin$/, make: uint32_array },
    { test: /-percent$/, make: int32_array },
    { test: /-bp$/, make: int32_array },
    { test: /-db$/, make: int32_array },
    { test: /-microvolt$/, make: int32_array },
    { test: /-millicelsius$/, make: int32_array },
    { test: /-pascal$/, make: int32_array },
    { test: /-kpascal$/, make: int32_array },
    { test: /-celsius$/, make: int32_array },
    { test: /-bps$/, make: (_bounds, description) => ({ _t: "integer", minimum: 0n, maximum: 0xFF_FF_FF_FFn, description }) },
    { test: /(?<!^opp)-hz$/, make: uint32_matrix },
];

function patch_from_binding(base: AttachType, binding: AttachType): AttachType {
    if (binding._t === "generic" || binding._t === "array") { return base; }

    const patch: Record<string, unknown> = {};
    if ("minimum" in binding && binding.minimum !== undefined) { patch.minimum = binding.minimum; }
    if ("maximum" in binding && binding.maximum !== undefined) { patch.maximum = binding.maximum; }
    if ("default" in binding && binding.default !== undefined) { patch.default = binding.default; }
    if ("typeSize" in binding && binding.typeSize !== undefined) { patch.typeSize = binding.typeSize; }

    if (base._t === "number_array" && "minimum" in base) {
        return { ...base, ...patch } as AttachType;
    }
    if (base._t === "integer") {
        return { ...base, ...patch } as AttachType;
    }
    if (base._t === "matrix" && base.values.length === 1 && "minimum" in base.values[0]!) {
        return { ...base, values: [{ ...base.values[0]!, ...patch }] } as AttachType;
    }

    return { ...base, ...patch } as AttachType;
}

export function insert_known_structures(properties: ResolvedProperty[]): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);

    for (const property of properties_clone) {

        if (property.value._t === 'object') {
            property.value.properties = insert_known_structures(property.value.properties);
            continue;
        }

        switch (property.key) {
            case "spi-3wire":
            case "spi-cpol":
            case "spi-cpha": {
                property.value = { _t: "boolean", description: property.value.description };
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
            case "opp-hz": {
                const bounds = array_bounds(property.value);
                property.value = {
                    _t: "matrix", minItems: 1, maxItems: 1, description: property.value.description,
                    values: [{ _t: "number_array", minimum: 0n, maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn, ...bounds }],
                };
                break;
            }
            case "mount-matrix": {
                property.value = {
                    _t: "string_array", minItems: 9, maxItems: 9, unique_items: false,
                    description: property.value.description,
                };
                break;
            }
            case "gpio-controller":
            case "interrupt-controller": {
                if (property.value._t === "generic") {
                    property.value = { _t: "boolean", description: property.value.description };
                }
                break;
            }
            case "reg": {
                if (property.value._t !== 'array') { break; }
                property.value = {
                    _t: "matrix", minItems: property.value.minItems, maxItems: property.value.maxItems,
                    description: property.value.description,
                    values: [{ _t: "number_array", minItems: 1, maxItems: 1, minimum: 0n, maximum: 0xFF_FF_FF_FFn }],
                };
                break;
            }
        }

        for (const rule of suffix_rules) {
            if (rule.test.test(property.key)) {
                const base = rule.make(array_bounds(property.value), property.value.description);
                property.value = patch_from_binding(base, property.value);
                break;
            }
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

    test("suffix rule patches binding constraints onto the base type", () => {
        const [result] = run(property("adi,vref-microvolt", {
            _t: "integer", minimum: 1_000_000n, maximum: 2_500_000n, default: 2_500_000n, description: "ref voltage",
        }));
        expect(result!.value).toStrictEqual({
            _t: "number_array", minItems: 1, maxItems: 1,
            minimum: 1_000_000n, maximum: 2_500_000n, default: 2_500_000n, description: "ref voltage",
        });
    });

    test("suffix rule patches binding constraints onto matrix base", () => {
        const [result] = run(property("spi-cs-inactive-delay-ns", {
            _t: "integer", minimum: 16_000n, description: "CS delay",
        }));
        expect(result!.value).toStrictEqual({
            _t: "number_array", minItems: 1, maxItems: 1,
            minimum: 16_000n, maximum: 0xFF_FF_FF_FFn, description: "CS delay",
        });
    });

    test("suffix rule applies base type when binding is generic", () => {
        const [result] = run(property("timeout-ns", { _t: "generic", description: "d" }));
        expect(result!.value).toStrictEqual({
            _t: "number_array", minItems: 1, maxItems: 1,
            minimum: 0n, maximum: 0xFF_FF_FF_FFn, description: "d",
        });
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
