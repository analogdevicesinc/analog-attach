/* eslint-disable unicorn/no-null */
import {
	is_dt_flag,
	get_full_node_name,
	list_cell,
	AttachEnumType,
	type AttachType,
	type Cell,
	type DTNode,
	type EnumOption,
	type List,
	type DTProperty as AttachDTProperty,
	type DTValue,
	type CellArrayElement,
	print_number,
} from "linux-lib";

import type { Node, Property, Types, PropertyValue } from "./types";

type EnumOptionType = Extract<Types, { kind: "enum" }>["options"][number];
import { item_bounds } from "../item-count";

export function convert_node(node: DTNode): Node {
	const key = get_full_node_name(node);

	return {
		kind: "node",
		key: key,
		properties: node.properties.map(p => convert_property(p)),
		children: node.children.map(c => convert_node(c)),
		alias: node.labels,
	};
}

export function convert_property(property: AttachDTProperty): Property {
	if (is_dt_flag(property.value)) {
		return {
			kind: "property",
			key: property.name,
			type: { kind: "bool" },
			value: true,
		};
	}

	const values = property.value as DTValue[];
	const { type, value } = infer_type_and_value(values);

	return {
		kind: "property",
		key: property.name,
		type,
		value,
	};
}

/**
 * The property's value with each number as the overlay writes it (`"0x53"`, `"83"`, `"(-1)"`), in the nesting of
 * `convert_property`'s `value`, the other values as there (READ-054). Undefined when the value has no number: a flag,
 * strings or references alone.
 */
export function written_value(property: AttachDTProperty): PropertyValue | undefined {
	if (is_dt_flag(property.value)) { return undefined; }
	const values = property.value as DTValue[];
	const has_number = values.some(v => v.kind === "array" && v.elements.some(element => element.kind === "number"));
	return has_number ? infer_type_and_value(values, AS_WRITTEN).value : undefined;
}

/** What a number cell becomes: a JSON number (`value`), or its text as the overlay writes it (`written`). */
type NumberOf = (element: Extract<CellArrayElement, { kind: "number" }>) => PropertyValue;
const AS_NUMBER: NumberOf = element => Number(element.value);
const AS_WRITTEN: NumberOf = element => print_number(element.value, element.repr);

function infer_type_and_value(values: DTValue[], number_of: NumberOf = AS_NUMBER): { type: Types; value: PropertyValue } {
	if (values.length === 0) {
		return { type: { kind: "string" }, value: null };
	}

	if (values.length === 1) {
		const v = values[0]!;
		return convert_single_value(v, number_of);
	}

	const converted = values.map(v => convert_single_value(v, number_of));
	return {
		type: { kind: "array", items: converted[0]!.type },
		value: converted.map(c => c.value),
	};
}

function convert_single_value(v: DTValue, number_of: NumberOf): { type: Types; value: PropertyValue } {
	switch (v.kind) {
		case "string": {
			return { type: { kind: "string" }, value: v.value };
		}
		case "label": {
			return { type: { kind: "string" }, value: `&${v.name}` };
		}
		case "path": {
			return { type: { kind: "string" }, value: v.path };
		}
		case "array": {
			return convert_cell_array(v.elements, number_of);
		}
	}
}

function convert_cell_array(elements: CellArrayElement[], number_of: NumberOf): { type: Types; value: PropertyValue } {
	if (elements.length === 0) {
		return { type: { kind: "array", items: { kind: "number", subtype: "int" } }, value: [] };
	}

	if (elements.length === 1) {
		const element = elements[0]!;
		const converted = convert_cell_element(element, number_of);
		return { type: converted.type, value: converted.value };
	}

	const converted = elements.map(element => convert_cell_element(element, number_of));
	return {
		type: { kind: "array", items: { kind: "number", subtype: "int" } },
		value: converted.map(c => c.value),
	};
}

/** The binding's minItems / maxItems on a value array, as the protocol names them. */
function item_counts(value: AttachType): { min_items?: number; max_items?: number } {
	const bounds = item_bounds(value);
	if (bounds === undefined) { return {}; }
	return { min_items: bounds.min, ...(bounds.max === undefined ? {} : { max_items: bounds.max }) };
}

/**
 * The width of a row the devicetree shaped from its provider: a phandle, then the cells the provider's `#…-cells`
 * asks for (`clocks = <&clocks 20>`, two), or the phandle alone while it is to be chosen. Undefined for any other
 * row, whose phandle cells, if any, the binding alone gives.
 */
function specifier_width(row: List): number | undefined {
	if (!Array.isArray(row.item) || row.item.length === 0 || row.minItems !== row.item.length || row.maxItems !== row.item.length) { return undefined; }
	const [first] = row.item;
	return first?._t === "enum" && first.enum_type === AttachEnumType.PHANDLE ? row.item.length : undefined;
}

/**
 * The counts of a matrix: in cells (`item_bounds`) when its rows are one cell per position (a specifier list), a
 * phandle's too once the devicetree has shaped its row (`specifier_width`: as many cells as the binding's rows of
 * the first row's width), in rows when they are a list of one kind of cell (`reg`'s rows of address + size cells),
 * as many as the binding allows; none for other rows of phandles, whose cells the provider decides.
 */
function matrix_counts(value: Extract<AttachType, { _t: "matrix" }>): { min_items?: number; max_items?: number } {
	const width = value.rows.length === 1 && value.rows[0] !== undefined ? specifier_width(value.rows[0]) : undefined;
	if (width !== undefined) {
		if (value.minItems === undefined && value.maxItems === undefined) { return {}; }
		return { min_items: (value.minItems ?? 0) * width, ...(value.maxItems === undefined ? {} : { max_items: value.maxItems * width }) };
	}
	const cell = value.rows.length === 1 && value.rows[0] !== undefined ? list_cell(value.rows[0]) : undefined;
	if (cell === undefined || (cell._t === "enum" && cell.enum_type === AttachEnumType.PHANDLE)) { return item_counts(value); }
	if (value.minItems === undefined && value.maxItems === undefined) { return {}; }
	return { min_items: value.minItems ?? 0, ...(value.maxItems === undefined ? {} : { max_items: value.maxItems }) };
}

/**
 * One option of an enum. An option that is a whole list (a `compatible` with its fallbacks, `data-lanes`' `<1 2>`) is
 * one value written all at once: `value` is its values joined by a space, as `list value` gives it and `update` takes
 * it, a string because the option is a list, not because the property is one; `list` is the list itself, and
 * `display_string` the list as the devicetree writes it.
 */
function enum_option(option: EnumOption, enum_type: AttachEnumType): EnumOptionType {
	if (Array.isArray(option)) {
		const values = option.map(entry => typeof entry === "bigint" ? Number(entry) : entry);
		const display_string = typeof option[0] === "bigint" ? `<${values.join(" ")}>` : values.map(entry => `"${entry}"`).join(", ");
		return { value: values.join(" "), list: values, display_string };
	}
	return enum_type === AttachEnumType.NUMBER ? { value: Number(option) } : { value: String(option) };
}

/** The protocol type of one value: a cell or a string. */
function cell_to_protocol_type(cell: Cell): Types {
	switch (cell._t) {
		case "string": {
			return { kind: "string" };
		}
		case "enum": {
			return { kind: "enum", options: cell.enum.map(option => enum_option(option, cell.enum_type)) };
		}
		case "number":
		case "any": {
			return { kind: "number", subtype: "int" };
		}
	}
}

export function attach_type_to_protocol_type(value: AttachType): Types {
	switch (value._t) {
		case "flag": {
			return { kind: "bool" };
		}
		case "scalar": {
			const cell = value.cell;
			// A one-option enum the binding also defaults to is a const.
			if (cell._t === "enum" && cell.enum.length === 1 && cell.enum[0] === value.default) {
				return typeof value.default === "string" ? { kind: "string" } : { kind: "number", subtype: "int" };
			}
			return cell_to_protocol_type(cell);
		}
		case "unknown":
		case "node": {
			return { kind: "string" };
		}
		case "list": {
			if (Array.isArray(value.item)) {
				return { kind: "tuple", items: value.item.map(cell => cell_to_protocol_type(cell)) };
			}
			const item = cell_to_protocol_type(value.item);
			if (value.item._t === "any") {
				return { kind: "array", items: item };
			}
			return value.maxItems === 1 ? item : { kind: "array", items: item, ...item_counts(value) };
		}
		case "matrix": {
			const row = value.rows[0];
			return {
				kind: "array",
				items: row === undefined ? { kind: "number", subtype: "int" } : attach_type_to_protocol_type(row),
				...matrix_counts(value),
			};
		}
		default: {
			const _x: never = value;
			throw new Error("Exhaustive check failed");
		}
	}
}

function convert_cell_element(element: CellArrayElement, number_of: NumberOf): { type: Types; value: PropertyValue } {
	switch (element.kind) {
		case "number": {
			return { type: { kind: "number", subtype: "int" }, value: number_of(element) };
		}
		case "label": {
			return { type: { kind: "string" }, value: `&${element.name}` };
		}
		case "path": {
			return { type: { kind: "string" }, value: element.path };
		}
		case "expression": {
			return { type: { kind: "string" }, value: element.value };
		}
	}
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	test("written_value — each number as written, in value's nesting; none without a number", async () => {
		const { DeviceTree } = await import("linux-lib");
		const tree = DeviceTree.new_from_string(`/dts-v1/;
/ {
	node {
		reg = <0x53>;
		cells = <0x1d 29 &gpio (1 + 2)>;
		rows = <&gpio 0x8 1>, <&gpio 7 0x1>;
		mixed = "a", <0x10>;
		name = "adc";
		ref = <&gpio>;
		flag;
	};
};`);
		if (typeof tree === "string") { throw new TypeError(tree); }
		const property = (name: string): AttachDTProperty => {
			const found = tree.node_at("/node")?.properties.find(p => p.name === name);
			if (found === undefined) { throw new TypeError(name); }
			return found;
		};
		expect(written_value(property("reg"))).toBe("0x53");
		expect(convert_property(property("reg")).value).toBe(83);
		expect(written_value(property("cells"))).toEqual(["0x1d", "29", "&gpio", "(1+2)"]);
		expect(written_value(property("rows"))).toEqual([["&gpio", "0x8", "1"], ["&gpio", "7", "0x1"]]);
		expect(written_value(property("mixed"))).toEqual(["a", "0x10"]);
		expect(written_value(property("name"))).toBeUndefined();
		expect(written_value(property("ref"))).toBeUndefined();
		expect(written_value(property("flag"))).toBeUndefined();
	});

	test("attach_type_to_protocol_type — value arrays carry the binding's item counts, entry lists don't", () => {
		expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "number" }, minItems: 2, maxItems: 2 }))
			.toEqual({ kind: "array", items: { kind: "number", subtype: "int" }, min_items: 2, max_items: 2 });
		expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "string" }, minItems: 1 }))
			.toEqual({ kind: "array", items: { kind: "string" }, min_items: 1 });
		expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "number" }, minItems: 1, maxItems: 1 }))
			.toEqual({ kind: "number", subtype: "int" });
		expect(attach_type_to_protocol_type({ _t: "list", item: { _t: "any" }, minItems: 1, maxItems: 2 }))
			.toEqual({ kind: "array", items: { kind: "number", subtype: "int" } });
	});

	test("attach_type_to_protocol_type — a defaulted one-option enum is a const", () => {
		const one = (default_value: bigint | string | undefined, option: bigint | string): AttachType => ({
			_t: "scalar",
			cell: { _t: "enum", enum: [option], enum_type: typeof option === "string" ? AttachEnumType.STRING : AttachEnumType.NUMBER },
			...(default_value === undefined ? {} : { default: default_value }),
		});
		expect(attach_type_to_protocol_type(one(3n, 3n))).toEqual({ kind: "number", subtype: "int" });
		expect(attach_type_to_protocol_type(one("a", "a"))).toEqual({ kind: "string" });
		expect(attach_type_to_protocol_type(one(undefined, 3n))).toEqual({ kind: "enum", options: [{ value: 3 }] });
	});

	test("attach_type_to_protocol_type — an option that is a whole list is its values joined, with the list beside", () => {
		const whole = (options: (bigint[] | string[])[], enum_type: AttachEnumType): AttachType =>
			({ _t: "list", item: { _t: "enum", enum: options, enum_type }, minItems: 1, maxItems: 1 });
		expect(attach_type_to_protocol_type(whole([[1n, 2n], [1n, 2n, 3n, 4n]], AttachEnumType.NUMBER))).toEqual({
			kind: "enum",
			options: [
				{ value: "1 2", list: [1, 2], display_string: "<1 2>" },
				{ value: "1 2 3 4", list: [1, 2, 3, 4], display_string: "<1 2 3 4>" },
			],
		});
		expect(attach_type_to_protocol_type(whole([["raspberrypi,4-model-b", "brcm,bcm2711"]], AttachEnumType.STRING))).toEqual({
			kind: "enum",
			options: [{
				value: "raspberrypi,4-model-b brcm,bcm2711",
				list: ["raspberrypi,4-model-b", "brcm,bcm2711"],
				display_string: `"raspberrypi,4-model-b", "brcm,bcm2711"`,
			}],
		});
	});

	test("attach_type_to_protocol_type — interrupts under a known parent count cells", () => {
		const interrupts: AttachType = {
			_t: "matrix",
			minItems: 1,
			maxItems: 1,
			rows: [{ _t: "list", item: [{ _t: "number" }, { _t: "number" }], minItems: 2, maxItems: 2 }],
		};
		expect(attach_type_to_protocol_type(interrupts)).toEqual({
			kind: "array",
			items: { kind: "tuple", items: [{ kind: "number", subtype: "int" }, { kind: "number", subtype: "int" }] },
			min_items: 2,
			max_items: 2,
		});
	});

	test("attach_type_to_protocol_type — a matrix of rows of one kind of cell counts its rows", () => {
		const number: Cell = { _t: "number", minimum: 0n, maximum: 256n };
		const reg = (cells: number): AttachType => ({ _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: number, minItems: cells, maxItems: cells }] });
		// a chip select: one row of one cell
		expect(attach_type_to_protocol_type(reg(1))).toEqual({ kind: "array", items: { kind: "number", subtype: "int" }, min_items: 1, max_items: 1 });
		expect(attach_type_to_protocol_type(reg(2))).toEqual({
			kind: "array",
			items: { kind: "array", items: { kind: "number", subtype: "int" }, min_items: 2, max_items: 2 },
			min_items: 1,
			max_items: 1,
		});
		// no counts in the binding, or rows of phandles: none
		expect(attach_type_to_protocol_type({ _t: "matrix", rows: [{ _t: "list", item: number }] }))
			.toEqual({ kind: "array", items: { kind: "array", items: { kind: "number", subtype: "int" }, min_items: 0 } });
		const phandle: Cell = { _t: "enum", enum: ["gpio"], enum_type: AttachEnumType.PHANDLE };
		expect(attach_type_to_protocol_type({ _t: "matrix", minItems: 1, maxItems: 2, rows: [{ _t: "list", item: phandle, maxItems: 1 }] }))
			.not.toHaveProperty("max_items");
	});

	test("attach_type_to_protocol_type — a phandle row its provider shaped counts the binding's rows in cells", () => {
		const provider: Cell = { _t: "enum", enum: ["clk_osc", "clocks"], enum_type: AttachEnumType.PHANDLE };
		const clocks = (cells: Cell[], minItems?: number, maxItems?: number): AttachType =>
			({ _t: "matrix", minItems, maxItems, rows: [{ _t: "list", item: cells, minItems: cells.length, maxItems: cells.length }] });
		const number: Cell = { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn };
		// The provider to choose: a row of one cell; chosen with #clock-cells = <1>: two.
		expect(attach_type_to_protocol_type(clocks([provider], 1, 1))).toMatchObject({ min_items: 1, max_items: 1 });
		expect(attach_type_to_protocol_type(clocks([{ ...provider, default: "clocks" }, number], 1, 1))).toMatchObject({ min_items: 2, max_items: 2 });
		expect(attach_type_to_protocol_type(clocks([provider, number], 1, 4))).toMatchObject({ min_items: 2, max_items: 8 });
		expect(attach_type_to_protocol_type(clocks([provider, number], 1))).not.toHaveProperty("max_items");
		expect(attach_type_to_protocol_type(clocks([provider, number]))).not.toHaveProperty("min_items");
	});
}
