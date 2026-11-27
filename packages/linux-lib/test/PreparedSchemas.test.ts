import { prepare_schemas, prepared_from_json, prepared_to_json, type PreparedSchemas } from "linux-lib";
import { parse_binding } from "../src/Bindings/Pipeline.js";
import { Result } from "../src/result.js";

import { BINDINGS, schema_paths } from "./bindings";

import { describe, test, expect } from "vitest";

// What a caller saves of the property types and the `select: true` definitions, and gives back for the next process
describe("prepared schemas", async () => {
	const prepared = await prepare_schemas(schema_paths);
	const saved = prepared_from_json(prepared_to_json(prepared));

	test("read back as they were written", () => {
		expect(saved).toStrictEqual(prepared);
	});

	// The schema is what the branch narrowing compiles: the same schema narrows the same
	test.each(BINDINGS)("$name: the same schema and binding from the saved ones", async ({ path: file }) => {
		const built = await parse_binding(file, schema_paths);
		const given = await parse_binding(file, { ...schema_paths, prepared: saved! });
		if (Result.is_err(built) || Result.is_err(given)) { expect.fail("the binding should parse"); }

		expect(given.value.schema).toStrictEqual(built.value.schema);
		expect(given.value.binding).toStrictEqual(built.value.binding);
	});

	test("a parse without them gives the ones it built to on_prepared, one with them calls nothing", async () => {
		const [file] = BINDINGS.map(({ path }) => path);
		const reported: PreparedSchemas[] = [];
		const on_prepared = (schemas: PreparedSchemas) => { reported.push(schemas); };

		await parse_binding(file!, { ...schema_paths, on_prepared });
		expect(reported).toStrictEqual([prepared]);

		await parse_binding(file!, { ...schema_paths, prepared: saved!, on_prepared });
		expect(reported).toHaveLength(1);
	});

	test("text of another format, or not of prepared schemas, is none", () => {
		const json = JSON.parse(prepared_to_json(prepared)) as Record<string, unknown>;
		expect(prepared_from_json(JSON.stringify({ ...json, format: 0 }))).toBeUndefined();
		expect(prepared_from_json(JSON.stringify({ ...json, selected: { properties: {} } }))).toBeUndefined();
		expect(prepared_from_json("{")).toBeUndefined();
		expect(prepared_from_json("null")).toBeUndefined();
	});
});
