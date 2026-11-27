// Run by the CLI's vitest (packages/cli/vitest.config.ts takes the GUI's *.test.mjs): the GUI has
// no test runner of its own.
import { describe, expect, test } from "vitest";
import { changed_lines, node_lines } from "./source-nodes.mjs";

const LABELS = { spi0: "/soc/spi@7e204000", spidev0: "/soc/spi@7e204000/spidev@0", adc: "/soc/spi@7e204000/adc@1" };
const resolve = label => LABELS[label];

describe("node_lines", () => {
	test("a reference's block, and the nodes in it", () => {
		const text = [
			"/dts-v1/;",
			"/plugin/;",
			"",
			"&spidev0 {",
			"\tstatus = \"disabled\";",
			"};",
			"",
			"&spi0 {",
			"\tstatus = \"okay\";",
			"\tadc: adc@1 {",
			"\t\tcompatible = \"adi,ad7124-8\";",
			"\t\tchannel@0 {",
			"\t\t\treg = <0>;",
			"\t\t};",
			"\t};",
			"};",
		].join("\n");
		expect(node_lines(text, "/soc/spi@7e204000/spidev@0", resolve)).toEqual({ start: 3, end: 5 });
		expect(node_lines(text, "/soc/spi@7e204000", resolve)).toEqual({ start: 7, end: 15 });
		expect(node_lines(text, "/soc/spi@7e204000/adc@1", resolve)).toEqual({ start: 9, end: 14 });
		expect(node_lines(text, "/soc/spi@7e204000/adc@1/channel@0", resolve)).toEqual({ start: 11, end: 13 });
		expect(node_lines(text, "/soc/i2c@7e804000", resolve)).toBeUndefined();
	});

	test("a fragment's __overlay__ is its target's: by label or by path", () => {
		const text = [
			"/dts-v1/;",
			"/plugin/;",
			"/ {",
			"\tfragment@0 {",
			"\t\ttarget = <&spi0>;",
			"\t\t__overlay__ {",
			"\t\t\tx: a@0 { reg = <0>; };",
			"\t\t};",
			"\t};",
			"\tfragment@1 {",
			"\t\ttarget-path = \"/soc/i2c@7e804000\";",
			"\t\t__overlay__ {",
			"\t\t\ttemp@48 {",
			"\t\t\t\treg = <0x48>;",
			"\t\t\t};",
			"\t\t};",
			"\t};",
			"};",
		].join("\n");
		expect(node_lines(text, "/soc/spi@7e204000", resolve)).toEqual({ start: 5, end: 7 });
		expect(node_lines(text, "/soc/spi@7e204000/a@0", resolve)).toEqual({ start: 6, end: 6 });
		expect(node_lines(text, "/soc/i2c@7e804000/temp@48", resolve)).toEqual({ start: 12, end: 14 });
	});

	test("a reference by path, and the full .dts's root", () => {
		const text = "&{/soc/spi@7e204000} {\n\tstatus = \"okay\";\n};\n/ {\n\tsoc {\n\t\tspi@7e204000 {\n\t\t};\n\t};\n};";
		expect(node_lines(text, "/soc/spi@7e204000", resolve)).toEqual({ start: 0, end: 2 });
		expect(node_lines(text, "/soc", resolve)).toEqual({ start: 4, end: 7 });
	});

	test("braces in comments and strings, and a label not known, are no nodes", () => {
		const text = [
			"// spi0 { };",
			"/* a block",
			"   gpio { */",
			"&nowhere {",
			"\tinner@0 { label = \"a { b\"; };",
			"};",
			"&spi0 { /* } */",
			"\tlabel = \"}\";",
			"};",
		].join("\n");
		expect(node_lines(text, "/soc/spi@7e204000", resolve)).toEqual({ start: 6, end: 8 });
		expect(node_lines(text, "inner@0", resolve)).toBeUndefined();
	});
});

describe("changed_lines", () => {
	const before = "&spi0 {\n\tadc@1 {\n\t\treg = <1>;\n\t};\n};";
	test("a property set, added, or a node added: its lines", () => {
		expect(changed_lines(before, "&spi0 {\n\tadc@1 {\n\t\treg = <2>;\n\t};\n};")).toEqual([2]);
		expect(changed_lines(before, "&spi0 {\n\tadc@1 {\n\t\treg = <1>;\n\t\tspi-max-frequency = <1000000>;\n\t};\n};")).toEqual([3]);
		expect(changed_lines(before, "&spi0 {\n\tadc@1 {\n\t\treg = <1>;\n\t\tchannel@0 {\n\t\t\treg = <0>;\n\t\t};\n\t};\n};")).toEqual([3, 4, 5]);
	});

	test("nothing changed, or only lines taken away: none", () => {
		expect(changed_lines(before, before)).toEqual([]);
		expect(changed_lines(before, "&spi0 {\n\tadc@1 {\n\t};\n};")).toEqual([]);
	});
});
