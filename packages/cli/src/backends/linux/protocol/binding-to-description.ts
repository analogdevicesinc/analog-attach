import { cell_range, is_open_list, type AttachType, type Cell, type List, type ParsedBinding, type ResolvedProperty } from "linux-lib";
import { attach_type_to_protocol_type } from "./dt-to-protocol";
import type { Types } from "./types";
import type { PropertyDescription, ChildNodeDescription, DeviceDescription } from "./descriptions";

/** `dt_type` of a property dt-schema gives no type, or that no binding defines. */
export const UNTYPED = "untyped";

const SEPARATOR = " · ";

/** The types whose value is rows of cells (dt-schema's `-matrix` types, `phandle-array`, `address`). */
const is_matrix_name = (type: string): boolean => type === "phandle-array" || type === "address" || type.endsWith("-matrix");

/** The types whose value is one value: a number, a string. */
const is_single_name = (type: string): boolean => type === "string" || /^u?int(8|16|32|64)$/.test(type);

/** `n items`, `2 to 4 items`, `at least 2 items`; nothing for one or more (an unset minimum is 1, as dt-schema counts a present property). */
function count_text(min: number | undefined, max: number | undefined, [one, many]: [string, string]): string | undefined {
	const low = min ?? 1;
	if (max === undefined) { return low > 1 ? `at least ${low} ${many}` : undefined; }
	if (low === max) { return `${max} ${max === 1 ? one : many}`; }
	return `${low} to ${max} ${many}`;
}

/** An enum option as the devicetree writes it: `"okay"`, `3`, `<1 2>`, `"a", "b"`. */
function option_text(option: Extract<Cell, { _t: "enum" }>["enum"][number]): string {
	if (Array.isArray(option)) {
		return typeof option[0] === "bigint" ? `<${option.join(" ")}>` : option.map(entry => `"${String(entry)}"`).join(", ");
	}
	return typeof option === "bigint" ? String(option) : `"${option}"`;
}

/**
 * What a cell allows beyond its type: `one of 3` (`const 28` for one option, as dt-schema's `const`), a number
 * range narrower than the type's (`0 to 7`). Nothing for a phandle enum: its options are the tree's candidates.
 */
function cell_text(cell: Cell, type: string): string | undefined {
	if (cell._t === "enum") {
		if (cell.enum_type === "phandle" || cell.enum_type === "macro") { return undefined; }
		const [only] = cell.enum;
		return cell.enum.length === 1 && only !== undefined ? `const ${option_text(only)}` : `one of ${cell.enum.length}`;
	}
	if (cell._t !== "number") { return undefined; }
	const range = cell_range(type);
	const minimum = cell.minimum ?? range?.minimum;
	const maximum = cell.maximum ?? range?.maximum;
	if (minimum === undefined || maximum === undefined || (minimum === range?.minimum && maximum === range.maximum)) { return undefined; }
	return `${minimum} to ${maximum}`;
}

/** The most cells types.yaml lets a row of these types have (a `phandle-array` row, an `address` row): no constraint of the binding's. */
const ROW_MAX_CELLS: Partial<Record<string, number>> = { "phandle-array": 1024, address: 5 };

/** The cells of one matrix row, when the binding says how many: `3 cells`, `1 to 8 cells`; nothing for a row only types.yaml sizes. */
function row_cells_text(row: List, type: string): string | undefined {
	if (Array.isArray(row.item)) { return count_text(row.minItems ?? row.item.length, row.maxItems ?? row.item.length, ["cell", "cells"]); }
	if (is_open_list(row) && row.minItems !== row.maxItems && (row.maxItems === undefined || row.maxItems === ROW_MAX_CELLS[type])) { return undefined; }
	return count_text(row.minItems, row.maxItems, ["cell", "cells"]);
}

/** What a matrix allows: `1 row of 3 cells`, `1 to 4 rows`, `rows of 2 cells`. */
function matrix_text(value: AttachType, type: string): string[] {
	if (value._t === "list") {
		// a matrix the devicetree shaped as one row (`reset-gpios` for its controller's cells)
		const cells = row_cells_text(value, type);
		return cells === undefined ? [] : [`1 row of ${cells}`];
	}
	if (value._t !== "matrix") { return []; }

	const [row, ...others] = value.rows;
	const rows = count_text(value.minItems, value.maxItems, ["row", "rows"]);
	const cells = row === undefined || others.length > 0 ? undefined : row_cells_text(row, type);
	const shape = cells === undefined ? rows : `${rows ?? "rows"} of ${cells}`;
	const one_cell = row !== undefined && others.length === 0 && row.maxItems === 1 && !Array.isArray(row.item) ? cell_text(row.item, type) : undefined;
	return [shape, one_cell].filter(text => text !== undefined);
}

/** What a list of values allows: its count, then what each value can be (`each one of 3`, `each 0 to 7`; `one of 3` after `1 item`). */
function list_text(value: List, type: string): string[] {
	if (Array.isArray(value.item)) {
		return [count_text(value.minItems ?? value.item.length, value.maxItems ?? value.item.length, ["item", "items"])].filter(text => text !== undefined);
	}
	const cell = value.item;
	// An enum of whole lists (`compatible`'s fallbacks, `clock-names: [a, b]` or `[a, c, b]`) is one value of the options
	if (cell._t === "enum" && value.maxItems === 1 && cell.enum.some(option => Array.isArray(option))) {
		return [cell_text(cell, type)].filter(text => text !== undefined);
	}
	const each = cell_text(cell, type);
	if (is_single_name(type) && value.maxItems === 1) { return each === undefined ? [] : [each]; }
	const per_value = each === undefined || value.maxItems === 1 ? each : `each ${each}`;
	return [count_text(value.minItems, value.maxItems, ["item", "items"]), per_value].filter(text => text !== undefined);
}

/**
 * A property's type in dt-schema's words, with what the binding constrains it to, one string: `uint32`,
 * `uint32-array · 2 to 4 items`, `phandle-array · 1 row of 3 cells`, `string · one of 3`, `flag`, `node`; `untyped`
 * when the binding gives none (`dt_type` undefined). The name is the processed schema's (`ResolvedProperty.dt_type`);
 * the constraints are read from `value`, the type as the binding (and the devicetree, for a specifier) shapes it. A
 * property dt-schema allows several types (`uint32-array | string-array`) is given them without constraints.
 */
export function format_dt_type(dt_type: string | undefined, value: AttachType): string {
	if (dt_type === undefined) { return UNTYPED; }
	if (dt_type.includes("|") || dt_type === "flag" || dt_type === "node" || dt_type === "phandle") { return dt_type; }

	let constraints: string[] = [];
	if (is_matrix_name(dt_type) || value._t === "matrix") {
		constraints = matrix_text(value, dt_type);
	} else if (value._t === "scalar") {
		constraints = [cell_text(value.cell, dt_type)].filter(text => text !== undefined);
	} else if (value._t === "list") {
		constraints = list_text(value, dt_type);
	}
	return [dt_type, ...constraints].join(SEPARATOR);
}

/** A type as `list devices` writes it: arrays as `<item>[]`, without the counts `list property` shows. */
export function format_type(type: Types): string {
	switch (type.kind) {
		case "number": { return "number"; }
		case "string": { return "string"; }
		case "bool": { return "bool"; }
		case "enum": { return `enum(${type.options.map(o => String(o.display_string ?? o.value)).join(" | ")})`; }
		case "array": { return `${format_type(type.items)}[]`; }
		case "tuple": { return `(${type.items.map(element => format_type(element)).join(", ")})`; }
	}
}

export function describe_property(
	resolved: ResolvedProperty,
	required: boolean,
	options?: { set?: boolean },
): PropertyDescription {
	const type = attach_type_to_protocol_type(resolved.value);
	return {
		name: resolved.key,
		...(resolved.value.description === undefined ? {} : { description: resolved.value.description }),
		type,
		display: format_type(type),
		dt_type: format_dt_type(resolved.dt_type, resolved.value),
		required,
		...(options?.set === undefined ? {} : { set: options.set }),
	};
}

export function child_node_name(pattern: string): string {
	const literal = pattern.replace(/^\^/, "").replaceAll(/\(([\w@,.-]+)\)/g, "$1");
	const prefix = /^[\w@,.-]*/.exec(literal)?.[0] ?? "";
	return prefix.endsWith("@") ? `${prefix}N` : (prefix || pattern);
}

export function describe_device(binding: ParsedBinding, compatible: string, binding_path: string): DeviceDescription {
	const required = new Set(binding.required_properties);
	const properties = binding.properties.map(p => describe_property(p, required.has(p.key)));
	const children: ChildNodeDescription[] = (binding.pattern_properties ?? []).map(rule => ({
		pattern: rule.pattern,
		name: child_node_name(rule.pattern),
		...(rule.description ? { description: rule.description } : {}),
		properties: rule.properties.map(p => describe_property(p, rule.required.includes(p.key))),
	}));

	return {
		key: compatible,
		compatible,
		...(binding.title === undefined ? {} : { title: binding.title }),
		...(binding.description === undefined ? {} : { description: binding.description }),
		binding: binding_path,
		properties,
		children,
	};
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const { AttachEnumType } = await import("linux-lib");

	test("child_node_name — the pattern's literal start, N after an @, the pattern when nothing is fixed", () => {
		expect(child_node_name("^channel@([0-9]|1[0-5])$")).toBe("channel@N");
		expect(child_node_name("^fan-[0-9]+$")).toBe("fan-");
		expect(child_node_name("^(port)@[0-9]$")).toBe("port@N");
		expect(child_node_name("^[a-z]+$")).toBe("^[a-z]+$");
	});

	const format = (dt_type: string | undefined, value: unknown): string => format_dt_type(dt_type, value as AttachType);

	test("format_dt_type — dt-schema's type, then what the binding constrains it to", () => {
		const uint32 = { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn } as const;
		const any = { _t: "any" } as const;
		const enum_of = (...options: (bigint | string)[]): Cell => ({ _t: "enum", enum: options, enum_type: typeof options[0] === "string" ? AttachEnumType.STRING : AttachEnumType.NUMBER });

		expect(format("uint32", { _t: "scalar", cell: uint32 })).toBe("uint32");
		expect(format("uint32", { _t: "scalar", cell: { _t: "number", minimum: 0n, maximum: 10_000_000n } })).toBe("uint32 · 0 to 10000000");
		expect(format("uint32", { _t: "scalar", cell: enum_of(0n, 1n, 3n) })).toBe("uint32 · one of 3");
		expect(format("uint32", { _t: "scalar", cell: enum_of(28n) })).toBe("uint32 · const 28");
		expect(format("uint32-array", { _t: "list", item: uint32, minItems: 1 })).toBe("uint32-array");
		expect(format("uint64-array", { _t: "list", item: { _t: "number" }, minItems: 2, maxItems: 4 })).toBe("uint64-array · 2 to 4 items");
		expect(format("uint32-array", { _t: "list", item: { _t: "number", minimum: 0n, maximum: 29n }, minItems: 2, maxItems: 2 })).toBe("uint32-array · 2 items · each 0 to 29");
		expect(format("uint32-array", { _t: "list", item: enum_of(10n, 100n, 500n, 1000n), maxItems: 1 })).toBe("uint32-array · 1 item · one of 4");
		expect(format("string", { _t: "list", item: enum_of("a", "b", "c"), maxItems: 1 })).toBe("string · one of 3");
		expect(format("string-array", { _t: "list", item: enum_of("mclk"), maxItems: 1 })).toBe("string-array · 1 item · const \"mclk\"");
		expect(format("string-array", { _t: "list", item: [enum_of("qspi_base"), enum_of("qspi_mmap")] })).toBe("string-array · 2 items");
		// the whole-list enum of `compatible`'s fallbacks
		expect(format("string-array", { _t: "list", item: { _t: "enum", enum: ["adi,adxl345", ["adi,adxl346", "adi,adxl345"]], enum_type: AttachEnumType.STRING }, maxItems: 1 })).toBe("string-array · one of 2");
		expect(format("phandle-array", { _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: [any, any, any] }] })).toBe("phandle-array · 1 row of 3 cells");
		expect(format("phandle-array", { _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: any, minItems: 1, maxItems: 1024 }] })).toBe("phandle-array · 1 row");
		expect(format("phandle-array", { _t: "matrix", minItems: 1, maxItems: 1, rows: [{ _t: "list", item: any, minItems: 1, maxItems: 8 }] })).toBe("phandle-array · 1 row of 1 to 8 cells");
		expect(format("address", { _t: "matrix", maxItems: 1, rows: [{ _t: "list", item: { _t: "number", minimum: 0n, maximum: 15n }, minItems: 1, maxItems: 1 }] })).toBe("address · 1 row of 1 cell · 0 to 15");
		expect(format("uint64-matrix", { _t: "matrix", minItems: 3, maxItems: 64, rows: [{ _t: "list", item: [{ _t: "number" }, { _t: "number" }] }] })).toBe("uint64-matrix · 3 to 64 rows of 2 cells");
		expect(format("flag", { _t: "flag" })).toBe("flag");
		expect(format("node", { _t: "node", properties: [] })).toBe("node");
		expect(format("phandle", { _t: "scalar", cell: { _t: "enum", enum: ["&a"], enum_type: AttachEnumType.PHANDLE } })).toBe("phandle");
		expect(format("uint32-array | string-array", { _t: "unknown" })).toBe("uint32-array | string-array");
		expect(format(undefined, { _t: "scalar", cell: enum_of("iq", "if") })).toBe("untyped");
	});

	test("describe_property — the shared description: the type and how it is written side by side", () => {
		const resolved = { key: "reg", value: { _t: "list", item: { _t: "number", signed: false }, minItems: 1, maxItems: 2, description: "Chip select" } } as unknown as ResolvedProperty;
		expect(describe_property(resolved, true)).toMatchObject({ name: "reg", description: "Chip select", display: "number[]", required: true });
		expect(describe_property({ key: "spi-cpol", value: { _t: "flag" } } as unknown as ResolvedProperty, false))
			.toEqual({ name: "spi-cpol", type: { kind: "bool" }, display: "bool", dt_type: "untyped", required: false });
		expect(describe_property({ key: "spi-cpol", value: { _t: "flag" }, dt_type: "flag" } as unknown as ResolvedProperty, false))
			.toMatchObject({ display: "bool", dt_type: "flag" });
	});
}
