import * as fs from "node:fs";

/** A name's types in a processed schema's `generated-types` / `generated-pattern-types`, one entry per schema that types it. */
export type GeneratedTypes = Record<string, { type?: string | null }[]>;

/**
 * What the bindings take from a processed schema (the output of `dt-mk-schema -j`, or a part of it that keeps these):
 * the property types it generated, by name and by pattern, and the `$id`s of the schemas dt-validate applies to every
 * node (`select: true`), in the file's order.
 */
export type ProcessedSchema = {
	types: GeneratedTypes;
	pattern_types: GeneratedTypes;
	selected: string[];
};

const loaded = new Map<string, { modified: number; processed: ProcessedSchema }>();

const is_record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const generated = (entry: unknown): GeneratedTypes => {
	const properties = is_record(entry) ? entry["properties"] : undefined;
	return is_record(properties) ? properties as GeneratedTypes : {};
};

/** The processed schema in `file`; undefined when it can't be read. Read once per file and modification time. */
export function read_processed_schema(file: string): ProcessedSchema | undefined {
	let modified: number;
	try {
		modified = fs.statSync(file).mtimeMs;
	} catch {
		return undefined;
	}

	const cached = loaded.get(file);
	if (cached?.modified === modified) { return cached.processed; }

	let schemas: unknown;
	try {
		schemas = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	if (!is_record(schemas)) { return undefined; }

	const processed: ProcessedSchema = {
		types: generated(schemas["generated-types"]),
		pattern_types: generated(schemas["generated-pattern-types"]),
		// `generated-compatibles` is `select: true` too, and no schema
		selected: Object.entries(schemas).filter(([id, schema]) => !id.startsWith("generated-") && is_record(schema) && schema["select"] === true).map(([id]) => id),
	};
	loaded.set(file, { modified, processed });
	return processed;
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const { tmpdir } = await import("node:os");
	const { default: path } = await import("node:path");

	test("a processed schema's generated types and its select: true schemas, not generated-compatibles; nothing from a file that isn't one", () => {
		const directory = fs.mkdtempSync(path.join(tmpdir(), "attach-processed-"));
		const file = path.join(directory, "processed-schema.json");
		try {
			fs.writeFileSync(file, JSON.stringify({
				"generated-compatibles": { select: true, properties: {} },
				"generated-types": { select: false, properties: { "nvmem-cells": [{ type: "phandle-array" }] } },
				"generated-pattern-types": { select: false, properties: { "-gpios$": [{ type: "phandle-array" }] } },
				"http://devicetree.org/schemas/iio/iio.yaml": { select: true, properties: {} },
				"http://devicetree.org/schemas/types.yaml": { select: false },
				"http://devicetree.org/schemas/i2c/i2c-controller.yaml": { select: { properties: { $nodename: { pattern: "^i2c" } } } },
				"http://devicetree.org/schemas/iio/adc/adi,ad7124.yaml": { properties: { compatible: { enum: ["adi,ad7124-8"] } } },
				"http://devicetree.org/schemas/dt-core.yaml": { select: true, properties: {} },
				version: "2026.9",
			}));
			expect(read_processed_schema(file)).toStrictEqual({
				types: { "nvmem-cells": [{ type: "phandle-array" }] },
				pattern_types: { "-gpios$": [{ type: "phandle-array" }] },
				selected: ["http://devicetree.org/schemas/iio/iio.yaml", "http://devicetree.org/schemas/dt-core.yaml"],
			});
			expect(read_processed_schema(path.join(directory, "missing.json"))).toBeUndefined();
			fs.writeFileSync(path.join(directory, "bad.json"), "[1]");
			expect(read_processed_schema(path.join(directory, "bad.json"))).toBeUndefined();
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});
}
