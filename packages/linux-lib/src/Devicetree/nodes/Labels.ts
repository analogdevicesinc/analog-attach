import { type DTLabel, type DTNode, is_dt_flag } from "../syntax/AST.js";

const LABEL_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function is_valid_label(label: string): boolean {
	return LABEL_RE.test(label);
}

// The characters both the lexer's identifier and dtc's node-name check accept: the lexer has `#`
// and no `+`, dtc the reverse.
const NODE_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_,.-]*$/;
const UNIT_ADDRESS_RE = /^[A-Za-z0-9_,.-]+$/;
// What the lexer's number rule takes before an identifier: `12`, `1,a`, `0x1f…`.
const NUMBER_PREFIX_RE = /^(0[xX][0-9a-fA-F]|[0-9]+(?![A-Za-z0-9_]))/;

/** A node's name without its unit address (`adc`, `adi,ad7124-8`). */
export function is_valid_node_name(name: string): boolean {
	return NODE_NAME_RE.test(name) && !NUMBER_PREFIX_RE.test(name);
}

/** A node's unit address, the part after `@`. */
export function is_valid_unit_address(unit: string): boolean {
	return UNIT_ADDRESS_RE.test(unit);
}

export function label_from_compatible(compatible: string): string {
	const comma = compatible.indexOf(",");
	const base = comma === -1 ? compatible : compatible.slice(comma + 1);
	const vendor = comma === -1 ? undefined : compatible.slice(0, comma);
	let sanitized = base.replaceAll(/[^A-Za-z0-9_]/g, "_");
	if (/^\d/.test(sanitized)) {
		sanitized = vendor === undefined ? `_${sanitized}` : `${vendor.replaceAll(/[^A-Za-z0-9_]/g, "_")}_${sanitized}`;
	}
	return sanitized;
}

export function unique_label(base_label: string, all_labels: Map<string, string>): string {
	if (!all_labels.has(base_label)) { return base_label; }
	for (let index = 1; ; index++) {
		const candidate = `${base_label}_${index}`;
		if (!all_labels.has(candidate)) { return candidate; }
	}
}

/**
 * A node name without a unit address that no child of the parent has (`taken`, the children's keys): `name` when it
 * is free, else `<name>-<n>` with the smallest `<n>` from 1 that is (`regulator-fixed-1`), as `unique_label` numbers a
 * label.
 */
export function unique_node_name(name: string, taken: { has(key: string): boolean }): string {
	if (!taken.has(name)) { return name; }
	for (let index = 1; ; index++) {
		const candidate = `${name}-${index}`;
		if (!taken.has(candidate)) { return candidate; }
	}
}

/** Point the `&label` references in the subtree at the renamed labels. */
export function rename_references(node: DTNode, renames: Map<string, string>): void {
	const rename = (value: { kind: string }): void => {
		if (value.kind !== "label") { return; }
		const reference = value as DTLabel;
		const bare = reference.name.startsWith("&") ? reference.name.slice(1) : reference.name;
		const renamed = renames.get(bare);
		if (renamed !== undefined) { reference.name = reference.name.startsWith("&") ? `&${renamed}` : renamed; }
	};
	for (const property of node.properties) {
		if (is_dt_flag(property.value)) { continue; }
		for (const value of property.value) {
			for (const element of value.kind === "array" ? value.elements : [value]) { rename(element); }
		}
	}
	for (const child of node.children) { rename_references(child, renames); }
}

export type LabelChoice =
	| { status: "ok"; label: string }
	| { status: "invalid" }
	| { status: "taken"; owner: string };

/** Accept `explicit` if it is valid and free, else derive a free label from `compatible`. */
export function choose_label(
	explicit: string | undefined,
	compatible: string,
	all_labels: Map<string, string>,
): LabelChoice {
	if (explicit === undefined) {
		return { status: "ok", label: unique_label(label_from_compatible(compatible), all_labels) };
	}
	if (!is_valid_label(explicit)) { return { status: "invalid" }; }
	const owner = all_labels.get(explicit);
	return owner === undefined ? { status: "ok", label: explicit } : { status: "taken", owner };
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	test("choose_label", () => {
		const labels = new Map<string, string>([["ad7124_8", "/spi0/adc@0"]]);
		expect(choose_label(undefined, "adi,ad7124-8", labels)).toEqual({ status: "ok", label: "ad7124_8_1" });
		expect(choose_label("imu1", "adi,ad7124-8", labels)).toEqual({ status: "ok", label: "imu1" });
		expect(choose_label("1bad", "adi,ad7124-8", labels)).toEqual({ status: "invalid" });
		expect(choose_label("ad7124_8", "x", labels)).toEqual({ status: "taken", owner: "/spi0/adc@0" });
	});

	test("is_valid_label", () => {
		expect(is_valid_label("spi0")).toBe(true);
		expect(is_valid_label("_ok")).toBe(true);
		expect(is_valid_label("ad7124_8")).toBe(true);
		expect(is_valid_label("1bad")).toBe(false);
		expect(is_valid_label("")).toBe(false);
		expect(is_valid_label("has-dash")).toBe(false);
		expect(is_valid_label("has.dot")).toBe(false);
	});

	test("is_valid_node_name", () => {
		expect(is_valid_node_name("adi,ad7124-8")).toBe(true);
		expect(is_valid_node_name("_x.y")).toBe(true);
		expect(is_valid_node_name("1wire")).toBe(true);
		expect(is_valid_node_name("")).toBe(false);
		expect(is_valid_node_name("bad name")).toBe(false);
		expect(is_valid_node_name("foo/bar")).toBe(false);
		expect(is_valid_node_name("#x")).toBe(false);
		expect(is_valid_node_name("a+b")).toBe(false);
		expect(is_valid_node_name("-x")).toBe(false);
		expect(is_valid_node_name("12")).toBe(false);
		expect(is_valid_node_name("1,a")).toBe(false);
		expect(is_valid_node_name("0x1fg")).toBe(false);
	});

	test("is_valid_unit_address", () => {
		expect(is_valid_unit_address("2")).toBe(true);
		expect(is_valid_unit_address("1,0")).toBe(true);
		expect(is_valid_unit_address("")).toBe(false);
		expect(is_valid_unit_address("1@2")).toBe(false);
		expect(is_valid_unit_address("a b")).toBe(false);
	});

	test("label_from_compatible derivation table", () => {
		expect(label_from_compatible("adi,ad7124-8")).toBe("ad7124_8");
		expect(label_from_compatible("spidev")).toBe("spidev");
		expect(label_from_compatible("ti,74hc595")).toBe("ti_74hc595");
		expect(label_from_compatible("vnd,a.b+c")).toBe("a_b_c");
		expect(label_from_compatible("9x")).toBe("_9x");
	});

	test("unique_label", () => {
		const labels = new Map<string, string>([["ad7124_8", "/spi0/adc@0"]]);
		expect(unique_label("ad7124_8", labels)).toBe("ad7124_8_1");
		labels.set("ad7124_8_1", "/spi0/adc@1");
		expect(unique_label("ad7124_8", labels)).toBe("ad7124_8_2");
		expect(unique_label("spidev", labels)).toBe("spidev");
	});

	test("unique_node_name", () => {
		const keys = new Set(["regulator-fixed", "regulator-fixed-1", "adc@0"]);
		expect(unique_node_name("regulator-fixed", keys)).toBe("regulator-fixed-2");
		expect(unique_node_name("adc", keys)).toBe("adc");
	});

	test("rename_references — references in properties and children follow, & stays where it was", async () => {
		const { DeviceTree } = await import("../DeviceTree.js");
		const tree = DeviceTree.new_from_string(`/dts-v1/;
/ {
    dev {
        pinctrl-0 = <&pins>;
        clocks = <&pins 1 &clk>, <&other 2>;
        path = &pins;
        flag;
        child {
            gpios = <&pins 3>;
        };
    };
};`);
		if (typeof tree === "string") { throw new TypeError(tree); }
		const node = tree.node_at("/dev");
		if (node === undefined) { throw new TypeError("no /dev"); }
		rename_references(node, new Map([["pins", "pins_1"], ["clk", "clk_2"]]));
		const printed = tree.print();
		expect(printed).toContain("pinctrl-0 = <&pins_1>;");
		expect(printed).toContain("clocks = <&pins_1 1 &clk_2>, <&other 2>;");
		expect(printed).toContain("path = &pins_1;");
		expect(printed).toContain("gpios = <&pins_1 3>;");
		expect(printed).not.toMatch(/&pins[^_]/);
	});
}
