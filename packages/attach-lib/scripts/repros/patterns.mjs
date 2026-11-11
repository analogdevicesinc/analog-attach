#!/usr/bin/env node
// Print the patterns a binding's ParsedBinding offers (property patterns with their type, child-node patterns by key)
// and the ones its processed schema has, its own and those of its allOf entries, so a pattern the translation drops shows.
//   node scripts/repros/patterns.mjs <binding path under Documentation/devicetree/bindings> [--property <name>] [--node '<node body>']
// With --property, also which property pattern of the ParsedBinding types that name, and which of the processed schema's
// match it. With --node, the ParsedBinding is the one narrowed for that node (as scripts/repros/branch.mjs encodes it),
// and the schema's patterns include those of the if / then branches. Reads dist/ (yarn build first) and test/linux, test/dt-schema, and the processed schema of test/linux.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { schema_paths } from "../processed-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Attach, DeviceTree, Result, populate_binding, node_data_json } = await import(join(root, "dist/index.js"));
const [file, ...rest] = process.argv.slice(2);
const options = {};
for (let index = 0; index < rest.length; index += 2) { options[rest[index]] = rest[index + 1]; }
if (file === undefined || Object.entries(options).some(([key, value]) => !["--property", "--node"].includes(key) || value === undefined)) {
  console.error("usage: patterns.mjs <binding> [--property <name>] [--node '<node body>']");
  process.exit(2);
}
const property = options["--property"];
const body = options["--node"];
// The processed schema is the one after the last stage of the trace
let schema;
const trace = (event) => { if (event.kind === "stage") { schema = event.schema; } };
const parsed = await Attach.parse(join(root, "test/linux/Documentation/devicetree/bindings", file), schema_paths(join(root, "test/linux"), join(root, "test/dt-schema")), { trace });
if (Result.is_err(parsed)) {
  console.error(`${parsed.error.stage}: ${parsed.error.message}`);
  process.exit(1);
}
let binding = parsed.value.parsed_binding;
if (body !== undefined) {
  const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ { n: n@0 { ${body} }; };`);
  if (typeof tree === "string") { throw new Error(tree); }
  const initial = populate_binding(binding, tree, "{}", {});
  binding = parsed.value.narrow_binding(node_data_json(tree.node_at("/n@0"), initial.properties)) ?? binding;
}
const show = (value) => JSON.stringify(value, (_key, cell) => (typeof cell === "bigint" ? Number(cell) : cell));

// The schema's patterns: its own, then those of its allOf entries (an if / then's only with --node), with where they are
const schema_patterns = [];
const collect = (node, at) => {
  for (const pattern of Object.keys(node?.patternProperties ?? {})) { schema_patterns.push({ pattern, at }); }
  (node?.allOf ?? []).forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") { return; }
    if (!("if" in entry)) { collect(entry, `${at}/allOf/${index}${entry.$id ? ` (${entry.$id})` : ""}`); }
    else if (body !== undefined) {
      if (entry.then) { collect(entry.then, `${at}/allOf/${index}/then`); }
      if (entry.else) { collect(entry.else, `${at}/allOf/${index}/else`); }
    }
  });
};
collect(schema, "");

console.log("processed schema patterns:");
for (const { pattern, at } of schema_patterns) { console.log(`  ${pattern}  at ${at || "/"}`); }
console.log("ParsedBinding property_patterns:");
for (const rule of binding.property_patterns ?? []) { console.log(`  ${rule.pattern}  ${show(rule.value)}`); }
console.log("ParsedBinding pattern_properties (child nodes):");
for (const rule of binding.pattern_properties ?? []) { console.log(`  ${rule.pattern}`); }

if (property !== undefined) {
  const matches = (pattern) => new RegExp(pattern, "u").test(property);
  const named = binding.properties.find((entry) => entry.key === property);
  console.log(`${property}:`);
  console.log(`  named property: ${named === undefined ? "none" : show(named.value)}`);
  console.log(`  ParsedBinding patterns matching: ${(binding.property_patterns ?? []).filter((rule) => matches(rule.pattern)).map((rule) => `${rule.pattern} ${show(rule.value)}`).join("; ") || "none"}`);
  console.log(`  processed schema patterns matching: ${schema_patterns.filter(({ pattern }) => matches(pattern)).map(({ pattern, at }) => `${pattern} at ${at || "/"}`).join("; ") || "none"}`);
}
