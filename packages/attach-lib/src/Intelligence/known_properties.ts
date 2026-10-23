import { ResolvedProperty } from "../Bindings/ParsedBinding.js";
import { is_open, is_open_list, type AttachType, type List } from "../Bindings/StructuralTypes.js";

function array_bounds(value: AttachType): { minItems: number; maxItems: number } {
    if (is_open_list(value)) {
        return { minItems: value.minItems ?? 1, maxItems: value.maxItems ?? 1 };
    }
    // The cells of a row, not the rows, are what an array_bounds user counts
    if (value._t === "matrix" && is_open(value)) {
        return { minItems: value.rows[0]?.minItems ?? 1, maxItems: value.rows[0]?.maxItems ?? 1 };
    }
    return { minItems: 1, maxItems: 1 };
}

type Bounds = { minItems: number; maxItems: number };

const number_list = (bounds: Bounds, minimum: bigint, maximum: bigint): List => ({
    _t: "list", item: { _t: "number", minimum, maximum }, ...bounds,
});

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
