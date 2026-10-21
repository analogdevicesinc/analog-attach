import { AttachEnumType, is_dt_flag, type AttachType, type DTProperty } from "attach-lib";

// How many values a binding allows in a property (minItems / maxItems), for
// the arrays whose items are single values: numbers, strings, enum members.
// A specifier list counts entries (`interrupts = <25 2>` is one), so its
// bound is in cells only once every entry has a known width: interrupts
// under a known interrupt-parent. Lists whose entries name a phandle
// (clocks, dmas, *-gpios) have as many cells as the provider takes, so they
// have no bounds here.

export interface ItemBounds {
    min: number;
    max?: number;
}

export function item_bounds(type: AttachType): ItemBounds | undefined {
    switch (type._t) {
        case "number_array":
        case "string_array":
        case "enum_array": {
            // An array of phandles is a phandle list before the lib knows its provider
            // (rdy-gpios = <&gpio 19 1> is one item of three cells).
            if (type._t === "enum_array" && type.enum_type === AttachEnumType.PHANDLE) { return undefined; }
            // The parsed binding leaves a bound out as undefined, whatever its type says.
            const min = type.minItems as number | undefined;
            const max = type.maxItems as number | undefined;
            return max === undefined ? { min: min ?? 0 } : { min: min ?? 0, max };
        }
        case "matrix": {
            const row = type.values[0];
            if (type.values.length !== 1 || row?._t !== "fixed_index") { return undefined; }
            if (row.prefixItems.some(item => item._t === "enum" && item.enum_type === AttachEnumType.PHANDLE)) { return undefined; }
            const width = row.prefixItems.length;
            const min = (type.minItems as number | undefined ?? 0) * width;
            return type.maxItems === undefined ? { min } : { min, max: type.maxItems * width };
        }
        default: {
            return undefined;
        }
    }
}

/** The values a built property holds: its cells and its strings. */
export function value_count(property: DTProperty): number {
    if (is_dt_flag(property.value)) { return 0; }
    return property.value.reduce((sum, value) => sum + (value.kind === "array" ? value.elements.length : 1), 0);
}

/** The warning for a value count the binding doesn't allow; undefined when it fits or the binding sets no bounds. */
export function count_warning(property: string, type: AttachType, count: number): string | undefined {
    const bounds = item_bounds(type);
    if (bounds === undefined) { return undefined; }
    const { min, max } = bounds;
    if (count >= min && (max === undefined || count <= max)) { return undefined; }
    const takes = max === undefined
        ? `at least ${min} values`
        : (min === max ? `${max} ${max === 1 ? "value" : "values"}` : `${min} to ${max} values`);
    return `warning: ${property} takes ${takes}, got ${count}`;
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree } = await import("attach-lib");

    const numbers = (minItems: number | undefined, maxItems?: number): AttachType =>
        ({ _t: "number_array", minItems, maxItems } as AttachType);

    test("item_bounds — value arrays only; a missing min is 0, a missing max unbounded", () => {
        expect(item_bounds(numbers(2, 2))).toEqual({ min: 2, max: 2 });
        expect(item_bounds(numbers(1))).toEqual({ min: 1 });
        expect(item_bounds(numbers(undefined, 4))).toEqual({ min: 0, max: 4 });
        expect(item_bounds({ _t: "string_array", minItems: 1, maxItems: 3 } as AttachType)).toEqual({ min: 1, max: 3 });
        expect(item_bounds({ _t: "enum_array", minItems: 2, maxItems: 2, enum: ["a", "b"] } as AttachType)).toEqual({ min: 2, max: 2 });
        expect(item_bounds({ _t: "array", minItems: 1, maxItems: 2 } as AttachType)).toBeUndefined();
        expect(item_bounds({ _t: "integer" } as AttachType)).toBeUndefined();
    });

    const specifiers = (prefixItems: unknown[], minItems?: number, maxItems?: number): AttachType =>
        ({ _t: "matrix", minItems, maxItems, values: [{ _t: "fixed_index", prefixItems, minItems: prefixItems.length, maxItems: prefixItems.length }] } as AttachType);
    const flags = { _t: "enum", enum: ["IRQ_TYPE_EDGE_FALLING"], enum_type: AttachEnumType.MACRO };
    const phandle = { _t: "enum", enum: ["clk_osc"], enum_type: AttachEnumType.PHANDLE };

    test("item_bounds — a specifier list of a known width counts its cells; one naming a phandle has no bounds", () => {
        expect(item_bounds(specifiers([{ _t: "number" }, flags], 1, 1))).toEqual({ min: 2, max: 2 });
        expect(item_bounds(specifiers([{ _t: "number" }, { _t: "number" }, flags], 1, 4))).toEqual({ min: 3, max: 12 });
        expect(item_bounds(specifiers([{ _t: "number" }, flags]))).toEqual({ min: 0 });
        expect(item_bounds(specifiers([phandle], 1, 1))).toBeUndefined();
        // rdy-gpios before it is set: phandles only, maxItems counting entries.
        expect(item_bounds({ ...phandle, _t: "enum_array", minItems: 1, maxItems: 1 } as AttachType)).toBeUndefined();
        expect(count_warning("rdy-gpios", { ...phandle, _t: "enum_array", minItems: 1, maxItems: 1 } as AttachType, 3)).toBeUndefined();
    });

    test("value_count — the cells and the strings, over every group", () => {
        const tree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    diff-channels = <0 1>, <2>;
    clock-names = "mclk", "ext";
    bipolar;
};`);
        if (typeof tree === "string") { throw new TypeError(tree); }
        const property = (name: string): DTProperty => {
            const found = tree.node_at("/")?.properties.find(p => p.name === name);
            if (found === undefined) { throw new TypeError(name); }
            return found;
        };
        expect(value_count(property("diff-channels"))).toBe(3);
        expect(value_count(property("clock-names"))).toBe(2);
        expect(value_count(property("bipolar"))).toBe(0);
    });

    test("count_warning — exact, a range, a minimum, one value; nothing when it fits", () => {
        expect(count_warning("diff-channels", numbers(2, 2), 3)).toBe("warning: diff-channels takes 2 values, got 3");
        expect(count_warning("diff-channels", numbers(2, 2), 2)).toBeUndefined();
        expect(count_warning("lanes", numbers(1, 4), 5)).toBe("warning: lanes takes 1 to 4 values, got 5");
        expect(count_warning("lanes", numbers(2), 1)).toBe("warning: lanes takes at least 2 values, got 1");
        expect(count_warning("mode", numbers(1, 1), 2)).toBe("warning: mode takes 1 value, got 2");
        expect(count_warning("lanes", numbers(1), 9)).toBeUndefined();
        expect(count_warning("interrupts", { _t: "array", minItems: 1, maxItems: 1 } as AttachType, 2)).toBeUndefined();
        expect(count_warning("interrupts", specifiers([{ _t: "number" }, flags], 1, 1), 3)).toBe("warning: interrupts takes 2 values, got 3");
    });
}
