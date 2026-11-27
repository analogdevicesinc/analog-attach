import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

import { validation_cache_path, validation_schema_path } from "./cache";

// Parsing a binding reads two things of validation.json: the property types it generated, and which
// schemas are `select: true` (dt-validate applies them to every node, so the binding gets their
// definitions). Read whole, that is 21 MB parsed per command for a Linux tree, and without it every
// binding of the tree is read to find the `select: true` ones. The binding subset is the part of
// validation.json with just those (COM-138), a quarter of a megabyte, written by the first command
// that needs it and read by the next ones, as validate's subsets are (VALIDATE-014).

/** Bumped when what the binding subset holds changes, so the subset of an older CLI isn't read. */
const SUBSET_VERSION = 1;

const PREFIX = "binding-subset-";

const is_record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The part of a processed schema (validation.json) parsing a binding reads, in its order: what isn't a schema
 * (`version`), `generated-types`, `generated-pattern-types`, and the schemas with `select: true`.
 */
export function binding_subset_of(schemas: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(schemas).filter(([id, schema]) => {
		if (!is_record(schema)) { return true; }
		if (id.startsWith("generated-")) { return id === "generated-types" || id === "generated-pattern-types"; }
		return schema["select"] === true;
	}));
}

/** The binding subset's file for this validation.json: a name that changes with it. */
function subset_file(state_directory: string, schema: fs.Stats): string {
	const key = JSON.stringify({ version: SUBSET_VERSION, size: schema.size, modified: schema.mtimeMs });
	return path.join(validation_cache_path(state_directory), `${PREFIX}${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
}

/**
 * The binding subset of the state directory's validation.json, from `validation-cache/` or written there now, the
 * subsets of another validation.json removed. Undefined when there is none to give (validation.json can't be read, or
 * the subset can't be written): the bindings then read validation.json.
 */
export function binding_subset(state_directory: string): string | undefined {
	try {
		const schema = validation_schema_path(state_directory);
		const file = subset_file(state_directory, fs.statSync(schema));
		if (fs.existsSync(file)) { return file; }

		const schemas: unknown = JSON.parse(fs.readFileSync(schema, "utf8"));
		if (!is_record(schemas)) { return undefined; }
		const temporary = `${file}.${process.pid}.tmp`;
		try {
			fs.writeFileSync(temporary, JSON.stringify(binding_subset_of(schemas)));
			fs.renameSync(temporary, file);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
		for (const name of fs.readdirSync(path.dirname(file))) {
			if (name.startsWith(PREFIX) && name.endsWith(".json") && name !== path.basename(file)) { fs.rmSync(path.join(path.dirname(file), name), { force: true }); }
		}
		return file;
	} catch {
		return undefined;
	}
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const os = await import("node:os");

	const SCHEMAS = "http://devicetree.org/schemas/";
	const schemas = {
		"generated-compatibles": { $id: "generated-compatibles", select: true, properties: {} },
		"generated-pattern-types": { $id: "generated-pattern-types", select: false, properties: { "-gpios$": [{ type: "phandle-array" }] } },
		"generated-types": { $id: "generated-types", select: false, properties: { "nvmem-cells": [{ type: "phandle-array" }] } },
		[`${SCHEMAS}dt-core.yaml`]: { $id: `${SCHEMAS}dt-core.yaml`, select: true, properties: {} },
		[`${SCHEMAS}types.yaml`]: { $id: `${SCHEMAS}types.yaml`, select: false, definitions: {} },
		[`${SCHEMAS}i2c/i2c-controller.yaml`]: { $id: `${SCHEMAS}i2c/i2c-controller.yaml`, select: { properties: { $nodename: { pattern: "^i2c" } } } },
		[`${SCHEMAS}iio/adc/adi,ad7124.yaml`]: { $id: `${SCHEMAS}iio/adc/adi,ad7124.yaml`, properties: { compatible: { enum: ["adi,ad7124-8"] } } },
		[`${SCHEMAS}iio/iio.yaml`]: { $id: `${SCHEMAS}iio/iio.yaml`, select: true, properties: {} },
		version: "2026.9",
	};

	test("binding_subset_of - the generated types, the select: true schemas and what isn't a schema, in order", () => {
		expect(Object.keys(binding_subset_of(schemas))).toEqual([
			"generated-pattern-types",
			"generated-types",
			`${SCHEMAS}dt-core.yaml`,
			`${SCHEMAS}iio/iio.yaml`,
			"version",
		]);
	});

	test("binding_subset - written once per validation.json, then reused; a new validation.json replaces it; none without one", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-binding-subset-"));
		try {
			expect(binding_subset(directory)).toBeUndefined();
			fs.mkdirSync(validation_cache_path(directory), { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), JSON.stringify(schemas));
			const file = binding_subset(directory);
			expect(file).toBeDefined();
			expect(JSON.parse(fs.readFileSync(file!, "utf8"))).toStrictEqual(binding_subset_of(schemas));
			expect(binding_subset(directory)).toBe(file);

			fs.writeFileSync(validation_schema_path(directory), JSON.stringify({ ...schemas, version: "2026.10" }));
			fs.utimesSync(validation_schema_path(directory), new Date(), new Date(Date.now() + 5000));
			const next = binding_subset(directory);
			expect(next).not.toBe(file);
			expect(fs.readdirSync(validation_cache_path(directory)).sort()).toEqual([path.basename(next!), "validation.json"].sort());

			fs.writeFileSync(validation_schema_path(directory), "not json");
			fs.utimesSync(validation_schema_path(directory), new Date(), new Date(Date.now() + 10_000));
			expect(binding_subset(directory)).toBeUndefined();
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});
}
