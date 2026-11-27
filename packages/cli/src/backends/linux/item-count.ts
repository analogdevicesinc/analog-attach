import { AttachEnumType, clock_specifiers, is_dt_flag, list_cell, type AttachType, type Cell, type DeviceTree, type DTProperty } from "linux-lib";

// How many values a binding allows in a property (minItems / maxItems), for
// the arrays whose items are single values: numbers, strings, enum members.
// A specifier list counts entries (`interrupts = <25 2>` is one), so its
// bound is in cells only once every entry has a known width: interrupts
// under a known interrupt-parent. Lists whose entries name a phandle
// (clocks, dmas, *-gpios) have as many cells as the provider takes, so they
// have no bounds here; clocks are counted by entry instead (`clock_count`:
// each provider's #clock-cells). A value of a whole-list option (a `compatible` with
// its fallbacks, adi,range-microamp's `<0 20000>`) is one item, of any length.

export interface ItemBounds {
	min: number;
	max?: number;
}

export function item_bounds(type: AttachType): ItemBounds | undefined {
	switch (type._t) {
		case "list": {
			const cell = list_cell(type);
			// Untyped arrays and one cell per position have no bounds of their own.
			if (cell === undefined || cell._t === "any") { return undefined; }
			// An array of phandles is a phandle list before the lib knows its provider
			// (rdy-gpios = <&gpio 19 1> is one item of three cells).
			if (cell._t === "enum" && cell.enum_type === AttachEnumType.PHANDLE) { return undefined; }
			const min = type.minItems;
			const max = type.maxItems;
			return max === undefined ? { min: min ?? 0 } : { min: min ?? 0, max };
		}
		case "matrix": {
			const row = type.rows[0];
			if (type.rows.length !== 1 || !Array.isArray(row?.item)) { return undefined; }
			if (row.item.some(cell => cell._t === "enum" && cell.enum_type === AttachEnumType.PHANDLE)) { return undefined; }
			const width = row.item.length;
			const min = (type.minItems ?? 0) * width;
			return type.maxItems === undefined ? { min } : { min, max: type.maxItems * width };
		}
		default: {
			return undefined;
		}
	}
}

/**
 * The item of a list that is an enum with an option that is a whole list, written all at once; undefined for any
 * other type.
 */
export function whole_list_enum(type: AttachType): Extract<Cell, { _t: "enum" }> | undefined {
	if (type._t !== "list") { return undefined; }
	const cell = list_cell(type);
	return cell?._t === "enum" && cell.enum.some(option => Array.isArray(option)) ? cell : undefined;
}

/** The values a built property holds: its cells and its strings. */
export function value_count(property: DTProperty): number {
	if (is_dt_flag(property.value)) { return 0; }
	return property.value.reduce((sum, value) => sum + (value.kind === "array" ? value.elements.length : 1), 0);
}

/** The warning for a value count the binding doesn't allow; undefined when it fits or the binding sets no bounds. */
export function count_warning(property: string, type: AttachType, values: number): string | undefined {
	const bounds = item_bounds(type);
	if (bounds === undefined) { return undefined; }
	const { min, max } = bounds;
	// A value of several whole-list options would need the cells split by option; no binding has one yet.
	const count = whole_list_enum(type) === undefined ? values : Math.min(values, 1);
	if (count >= min && (max === undefined || count <= max)) { return undefined; }
	const takes = max === undefined
		? `at least ${min} values`
		: (min === max ? `${max} ${max === 1 ? "value" : "values"}` : `${min} to ${max} values`);
	return `warning: ${property} takes ${takes}, got ${count}`;
}

/**
 * The clocks of a built `clocks` value, as each provider's `#clock-cells` counts them in `tree` (`<&osc &clkc 3>`
 * is two); undefined when a phandle names no clock provider or an entry is short of its cells.
 */
export function clock_count(property: DTProperty, tree: DeviceTree): number | undefined {
	if (is_dt_flag(property.value)) { return undefined; }
	// A phandle as its name or path; a number or an expression as itself; a string is no cell (never a provider).
	const cells = property.value.flatMap((value): unknown[] => {
		switch (value.kind) {
			case "array": { return value.elements.map(element => element.kind === "label" ? element.name : (element.kind === "path" ? element.path : element.value)); }
			case "label": { return [value.name]; }
			case "path": { return [value.path]; }
			case "string": { return [undefined]; }
		}
	});
	return clock_specifiers(tree, cells)?.length;
}

/** The warning for a count of clocks the binding's rows don't allow; undefined when it fits. */
export function clock_count_warning(type: AttachType, clocks: number): string | undefined {
	if (type._t !== "matrix") { return undefined; }
	const min = type.minItems ?? 0;
	const max = type.maxItems;
	if (clocks >= min && (max === undefined || clocks <= max)) { return undefined; }
	const takes = max === undefined
		? `at least ${min} ${min === 1 ? "clock" : "clocks"}`
		: (min === max ? `${max} ${max === 1 ? "clock" : "clocks"}` : `${min} to ${max} clocks`);
	return `warning: clocks takes ${takes}, got ${clocks}`;
}

/**
 * The count warning of a written value: `clocks` by its clocks (`clock_count`, the binding's rows), when every
 * phandle names a provider of `tree`; any other property by its values (`count_warning`).
 */
export function written_count_warning(property: string, type: AttachType, built: DTProperty, tree: DeviceTree): string | undefined {
	if (property !== "clocks") { return count_warning(property, type, value_count(built)); }
	const clocks = clock_count(built, tree);
	return clocks === undefined ? undefined : clock_count_warning(type, clocks);
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const { DeviceTree } = await import("linux-lib");

	const numbers = (minItems: number | undefined, maxItems?: number): AttachType =>
		({ _t: "list", item: { _t: "number" }, minItems, maxItems });

	test("item_bounds — value arrays only; a missing min is 0, a missing max unbounded", () => {
		expect(item_bounds(numbers(2, 2))).toEqual({ min: 2, max: 2 });
		expect(item_bounds(numbers(1))).toEqual({ min: 1 });
		expect(item_bounds(numbers(undefined, 4))).toEqual({ min: 0, max: 4 });
		expect(item_bounds({ _t: "list", item: { _t: "string" }, minItems: 1, maxItems: 3 })).toEqual({ min: 1, max: 3 });
		expect(item_bounds({ _t: "list", item: { _t: "enum", enum: ["a", "b"], enum_type: AttachEnumType.STRING }, minItems: 2, maxItems: 2 })).toEqual({ min: 2, max: 2 });
		expect(item_bounds({ _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 2 })).toBeUndefined();
		expect(item_bounds({ _t: "scalar", cell: { _t: "number" } })).toBeUndefined();
	});

	const specifiers = (cells: Cell[], minItems?: number, maxItems?: number): AttachType =>
		({ _t: "matrix", minItems, maxItems, rows: [{ _t: "list", item: cells, minItems: cells.length, maxItems: cells.length }] });
	const flags: Cell = { _t: "enum", enum: ["IRQ_TYPE_EDGE_FALLING"], enum_type: AttachEnumType.MACRO };
	const phandle: Cell = { _t: "enum", enum: ["clk_osc"], enum_type: AttachEnumType.PHANDLE };

	test("item_bounds — a specifier list of a known width counts its cells; one naming a phandle has no bounds", () => {
		expect(item_bounds(specifiers([{ _t: "number" }, flags], 1, 1))).toEqual({ min: 2, max: 2 });
		expect(item_bounds(specifiers([{ _t: "number" }, { _t: "number" }, flags], 1, 4))).toEqual({ min: 3, max: 12 });
		expect(item_bounds(specifiers([{ _t: "number" }, flags]))).toEqual({ min: 0 });
		expect(item_bounds(specifiers([phandle], 1, 1))).toBeUndefined();
		// rdy-gpios before it is set: phandles only, maxItems counting entries.
		expect(item_bounds({ _t: "list", item: phandle, minItems: 1, maxItems: 1 })).toBeUndefined();
		expect(count_warning("rdy-gpios", { _t: "list", item: phandle, minItems: 1, maxItems: 1 }, 3)).toBeUndefined();
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
		expect(count_warning("interrupts", { _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 1 }, 2)).toBeUndefined();
		expect(count_warning("interrupts", specifiers([{ _t: "number" }, flags], 1, 1), 3)).toBe("warning: interrupts takes 2 values, got 3");
	});

	test("count_warning — a value of a whole-list option counts as one, of any length", () => {
		const range: AttachType = { _t: "list", item: { _t: "enum", enum: [[0n, 20_000n], [0n, 24_000n]], enum_type: AttachEnumType.NUMBER }, minItems: 1, maxItems: 1 };
		expect(count_warning("adi,range-microamp", range, 2)).toBeUndefined();
		expect(count_warning("adi,range-microamp", range, 3)).toBeUndefined();
		expect(count_warning("adi,range-microamp", range, 0)).toBe("warning: adi,range-microamp takes 1 value, got 0");
		const compatible: AttachType = {
			_t: "list",
			item: { _t: "enum", enum: [["raspberrypi,400", "brcm,bcm2711"], "brcm,bcm2711"], enum_type: AttachEnumType.STRING },
			minItems: 1,
			maxItems: 1,
		};
		expect(count_warning("compatible", compatible, 2)).toBeUndefined();
		expect(count_warning("compatible", compatible, 1)).toBeUndefined();
	});

	test("clock_count — each provider's phandle and its #clock-cells, whatever the <…> groups; none for an unknown provider", () => {
		const tree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    osc: osc { compatible = "fixed-clock"; #clock-cells = <0>; };
    clkc: clkc { compatible = "x,clkc"; #clock-cells = <1>; };
    one { clocks = <&osc &clkc 3>; };
    two { clocks = <&osc>, <&clkc 3>, <&{/osc}>; };
    bad { clocks = <&osc &nope>; };
};`);
		if (typeof tree === "string") { throw new TypeError(tree); }
		const clocks = (path: string): DTProperty => tree.node_at(path)!.properties.find(p => p.name === "clocks")!;
		expect(clock_count(clocks("/one"), tree)).toBe(2);
		expect(clock_count(clocks("/two"), tree)).toBe(3);
		expect(clock_count(clocks("/bad"), tree)).toBeUndefined();
	});

	const rows = (minItems?: number, maxItems?: number): AttachType => ({ _t: "matrix", minItems, maxItems, rows: [{ _t: "list", item: [phandle], minItems: 1, maxItems: 1 }] });

	test("clock_count_warning — the binding's rows: exact, a range, a minimum; nothing when it fits", () => {
		expect(clock_count_warning(rows(1, 1), 2)).toBe("warning: clocks takes 1 clock, got 2");
		expect(clock_count_warning(rows(1, 2), 3)).toBe("warning: clocks takes 1 to 2 clocks, got 3");
		expect(clock_count_warning(rows(2), 1)).toBe("warning: clocks takes at least 2 clocks, got 1");
		expect(clock_count_warning(rows(2, 2), 1)).toBe("warning: clocks takes 2 clocks, got 1");
		expect(clock_count_warning(rows(1, 2), 2)).toBeUndefined();
		expect(clock_count_warning({ _t: "unknown" }, 5)).toBeUndefined();
	});
}
