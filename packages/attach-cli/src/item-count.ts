import { is_dt_flag, type AttachType, type DTProperty } from "attach-lib";

// How many values a binding allows in a property (minItems / maxItems), for
// the arrays whose items are single values: numbers, strings, enum members.
// Phandle and specifier lists (`array`) and matrices count entries, not
// cells (`interrupts = <25 2>` is one entry), so they have no bounds here.

export interface ItemBounds {
    min: number;
    max?: number;
}

export function item_bounds(type: AttachType): ItemBounds | undefined {
    switch (type._t) {
        case "number_array":
        case "string_array":
        case "enum_array": {
            // The parsed binding leaves a bound out as undefined, whatever its type says.
            const min = type.minItems as number | undefined;
            const max = type.maxItems as number | undefined;
            return max === undefined ? { min: min ?? 0 } : { min: min ?? 0, max };
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
    });
}
