import { DeviceTree, number_property, type LocatedNode } from "../Devicetree/index.js";
import { is_clock_provider } from "./predicates.js";

/**
 * The clock provider a `clocks` entry names: `provider` as a value or a phandle name has it (`osc`, `&osc`,
 * `&{/clocks/osc}`, `/clocks/osc`), when that node has `#clock-cells`, enabled or not.
 */
function clock_provider(devicetree: DeviceTree, provider: string): LocatedNode | undefined {
	const identifier = devicetree.resolve_identifier(provider);
	const located = identifier === undefined ? undefined : devicetree.locate(identifier);
	return located !== undefined && is_clock_provider(located.node) ? located : undefined;
}

/**
 * How many cells follow the provider's phandle in one `clocks` entry: its `#clock-cells` (`<0>` none, `<1>` the
 * clock's index). Undefined when `provider` names no node with `#clock-cells`.
 */
export function clock_row_cells(devicetree: DeviceTree, provider: string): number | undefined {
	const found = clock_provider(devicetree, provider);
	const count = found === undefined ? undefined : number_property(found.node, "#clock-cells");
	return count === undefined ? undefined : Number(count);
}

/**
 * A `clocks` value (`node_data`'s: one row or several, of labels, paths and numbers) as its entries, counted as
 * dtc and dt-schema count them: each phandle, then as many cells as its provider's `#clock-cells`, whatever the
 * `<…>` groups the source writes (`<&osc &clkc 3>` is two clocks, `<&osc>, <&clkc>, <3>` too). Undefined when a
 * phandle names no clock provider or an entry is short of its cells: the value is then left as written.
 */
export function clock_specifiers(devicetree: DeviceTree, value: unknown): unknown[][] | undefined {
	const cells: unknown[] = Array.isArray(value) ? value.flat() : [value];
	const entries: unknown[][] = [];
	let index = 0;
	while (index < cells.length) {
		const head = cells[index];
		if (typeof head !== "string") { return; }
		const count = clock_row_cells(devicetree, head);
		if (count === undefined || index + 1 + count > cells.length) { return; }
		entries.push(cells.slice(index, index + 1 + count));
		index += 1 + count;
	}
	return entries.length === 0 ? undefined : entries;
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	const devicetree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    clocks {
        osc: osc {
            compatible = "fixed-clock";
            #clock-cells = <0>;
        };
        clkc: clock-controller {
            compatible = "x,clkc";
            #clock-cells = <1>;
            status = "disabled";
        };
        pll {
            compatible = "x,pll";
            #clock-cells = <2>;
        };
    };
    plain: plain {
        compatible = "x,plain";
    };
};`);
	if (typeof devicetree === "string") { throw new TypeError(devicetree); }

	test("clock_row_cells — the provider's #clock-cells, by label, reference or path; disabled providers too", () => {
		expect(clock_row_cells(devicetree, "osc")).toBe(0);
		expect(clock_row_cells(devicetree, "&clkc")).toBe(1);
		expect(clock_row_cells(devicetree, "&{/clocks/pll}")).toBe(2);
		expect(clock_row_cells(devicetree, "/clocks/pll")).toBe(2);
	});

	test("clock_row_cells — a node without #clock-cells, or none, is no provider", () => {
		expect(clock_row_cells(devicetree, "plain")).toBeUndefined();
		expect(clock_row_cells(devicetree, "nope")).toBeUndefined();
	});

	test("clock_specifiers — the entries follow each provider's #clock-cells, not the <…> groups", () => {
		expect(clock_specifiers(devicetree, [["osc", "clkc", 3]])).toStrictEqual([["osc"], ["clkc", 3]]);
		expect(clock_specifiers(devicetree, [["osc"], ["clkc"], [3]])).toStrictEqual([["osc"], ["clkc", 3]]);
		expect(clock_specifiers(devicetree, ["/clocks/pll", 1, 2, "osc"])).toStrictEqual([["/clocks/pll", 1, 2], ["osc"]]);
		expect(clock_specifiers(devicetree, "osc")).toStrictEqual([["osc"]]);
	});

	test("clock_specifiers — an unknown provider, a missing cell or a number where a phandle goes leaves the value", () => {
		expect(clock_specifiers(devicetree, [["osc", "nope"]])).toBeUndefined();
		expect(clock_specifiers(devicetree, [["clkc"]])).toBeUndefined();
		expect(clock_specifiers(devicetree, [["osc", 3]])).toBeUndefined();
		expect(clock_specifiers(devicetree, [])).toBeUndefined();
	});
}
