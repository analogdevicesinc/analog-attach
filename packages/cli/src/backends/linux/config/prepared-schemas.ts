import { createHash } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepared_from_json, prepared_to_json, type PreparedSchemas } from "linux-lib";

import { validation_cache_path, validation_schema_path } from "./cache";

// Before its first binding, a process builds what every binding is parsed with: the property types and the
// definitions of the `select: true` schemas, dereferenced and fixed up (linux-lib's `PreparedSchemas`). That is
// most of the first parse (about 180 of 280 ms), and the same in every command. The first command that parses a
// binding saves them in `validation-cache/` (COM-139), and the next ones read them (about 1 ms).

const PREFIX = "prepared-schemas-";

/** What the prepared schemas are built from. */
export type PreparedSource = { linux: string; dt_schema: string; dt_schema_version: string; state_dir: string };

/**
 * The prepared schemas' file for this source: a name that changes with `validation.json` (its size and modification
 * time, as the binding subset's), the dt-schema it was built with, and this program, whose fixups made them (its
 * file's size and modification time: a build writes every file again).
 */
function prepared_file(source: PreparedSource, program_file = fileURLToPath(import.meta.url)): string {
	const validation = fs.statSync(validation_schema_path(source.state_dir));
	const program = fs.statSync(program_file);
	const key = JSON.stringify({
		linux: source.linux, dt_schema: source.dt_schema, dt_schema_version: source.dt_schema_version,
		validation: [validation.size, validation.mtimeMs], program: [program.size, program.mtimeMs],
	});
	return path.join(validation_cache_path(source.state_dir), `${PREFIX}${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);
}

/** Writes `prepared` to `file` (a temporary file, then a rename) and removes the prepared schemas of another key. */
function save(file: string, prepared: PreparedSchemas): void {
	const temporary = `${file}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(temporary, prepared_to_json(prepared));
		fs.renameSync(temporary, file);
	} finally {
		fs.rmSync(temporary, { force: true });
	}
	for (const name of fs.readdirSync(path.dirname(file))) {
		if (name.startsWith(PREFIX) && name.endsWith(".json") && name !== path.basename(file)) { fs.rmSync(path.join(path.dirname(file), name), { force: true }); }
	}
}

/**
 * What the binding parser gets for the prepared schemas (linux-lib's `SchemaPaths`): the saved ones, else an
 * `on_prepared` that saves the ones the first parse builds, once. Nothing when there's no `validation.json` to key them
 * by; a file that can't be read or written is as none, and the parser builds them.
 */
/** The prepared schemas this process has read, by file: one is read again only when its size or mtime changed. */
const read_prepared = new Map<string, { stamp: string; prepared: PreparedSchemas }>();

export function prepared_schemas(source: PreparedSource): { prepared?: PreparedSchemas; on_prepared?: (prepared: PreparedSchemas) => void } {
	let file: string;
	try {
		file = prepared_file(source);
	} catch {
		return {};
	}

	try {
		const stat = fs.statSync(file);
		const stamp = `${String(stat.size)}:${String(stat.mtimeMs)}`;
		const read = read_prepared.get(file);
		if (read?.stamp === stamp) { return { prepared: read.prepared }; }
		const prepared = prepared_from_json(fs.readFileSync(file, "utf8"));
		if (prepared !== undefined) {
			read_prepared.set(file, { stamp, prepared });
			return { prepared };
		}
	} catch {
		// not saved yet
	}

	let saved = false;
	return {
		on_prepared(prepared) {
			if (saved) { return; }
			saved = true;
			try {
				save(file, prepared);
			} catch {
				// the next command builds them again
			}
		},
	};
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const os = await import("node:os");

	const prepared: PreparedSchemas = {
		property_types: { names: new Map([["reg", "address"]]), patterns: [{ pattern: /-gpios$/, type: "phandle-array" }] },
		selected: { properties: new Map([["status", [{ enum: ["okay", "disabled"] }]]]), patterns: new Map() },
	};

	test("prepared_schemas - saved by the first parse, once, then read; a new validation.json replaces them; none without one", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-prepared-schemas-"));
		const source: PreparedSource = { linux: "/linux", dt_schema: "/dt-schema", dt_schema_version: "2026.9", state_dir: directory };
		const saved = () => fs.readdirSync(validation_cache_path(directory)).filter(name => name.startsWith(PREFIX));
		try {
			expect(prepared_schemas(source)).toEqual({});
			fs.mkdirSync(validation_cache_path(directory), { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), "{}");

			const first = prepared_schemas(source);
			expect(first.prepared).toBeUndefined();
			first.on_prepared?.(prepared);
			const [file] = saved();
			expect(file).toBeDefined();
			fs.rmSync(path.join(validation_cache_path(directory), file!));
			first.on_prepared?.(prepared);
			expect(saved()).toEqual([]);

			prepared_schemas(source).on_prepared?.(prepared);
			expect(prepared_schemas(source)).toStrictEqual({ prepared });

			fs.utimesSync(validation_schema_path(directory), new Date(), new Date(Date.now() + 5000));
			const next = prepared_schemas(source);
			expect(next.prepared).toBeUndefined();
			next.on_prepared?.(prepared);
			expect(saved()).toHaveLength(1);
			expect(saved()).not.toEqual([file]);
			expect(prepared_schemas({ ...source, dt_schema_version: "2026.10" }).prepared).toBeUndefined();
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("prepared_schemas - a file that isn't prepared schemas is as none, and the parse saves them over it", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-prepared-schemas-"));
		const source: PreparedSource = { linux: "/linux", dt_schema: "/dt-schema", dt_schema_version: "2026.9", state_dir: directory };
		try {
			fs.mkdirSync(validation_cache_path(directory), { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), "{}");
			prepared_schemas(source).on_prepared?.(prepared);
			const file = fs.readdirSync(validation_cache_path(directory)).find(name => name.startsWith(PREFIX));
			fs.writeFileSync(path.join(validation_cache_path(directory), file!), "{\"format\": 0}");

			const broken = prepared_schemas(source);
			expect(broken.prepared).toBeUndefined();
			broken.on_prepared?.(prepared);
			expect(prepared_schemas(source)).toStrictEqual({ prepared });
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("prepared_schemas - not read for another Linux tree, dt-schema root or version, nor a validation.json of another size", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-prepared-schemas-"));
		const source: PreparedSource = { linux: "/linux", dt_schema: "/dt-schema", dt_schema_version: "2026.9", state_dir: directory };
		try {
			fs.mkdirSync(validation_cache_path(directory), { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), "{}");
			// Whole seconds, which the file keeps exactly when set again
			fs.utimesSync(validation_schema_path(directory), 1_700_000_000, 1_700_000_000);
			prepared_schemas(source).on_prepared?.(prepared);
			expect(prepared_schemas(source)).toStrictEqual({ prepared });

			for (const other of [{ linux: "/linux-next" }, { dt_schema: "/other/dt-schema" }, { dt_schema_version: "2026.10" }]) {
				const given = prepared_schemas({ ...source, ...other });
				expect(given.prepared, JSON.stringify(other)).toBeUndefined();
				expect(given.on_prepared, JSON.stringify(other)).toBeTypeOf("function");
			}

			// The same modification time, another size
			fs.writeFileSync(validation_schema_path(directory), "{ }");
			fs.utimesSync(validation_schema_path(directory), 1_700_000_000, 1_700_000_000);
			expect(prepared_schemas(source).prepared).toBeUndefined();
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("prepared_file - another for a program file of another modification time or size", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-prepared-schemas-"));
		const source: PreparedSource = { linux: "/linux", dt_schema: "/dt-schema", dt_schema_version: "2026.9", state_dir: directory };
		const program = path.join(directory, "linux-ABCDEF.js");
		try {
			fs.mkdirSync(validation_cache_path(directory), { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), "{}");
			fs.writeFileSync(program, "export {};");
			fs.utimesSync(program, 1_700_000_000, 1_700_000_000);
			const file = prepared_file(source, program);
			expect(prepared_file(source, program)).toBe(file);

			// A build of the same size, as a change of the fixups' code can be
			fs.writeFileSync(program, "export {};");
			const rebuilt = prepared_file(source, program);
			expect(rebuilt).not.toBe(file);

			// Another size, the first one's modification time
			fs.writeFileSync(program, "export { };");
			fs.utimesSync(program, 1_700_000_000, 1_700_000_000);
			expect(prepared_file(source, program)).not.toBe(file);
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test("prepared_schemas - saving removes the prepared schemas of another key, and nothing else of validation-cache", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-prepared-schemas-"));
		const source: PreparedSource = { linux: "/linux", dt_schema: "/dt-schema", dt_schema_version: "2026.9", state_dir: directory };
		const cache = validation_cache_path(directory);
		try {
			fs.mkdirSync(path.join(cache, "validation-subsets"), { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), "{}");
			fs.writeFileSync(path.join(cache, "validation.stamp.json"), "{}");
			fs.writeFileSync(path.join(cache, "binding-subset-0123.json"), "{}");
			fs.writeFileSync(path.join(cache, `${PREFIX}0123.json`), "{}");
			// Another command's, before its rename
			fs.writeFileSync(path.join(cache, `${PREFIX}4567.json.999.tmp`), "{}");

			prepared_schemas(source).on_prepared?.(prepared);
			expect(fs.readdirSync(cache).sort()).toEqual([
				"binding-subset-0123.json", path.basename(prepared_file(source)), `${PREFIX}4567.json.999.tmp`,
				"validation-subsets", "validation.json", "validation.stamp.json",
			].sort());
		} finally {
			fs.rmSync(directory, { recursive: true });
		}
	});

	test.skipIf(os.userInfo().uid === 0)("prepared_schemas - a validation-cache that can't be written: nothing saved, nothing thrown, the next command builds them", () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-prepared-schemas-"));
		const source: PreparedSource = { linux: "/linux", dt_schema: "/dt-schema", dt_schema_version: "2026.9", state_dir: directory };
		const cache = validation_cache_path(directory);
		try {
			fs.mkdirSync(cache, { recursive: true });
			fs.writeFileSync(validation_schema_path(directory), "{}");
			fs.chmodSync(cache, 0o555);

			expect(() => prepared_schemas(source).on_prepared?.(prepared)).not.toThrow();
			expect(fs.readdirSync(cache)).toEqual(["validation.json"]);
			expect(prepared_schemas(source).prepared).toBeUndefined();
		} finally {
			fs.chmodSync(cache, 0o755);
			fs.rmSync(directory, { recursive: true });
		}
	});
}
