import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

import { validation_subsets_path } from "../../config/cache";

// dt-validate spends most of a run on loading validation.json (every binding of the tree) and
// setting it up, not on the few nodes of a validation tree. It only needs part of it: the
// schemas it applies to every node, the ones a node's compatible selects, and what those refer
// to. That part is written once per set of compatibles (VALIDATE-014) and kept, so a run gets
// the same diagnostics from a schema a tenth of the size.

type Schemas = Record<string, unknown>;

const is_record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** How many subsets are kept; the least recently used go first. */
const KEPT = 16;

/** Bumped when what a subset holds changes, so the subsets of an older CLI aren't read. */
const SUBSET_VERSION = 1;

/**
 * Each value under `key` anywhere in `value`, not looking inside the ones it finds: dt-schema's
 * `item_generator` (lib.py).
 */
function* values_of(value: unknown, key: string): Generator<unknown> {
	if (Array.isArray(value)) {
		for (const item of value) { yield* values_of(item, key); }
	} else if (is_record(value)) {
		for (const [name, child] of Object.entries(value)) {
			if (name === key) { yield child; } else { yield* values_of(child, key); }
		}
	}
}

/**
 * The strings a schema's `compatible` matches a node by, as dt-schema's
 * `extract_node_compatibles` (lib.py) reads them: its enums of strings, its
 * consts and its patterns, each taken as a literal string. dt-validate leaves
 * out `syscon`, `simple-mfd` and `simple-bus` when there are others; they are
 * kept here, so a schema is kept whenever dt-validate could pick it.
 */
export function schema_compatibles(compatible: unknown): Set<string> {
	const found = new Set<string>();
	for (const list of values_of(compatible, "enum")) {
		if (Array.isArray(list) && typeof list[0] === "string") {
			for (const item of list) { found.add(String(item)); }
		}
	}
	for (const value of values_of(compatible, "const")) { found.add(String(value)); }
	for (const value of values_of(compatible, "pattern")) { found.add(String(value)); }
	return found;
}

/** The schemas `schema` (the one at `id`) refers to with a `$ref`, by the key they have in validation.json. */
function* referenced(id: string, schema: unknown): Generator<string> {
	for (const reference of values_of(schema, "$ref")) {
		if (typeof reference !== "string") { continue; }
		const url = new URL(reference, id);
		url.hash = "";
		yield url.href;
	}
}

/**
 * The part of a processed schema (validation.json) that dt-validate reads for
 * nodes whose compatibles are all in `compatibles`:
 * - what isn't a schema (`version`) and the `generated-*` entries;
 * - the schemas it applies to every node (a `select` that isn't false),
 *   among them those dt-mk-schema's `add_select_schema` (lib.py) gave a
 *   `select` on `$nodename` (spi-controller.yaml, i2c-controller.yaml), which
 *   dt-validate tries on every node by its name;
 * - those it picks for a node by compatible (no `select`, a `compatible`
 *   property) that list one of `compatibles`;
 * - what all of these refer to, with `$ref`s resolved against their `$id`,
 *   which is their key.
 * Entries keep their order, so a compatible two schemas list goes to the same
 * one as in dt-validate's map. Throws on a `$ref` that isn't a URL relative to
 * its schema's `$id`.
 */
export function schema_subset(schemas: Schemas, compatibles: ReadonlySet<string>): Schemas {
	const kept = new Set<string>();
	const pending: string[] = [];
	const keep = (id: string): void => {
		if (!kept.has(id) && id in schemas) { kept.add(id); pending.push(id); }
	};

	for (const [id, schema] of Object.entries(schemas)) {
		if (!is_record(schema) || id.startsWith("generated-")) { keep(id); continue; }
		if ("select" in schema) {
			if (schema["select"] !== false) { keep(id); }
			continue;
		}
		const properties = schema["properties"];
		if (!is_record(properties) || !("compatible" in properties)) { continue; }
		for (const compatible of schema_compatibles(properties["compatible"])) {
			if (compatibles.has(compatible)) { keep(id); break; }
		}
	}

	for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
		if (!is_record(schemas[id])) { continue; }
		for (const target of referenced(id, schemas[id])) { keep(target); }
	}

	return Object.fromEntries(Object.entries(schemas).filter(([id]) => kept.has(id)));
}

const FDT_MAGIC = 0xD0_0D_FE_ED;
const FDT_BEGIN_NODE = 1;
const FDT_END_NODE = 2;
const FDT_PROP = 3;
const FDT_NOP = 4;
const FDT_END = 9;

/** `offset` rounded up to the next 4-byte boundary, where the structure block's tokens start. */
const align = (offset: number): number => (offset + 3) & ~3;

/**
 * Every string of every `compatible` property of a flattened devicetree, as
 * dt-validate decodes them; undefined when it isn't one dtc wrote.
 */
export function dtb_compatibles(dtb: Buffer): Set<string> | undefined {
	if (dtb.length < 40 || dtb.readUInt32BE(0) !== FDT_MAGIC) { return undefined; }
	const structure = dtb.readUInt32BE(8);
	const strings = dtb.readUInt32BE(12);
	const name_at = (offset: number): string => {
		const end = dtb.indexOf(0, strings + offset);
		return dtb.toString("latin1", strings + offset, end === -1 ? undefined : end);
	};

	const found = new Set<string>();
	let offset = structure;
	while (offset + 4 <= dtb.length) {
		const token = dtb.readUInt32BE(offset);
		offset += 4;
		switch (token) {
			case FDT_BEGIN_NODE: {
				const end = dtb.indexOf(0, offset);
				if (end === -1) { return undefined; }
				offset = align(end + 1);
				break;
			}
			case FDT_PROP: {
				if (offset + 8 > dtb.length) { return undefined; }
				const length = dtb.readUInt32BE(offset);
				const name = name_at(dtb.readUInt32BE(offset + 4));
				const value = offset + 8;
				if (value + length > dtb.length) { return undefined; }
				if (name === "compatible") {
					for (const item of dtb.toString("utf8", value, value + length).split("\0")) {
						if (item !== "") { found.add(item); }
					}
				}
				offset = align(value + length);
				break;
			}
			case FDT_END_NODE:
			case FDT_NOP: {
				break;
			}
			case FDT_END: {
				return found;
			}
			default: {
				return undefined;
			}
		}
	}
	return undefined;
}

/** The subset's file for these compatibles of this validation.json: a name that changes with either. */
function subset_file(state_directory: string, schema: fs.Stats, compatibles: ReadonlySet<string>): string {
	const key = JSON.stringify({ version: SUBSET_VERSION, size: schema.size, modified: schema.mtimeMs, compatibles: [...compatibles].sort() });
	return path.join(validation_subsets_path(state_directory), `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
}

/** Keep the KEPT subsets used last (a used one is touched). */
function prune(directory: string): void {
	const files = fs.readdirSync(directory)
		.filter(name => name.endsWith(".json"))
		.map(name => ({ file: path.join(directory, name), used: fs.statSync(path.join(directory, name)).mtimeMs }))
		.sort((a, b) => b.used - a.used);
	for (const { file } of files.slice(KEPT)) { fs.rmSync(file, { force: true }); }
}

/**
 * The schema file to give dt-validate for `dtb`: the subset of `schema`
 * (validation.json) for its compatibles, from the state directory or written
 * there now. Undefined when there is none to give (the dtb or the schema can't
 * be read, or the subset can't be written): dt-validate then gets the whole
 * schema.
 */
export function validation_subset(state_directory: string, schema: string, dtb: string): string | undefined {
	try {
		const compatibles = dtb_compatibles(fs.readFileSync(dtb));
		if (compatibles === undefined) { return undefined; }
		const file = subset_file(state_directory, fs.statSync(schema), compatibles);
		if (fs.existsSync(file)) {
			const now = new Date();
			fs.utimesSync(file, now, now);
			return file;
		}
		const schemas: unknown = JSON.parse(fs.readFileSync(schema, "utf8"));
		if (!is_record(schemas)) { return undefined; }
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify(schema_subset(schemas, compatibles)));
			fs.renameSync(temporary, file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		prune(path.dirname(file));
		return file;
	} catch {
		return undefined;
	}
}

if (import.meta.vitest) {
	const { test, expect, describe } = import.meta.vitest;
	const os = await import("node:os");
	const { execFileSync } = await import("node:child_process");
	const { is_tool_available } = await import("../../utilities");

	const SCHEMAS = "http://devicetree.org/schemas/";
	const schemas: Schemas = {
		"generated-compatibles": { $id: "generated-compatibles", select: true, properties: {} },
		"generated-types": { $id: "generated-types", select: false, properties: {} },
		[`${SCHEMAS}dt-core.yaml`]: { $id: `${SCHEMAS}dt-core.yaml`, select: true, properties: { status: { $ref: "/schemas/types.yaml#/definitions/string" } } },
		[`${SCHEMAS}types.yaml`]: { $id: `${SCHEMAS}types.yaml`, select: false, definitions: {} },
		[`${SCHEMAS}iio/adc/adi,ad7124.yaml`]: {
			$id: `${SCHEMAS}iio/adc/adi,ad7124.yaml`,
			properties: { compatible: { enum: ["adi,ad7124-4", "adi,ad7124-8"] } },
			allOf: [{ $ref: "adc.yaml#" }, { $ref: "/schemas/spi/spi-peripheral-props.yaml#" }],
		},
		[`${SCHEMAS}iio/adc/adc.yaml`]: { $id: `${SCHEMAS}iio/adc/adc.yaml`, properties: {} },
		[`${SCHEMAS}spi/spi-peripheral-props.yaml`]: { $id: `${SCHEMAS}spi/spi-peripheral-props.yaml`, select: false, properties: {} },
		[`${SCHEMAS}iio/dac/adi,ad5686.yaml`]: { $id: `${SCHEMAS}iio/dac/adi,ad5686.yaml`, properties: { compatible: { items: [{ const: "adi,ad5686" }] } } },
		[`${SCHEMAS}soc/vendor,soc.yaml`]: { $id: `${SCHEMAS}soc/vendor,soc.yaml`, properties: { compatible: { items: [{ pattern: "^vendor,soc[0-9]+$" }] } } },
		version: "2026.9",
	};

	describe("schema_subset", () => {
		test("keeps what dt-validate applies to every node, the schema of a compatible and what they refer to", () => {
			expect(Object.keys(schema_subset(schemas, new Set(["adi,ad7124-8"])))).toEqual([
				"generated-compatibles",
				"generated-types",
				`${SCHEMAS}dt-core.yaml`,
				`${SCHEMAS}types.yaml`,
				`${SCHEMAS}iio/adc/adi,ad7124.yaml`,
				`${SCHEMAS}iio/adc/adc.yaml`,
				`${SCHEMAS}spi/spi-peripheral-props.yaml`,
				"version",
			]);
		});

		test("no compatible keeps no schema picked by compatible, nor what only those refer to", () => {
			const kept = Object.keys(schema_subset(schemas, new Set()));
			expect(kept).not.toContain(`${SCHEMAS}iio/adc/adi,ad7124.yaml`);
			expect(kept).not.toContain(`${SCHEMAS}iio/adc/adc.yaml`);
			expect(kept).toContain(`${SCHEMAS}types.yaml`);
		});

		test("keeps a schema dt-validate selects by node name, with no compatible", () => {
			const bus = `${SCHEMAS}spi/spi-controller.yaml`;
			const by_name: Schemas = {
				...schemas,
				[bus]: {
					$id: bus,
					select: { properties: { $nodename: { items: [{ pattern: "^spi(@.*|-([0-9]|[1-9][0-9]+))?$" }] } }, required: ["$nodename"] },
					properties: {},
				},
			};
			expect(Object.keys(schema_subset(by_name, new Set()))).toContain(bus);
		});

		test("a pattern counts as the literal string, as in dt-validate's map", () => {
			expect(Object.keys(schema_subset(schemas, new Set(["vendor,soc1"])))).not.toContain(`${SCHEMAS}soc/vendor,soc.yaml`);
			expect(Object.keys(schema_subset(schemas, new Set(["^vendor,soc[0-9]+$"])))).toContain(`${SCHEMAS}soc/vendor,soc.yaml`);
		});
	});

	test("schema_compatibles - enums of strings, consts and patterns, at any depth", () => {
		expect(schema_compatibles({ oneOf: [{ items: [{ enum: ["a,x", "a,y"] }, { const: "a,base" }] }, { contains: { pattern: "^b,.*$" } }, { enum: [1, 2] }] }))
			.toEqual(new Set(["a,x", "a,y", "a,base", "^b,.*$"]));
	});

	const compile = (source: string): Buffer => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-subset-"));
		try {
			fs.writeFileSync(path.join(directory, "t.dts"), source);
			execFileSync("dtc", ["-I", "dts", "-O", "dtb", "-o", path.join(directory, "t.dtb"), path.join(directory, "t.dts")], { stdio: "pipe" });
			return fs.readFileSync(path.join(directory, "t.dtb"));
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	};

	describe.skipIf(!is_tool_available("dtc --version"))("with dtc", () => {
		test("dtb_compatibles - every string of every compatible, other properties left out", () => {
			const dtb = compile(`/dts-v1/;\n/plugin/;\n/ {\n\tcompatible = "goo";\n\tmodel = "a,not-this";\n\tnode0 {\n\t\tadc@0 { compatible = "adi,ad7124-8", "adi,ad7124-4"; reg = <0>; };\n\t\tstub { #gpio-cells = <2>; };\n\t};\n};\n`);
			expect(dtb_compatibles(dtb)).toEqual(new Set(["goo", "adi,ad7124-8", "adi,ad7124-4"]));
		});

		test("dtb_compatibles - not a dtb", () => {
			expect(dtb_compatibles(Buffer.from("/dts-v1/; / { };"))).toBeUndefined();
		});

		test("validation_subset - written once per set of compatibles, then reused; a new validation.json makes a new one", () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-subset-"));
			try {
				const schema = path.join(directory, "validation.json");
				fs.writeFileSync(schema, JSON.stringify(schemas));
				const dtb = path.join(directory, "temp.dtb");
				fs.writeFileSync(dtb, compile(`/dts-v1/;\n/ { compatible = "goo"; adc@0 { compatible = "adi,ad7124-8"; }; };\n`));

				const first = validation_subset(directory, schema, dtb);
				expect(first).toBeDefined();
				expect(Object.keys(JSON.parse(fs.readFileSync(first!, "utf8")) as Schemas)).toContain(`${SCHEMAS}iio/adc/adi,ad7124.yaml`);
				expect(validation_subset(directory, schema, dtb)).toBe(first);

				fs.writeFileSync(schema, JSON.stringify({ ...schemas, extra: { $id: "extra", select: true } }));
				const second = validation_subset(directory, schema, dtb);
				expect(second).not.toBe(first);
				expect(Object.keys(JSON.parse(fs.readFileSync(second!, "utf8")) as Schemas)).toContain("extra");
			} finally {
				fs.rmSync(directory, { recursive: true });
			}
		});

		test("validation_subset - none for a dtb or a schema it can't read", () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-subset-"));
			try {
				const dtb = path.join(directory, "temp.dtb");
				fs.writeFileSync(dtb, compile(`/dts-v1/;\n/ { compatible = "goo"; };\n`));
				fs.writeFileSync(path.join(directory, "validation.json"), "not json");
				expect(validation_subset(directory, path.join(directory, "validation.json"), dtb)).toBeUndefined();
				expect(validation_subset(directory, path.join(directory, "missing.json"), dtb)).toBeUndefined();
				fs.writeFileSync(path.join(directory, "bad.dtb"), "nope");
				fs.writeFileSync(path.join(directory, "validation.json"), JSON.stringify(schemas));
				expect(validation_subset(directory, path.join(directory, "validation.json"), path.join(directory, "bad.dtb"))).toBeUndefined();
				expect(fs.existsSync(validation_subsets_path(directory))).toBe(false);
			} finally {
				fs.rmSync(directory, { recursive: true });
			}
		});

		test("validation_subset - keeps the subsets used last", () => {
			const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-subset-"));
			try {
				const schema = path.join(directory, "validation.json");
				fs.writeFileSync(schema, JSON.stringify(schemas));
				const dtb = path.join(directory, "temp.dtb");
				for (let index = 0; index < KEPT + 3; index++) {
					fs.writeFileSync(dtb, compile(`/dts-v1/;\n/ { compatible = "goo${index}"; };\n`));
					expect(validation_subset(directory, schema, dtb)).toBeDefined();
				}
				expect(fs.readdirSync(validation_subsets_path(directory))).toHaveLength(KEPT);
			} finally {
				fs.rmSync(directory, { recursive: true });
			}
		});
	});
}
