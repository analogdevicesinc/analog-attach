import { DeviceTree, DTNode, DTProperty, is_dt_flag, DTValue, DTNumber, DTLabel, DTPath, DTExpression } from "../Devicetree";
import { ResolvedProperty } from "../Bindings/index.js";
import { clock_specifiers } from "../Intelligence/clocks.js";

/** `node_data` as the JSON string branch narrowing and the intelligence layers take; bigints become numbers. */
export function node_data_json(node: DTNode, properties: readonly ResolvedProperty[], devicetree?: DeviceTree): string {
	return JSON.stringify(
		Object.fromEntries(node_data(node, properties, devicetree)),
		(_key, value) => typeof value === "bigint" ? Number(value) : value
	);
}

/**
 * A node's properties as the binding's types shape them. With the `devicetree` its phandles name, a `clocks` matrix
 * is its entries as dt-schema counts them (`clock_specifiers`: each provider's `#clock-cells`), so `<&osc &clkc 3>`
 * is two clocks; without it, or when a provider isn't found, the rows are the `<…>` groups the source writes.
 */
export function node_data(node: DTNode, properties: readonly ResolvedProperty[], devicetree?: DeviceTree): Map<string, unknown> {
	const map = new Map<string, unknown>();
	for (const property of node.properties) {
		if (property.name === "status") { continue; }

		const value = _parse_dt_property(property);
		const definition = properties.find(v => v.key === property.name);

		if (definition === undefined) {
			map.set(property.name, value);
			continue;
		}

		const definition_type = definition.value._t;
		switch (definition_type) {
			case "list": {
				if (Array.isArray(value)) {
					map.set(property.name, value);
					continue;
				}
				map.set(property.name, [value]);
				continue;
			}
			case "matrix": {
				const entries = property.name === "clocks" && devicetree !== undefined ? clock_specifiers(devicetree, value) : undefined;
				if (entries !== undefined) {
					map.set(property.name, entries);
					continue;
				}
				if (Array.isArray(value)) {
					if (value.every(entry => Array.isArray(entry))) {
						map.set(property.name, value);
						continue;
					}
					map.set(property.name, [value]);
					continue;
				} else {
					map.set(property.name, [[value]]);
					continue;
				}
			}
			case "flag":
			case "scalar":
			case "unknown": {
				if (Array.isArray(value) && value.length === 1) {
					map.set(property.name, value[0]);
					continue;
				}
				map.set(property.name, value);
				continue;
			}
			case "node": { continue; }
			default: {
				const _x: never = definition_type;
				throw new Error("Exhaustion check failed!");
			}
		}
	}
	return map;
}

function _parse_dt_property(property: DTProperty): unknown {
	if (is_dt_flag(property.value)) { return true; }
	const values = property.value;
	if (values.length === 1 && values[0] !== undefined) {
		return _parse_dt_value(values[0]);
	}
	return values.map(v => _parse_dt_value(v));
}

function _parse_dt_value(v: DTValue): unknown {
	switch (v.kind) {
		case "string": {
			return v.value;
		}
		case "label": {
			return v.name;
		}
		case "path": {
			return v.path;
		}
		case "array": {
			return v.elements.map(element => _parse_dt_cell_element(element));
		}
		default: {
			const _x: never = v;
			throw new Error("Exhaustion check failed!");
		}
	}
}

function _parse_dt_cell_element(element: DTNumber | DTLabel | DTPath | DTExpression): string | bigint {
	switch (element.kind) {
		case "number": {
			return element.value;
		}
		case "label": {
			return element.name;
		}
		case "path": {
			return element.path;
		}
		case "expression": {
			return element.value;
		}
		default: {
			const _x: never = element;
			throw new Error("Exhaustive check failed!");
		}
	}
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	test("node_data — with the tree, clocks are counted by each provider's #clock-cells", () => {
		const devicetree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    osc: osc { compatible = "fixed-clock"; #clock-cells = <0>; };
    clkc: clkc { compatible = "x,clkc"; #clock-cells = <1>; };
    adc { clocks = <&osc &clkc 3>; };
    dac { clocks = <&osc &nope>; };
};`);
		if (typeof devicetree === "string") { throw new TypeError(devicetree); }
		const clocks: ResolvedProperty = { key: "clocks", value: { _t: "matrix", rows: [{ _t: "list", item: { _t: "any" } }] } };
		const data = (path: string, dt?: DeviceTree) => node_data(devicetree.node_at(path)!, [clocks], dt).get("clocks");
		expect(data("/adc", devicetree)).toStrictEqual([["osc"], ["clkc", 3n]]);
		// Without the tree, or with a phandle that names no provider, the <…> groups.
		expect(data("/adc")).toStrictEqual([["osc", "clkc", 3n]]);
		expect(data("/dac", devicetree)).toStrictEqual([["osc", "nope"]]);
	});
}
