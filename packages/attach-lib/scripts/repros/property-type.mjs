#!/usr/bin/env node
// Print the ParsedBinding type of one property of a binding, bigints as numbers.
//   node scripts/repros/property-type.mjs <binding path under Documentation/devicetree/bindings> <property> [--pattern <regex>]
// Reads dist/ (yarn build first) and test/linux, test/dt-schema; the processed schema of test/linux (scripts/processed-schema.mjs) if there is one.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { schema_paths } from "../processed-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Attach, Result } = await import(join(root, "dist/index.js"));
const [file, property, flag, pattern] = process.argv.slice(2);
if (property === undefined) {
  console.error("usage: property-type.mjs <binding> <property> [--pattern <regex>]");
  process.exit(2);
}
const parsed = await Attach.parse(join(root, "test/linux/Documentation/devicetree/bindings", file), schema_paths(join(root, "test/linux"), join(root, "test/dt-schema")));
if (Result.is_err(parsed)) {
  console.error(`${parsed.error.stage}: ${parsed.error.message}`);
  process.exit(1);
}
const binding = parsed.value.parsed_binding;
const properties = flag === "--pattern"
  ? binding.pattern_properties?.find((rule) => rule.pattern === pattern)?.properties
  : binding.properties;
const found = properties?.find((entry) => entry.key === property);
console.log(found === undefined ? "not found" : JSON.stringify(found.value, (_key, value) => (typeof value === "bigint" ? Number(value) : value)));
