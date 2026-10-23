import { ResolvedProperty } from "../Bindings/ParsedBinding.js";
import { is_open, is_open_list, list_cell, type AttachType, type Cell, type List } from "../Bindings/StructuralTypes.js";

function array_bounds(value: AttachType): { minItems: number; maxItems: number } {
    if (is_open_list(value)) {
        return { minItems: value.minItems ?? 1, maxItems: value.maxItems ?? 1 };
    }
    // The cells of a row, not the rows, are what the suffix rules count
    if (value._t === "matrix" && is_open(value)) {
        return { minItems: value.rows[0]?.minItems ?? 1, maxItems: value.rows[0]?.maxItems ?? 1 };
    }
    return { minItems: 1, maxItems: 1 };
}

type Bounds = { minItems: number; maxItems: number };

type SuffixRule = {
    test: RegExp;
    make(bounds: Bounds, description: string | undefined): AttachType;
};

const number_list = (bounds: Bounds, minimum: bigint, maximum: bigint): List => ({
    _t: "list", item: { _t: "number", minimum, maximum }, ...bounds,
});

const uint32_array = (bounds: Bounds, description: string | undefined): AttachType => ({
    ...number_list(bounds, 0n, 0xFF_FF_FF_FFn), description,
});

const int32_array = (bounds: Bounds, description: string | undefined): AttachType => ({
    ...number_list(bounds, -2_147_483_648n, 2_147_483_647n), description,
});

const uint32_matrix = (bounds: Bounds, description: string | undefined): AttachType => ({
    _t: "matrix", minItems: 1, maxItems: 1,
    rows: [number_list(bounds, 0n, 0xFF_FF_FF_FFn)],
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
    { test: /-bps$/, make: (_bounds, description) => ({ _t: "scalar", cell: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn }, description }) },
    { test: /(?<!^opp)-hz$/, make: uint32_matrix },
];

type Constraints = { minimum?: bigint; maximum?: bigint; default?: bigint | string; typeSize?: number };

/** What a binding's own type says about a number's range, default and size. */
function constraints_of(binding: AttachType): Constraints {
    const cell: Cell | undefined = binding._t === "scalar" ? binding.cell : (binding._t === "list" ? list_cell(binding) : undefined);
    const own_default = binding._t === "scalar" ? binding.default : (cell !== undefined && cell._t !== "string" && cell._t !== "any" ? cell.default : undefined);
    const type_size = binding._t === "scalar" || binding._t === "list" ? binding.typeSize : undefined;
    return {
        ...(cell?._t === "number" && cell.minimum !== undefined ? { minimum: cell.minimum } : {}),
        ...(cell?._t === "number" && cell.maximum !== undefined ? { maximum: cell.maximum } : {}),
        ...(own_default === undefined ? {} : { default: own_default }),
        ...(type_size === undefined ? {} : { typeSize: type_size }),
    };
}

function apply_constraints(base: AttachType, constraints: Constraints): AttachType {
    const { minimum, maximum, default: default_value, typeSize } = constraints;
    switch (base._t) {
        case "scalar": {
            return {
                ...base,
                ...(base.cell._t === "number" ? { cell: { ...base.cell, ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) } } : {}),
                ...(default_value === undefined ? {} : { default: default_value }),
                ...(typeSize === undefined ? {} : { typeSize }),
            };
        }
        case "list": {
            const cell = list_cell(base);
            return {
                ...base,
                ...(cell?._t === "number" ? {
                    item: {
                        ...cell,
                        ...(minimum === undefined ? {} : { minimum }),
                        ...(maximum === undefined ? {} : { maximum }),
                        ...(typeof default_value === "bigint" ? { default: default_value } : {}),
                    },
                } : {}),
                ...(typeSize === undefined ? {} : { typeSize }),
            };
        }
        case "matrix": {
            return base.rows.length === 1
                ? { ...base, rows: [apply_constraints(base.rows[0]!, constraints) as List] }
                : base;
        }
        default: {
            return base;
        }
    }
}

function patch_from_binding(base: AttachType, binding: AttachType): AttachType {
    if (binding._t === "unknown" || is_open(binding)) { return base; }
    return apply_constraints(base, constraints_of(binding));
}

export function insert_known_structures(properties: ResolvedProperty[]): ResolvedProperty[] {

    const properties_clone = structuredClone(properties);

    for (const property of properties_clone) {

        if (property.value._t === 'node') {
            property.value.properties = insert_known_structures(property.value.properties);
            continue;
        }

        switch (property.key) {
            case "spi-3wire":
            case "spi-cpol":
            case "spi-cpha": {
                property.value = { _t: "flag", description: property.value.description };
                break;
            }
            case "clock-frequency": {
                property.value = {
                    _t: "scalar",
                    description: "Legacy property for single, fixed frequency clocks",
                    cell: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn },
                };
                break;
            }
            case "opp-hz": {
                const bounds = array_bounds(property.value);
                property.value = {
                    _t: "matrix", minItems: 1, maxItems: 1, description: property.value.description,
                    rows: [number_list(bounds, 0n, 0xFF_FF_FF_FF_FF_FF_FF_FFn)],
                };
                break;
            }
            case "mount-matrix": {
                property.value = {
                    _t: "list", item: { _t: "string" }, minItems: 9, maxItems: 9,
                    description: property.value.description,
                };
                break;
            }
            case "gpio-controller":
            case "interrupt-controller": {
                if (property.value._t === "unknown") {
                    property.value = { _t: "flag", description: property.value.description };
                }
                break;
            }
            case "reg": {
                if (!is_open(property.value) || (property.value._t !== "list" && property.value._t !== "matrix")) { break; }
                property.value = {
                    _t: "matrix", minItems: property.value.minItems, maxItems: property.value.maxItems,
                    description: property.value.description,
                    rows: [number_list(property.value._t === "matrix" ? array_bounds(property.value) : { minItems: 1, maxItems: 1 }, 0n, 0xFF_FF_FF_FFn)],
                };
                break;
            }
        }

        // A matrix the binding describes (by its `-hz` type, say) is as good as the rule's
        if (property.value._t === "matrix" && !is_open(property.value)) { continue; }

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
    const open_list = (minItems: number, maxItems: number, description?: string): ResolvedProperty["value"] =>
        ({ _t: "list", item: { _t: "any" }, minItems, maxItems, ...(description === undefined ? {} : { description }) });
    const numbers = (minimum: bigint, maximum: bigint, bounds: { minItems?: number; maxItems?: number }, extra: object = {}): ResolvedProperty["value"] =>
        ({ _t: "list", item: { _t: "number", minimum, maximum }, ...bounds, ...extra });

    test("spi-3wire / spi-cpol / spi-cpha become flag", () => {
        const result = run(
            property("spi-3wire", { _t: "unknown", description: "a" }),
            property("spi-cpol", { _t: "unknown", description: "b" }),
            property("spi-cpha", { _t: "unknown", description: "c" }),
        );
        for (const p of result) {
            expect(p.value._t).toBe("flag");
        }
        expect((result[0]!.value as { description?: string }).description).toBe("a");
    });

    test("clock-frequency becomes uint64 scalar", () => {
        const [result] = run(property("clock-frequency", { _t: "unknown" }));
        expect(result!.value).toStrictEqual({
            _t: "scalar",
            description: "Legacy property for single, fixed frequency clocks",
            cell: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FF_FF_FF_FF_FFn },
        });
    });

    test("opp-hz becomes uint64 matrix, bounds from array", () => {
        const [result] = run(property("opp-hz", open_list(2, 4, "d")));
        expect(result!.value).toStrictEqual({
            _t: "matrix",
            minItems: 1,
            maxItems: 1,
            description: "d",
            rows: [numbers(0n, 0xFF_FF_FF_FF_FF_FF_FF_FFn, { minItems: 2, maxItems: 4 })],
        });
    });

    test("opp-hz defaults items to 1 when not array", () => {
        const [result] = run(property("opp-hz", { _t: "unknown" }));
        expect(result!.value._t).toBe("matrix");
        if (result!.value._t === "matrix") {
            const inner = result!.value.rows[0]!;
            expect(inner.minItems).toBe(1);
            expect(inner.maxItems).toBe(1);
        }
    });

    test("mount-matrix becomes a 9-element string list", () => {
        const [result] = run(property("mount-matrix", { _t: "unknown", description: "e" }));
        expect(result!.value).toStrictEqual({
            _t: "list",
            item: { _t: "string" },
            minItems: 9,
            maxItems: 9,
            description: "e",
        });
    });

    test("gpio-controller stays unchanged when not unknown", () => {
        const [result] = run(property("gpio-controller", { _t: "flag" }));
        expect(result!.value._t).toBe("flag");
    });

    test("gpio-controller / interrupt-controller become flag from unknown", () => {
        const result = run(
            property("gpio-controller", { _t: "unknown", description: "f" }),
            property("interrupt-controller", { _t: "unknown", description: "g" }),
        );
        expect(result[0]!.value).toStrictEqual({ _t: "flag", description: "f" });
        expect(result[1]!.value).toStrictEqual({ _t: "flag", description: "g" });
    });

    test("reg array becomes matrix", () => {
        const [result] = run(property("reg", open_list(1, 2, "h")));
        expect(result!.value).toStrictEqual({
            _t: "matrix",
            minItems: 1,
            maxItems: 2,
            description: "h",
            rows: [numbers(0n, 0xFF_FF_FF_FFn, { minItems: 1, maxItems: 1 })],
        });
    });

    test("reg non-array is untouched", () => {
        const [result] = run(property("reg", { _t: "unknown" }));
        expect(result!.value._t).toBe("unknown");
    });

    test("-bits suffix → uint32 list, bounds from array", () => {
        const [result] = run(property("resolution-bits", open_list(1, 3, "i")));
        expect(result!.value).toStrictEqual(numbers(0n, 0xFF_FF_FF_FFn, { minItems: 1, maxItems: 3 }, { description: "i" }));
    });

    test("-bits suffix defaults items to 1 from non-array", () => {
        const [result] = run(property("resolution-bits", { _t: "unknown" }));
        expect(result!.value._t).toBe("list");
        if (result!.value._t === "list") {
            expect(result!.value.minItems).toBe(1);
            expect(result!.value.maxItems).toBe(1);
        }
    });

    test("-microvolt suffix → int32 list (drops any existing min/max)", () => {
        const [result] = run(property("vcc-microvolt", open_list(2, 2, "j")));
        expect(result!.value).toStrictEqual(numbers(-2_147_483_648n, 2_147_483_647n, { minItems: 2, maxItems: 2 }, { description: "j" }));
    });

    test("-bps suffix → uint32 scalar", () => {
        const [result] = run(property("current-speed-bps", { _t: "unknown", description: "k" }));
        expect(result!.value).toStrictEqual({
            _t: "scalar",
            cell: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn },
            description: "k",
        });
    });

    test("-hz suffix (not opp-hz) → uint32 matrix, bounds from array", () => {
        const [result] = run(property("clock-output-hz", open_list(1, 2, "l")));
        expect(result!.value).toStrictEqual({
            _t: "matrix",
            minItems: 1,
            maxItems: 1,
            description: "l",
            rows: [numbers(0n, 0xFF_FF_FF_FFn, { minItems: 1, maxItems: 2 })],
        });
    });

    test("-ms suffix applies (but wakeup-gap-ms and refresh-interval-ms are excluded)", () => {
        const [a, b, c] = run(
            property("timeout-ms", { _t: "unknown" }),
            property("rvell,wakeup-gap-ms", { _t: "unknown" }),
            property("refresh-interval-ms", { _t: "unknown" }),
        );
        expect(a!.value._t).toBe("list");
        expect(b!.value._t).toBe("unknown");
        expect(c!.value._t).toBe("unknown");
    });

    test("-ohms suffix applies (but ti,*-plate-ohms is excluded)", () => {
        const [a, b] = run(
            property("pull-up-ohms", { _t: "unknown" }),
            property("ti,x-plate-ohms", { _t: "unknown" }),
        );
        expect(a!.value._t).toBe("list");
        expect(b!.value._t).toBe("unknown");
    });

    test("suffix rule patches binding constraints onto the base type", () => {
        const [result] = run(property("adi,vref-microvolt", {
            _t: "scalar", cell: { _t: "number", minimum: 1_000_000n, maximum: 2_500_000n }, default: 2_500_000n, description: "ref voltage",
        }));
        expect(result!.value).toStrictEqual({
            _t: "list", minItems: 1, maxItems: 1,
            item: { _t: "number", minimum: 1_000_000n, maximum: 2_500_000n, default: 2_500_000n },
            description: "ref voltage",
        });
    });

    test("suffix rule patches only the constraints the binding gives", () => {
        const [result] = run(property("spi-cs-inactive-delay-ns", {
            _t: "scalar", cell: { _t: "number", minimum: 16_000n }, description: "CS delay",
        }));
        expect(result!.value).toStrictEqual({
            _t: "list", minItems: 1, maxItems: 1,
            item: { _t: "number", minimum: 16_000n, maximum: 0xFF_FF_FF_FFn },
            description: "CS delay",
        });
    });

    test("suffix rule applies base type when binding is unknown", () => {
        const [result] = run(property("timeout-ns", { _t: "unknown", description: "d" }));
        expect(result!.value).toStrictEqual({
            _t: "list", minItems: 1, maxItems: 1,
            item: { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn }, description: "d",
        });
    });

    test("node properties are recursed", () => {
        const [result] = run(property("port", {
            _t: "node",
            properties: [property("spi-3wire", { _t: "unknown" })],
        }));
        expect(result!.value._t).toBe("node");
        if (result!.value._t === "node") {
            expect(result!.value.properties[0]!.value._t).toBe("flag");
        }
    });
}
