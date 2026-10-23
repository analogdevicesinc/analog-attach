#!/usr/bin/env node
// Run nodes through update_binding_by_changes the way the CLI does (populate_binding, then
// validator_input_json) and print the encoded data and the required properties after narrowing.
//   node scripts/repros/branch.mjs <binding path under Documentation/devicetree/bindings> '<node body>' ['<node body>' ...]
// A node body is what goes between the braces of `n@0 { ... };`, e.g. 'compatible = "arm,psci";'.
// Reads dist/ (yarn build first) and test/linux, test/dt-schema.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Attach, DeviceTree, Result, populate_binding, validator_input_json } = await import(join(root, "dist/index.js"));
const [file, ...bodies] = process.argv.slice(2);
if (bodies.length === 0) {
  console.error("usage: branch.mjs <binding> '<node body>' ...");
  process.exit(2);
}
const parsed = await Attach.parse(join(root, "test/linux/Documentation/devicetree/bindings", file), {
  linux: join(root, "test/linux"),
  dt_schema: join(root, "test/dt-schema"),
});
if (Result.is_err(parsed)) {
  console.error(`${parsed.error.stage}: ${parsed.error.message}`);
  process.exit(1);
}
const attach = parsed.value;
for (const body of bodies) {
  const tree = DeviceTree.new_from_string(`/dts-v1/;\n/ { n: n@0 { ${body} }; };`);
  if (typeof tree === "string") { throw new Error(tree); }
  const initial = populate_binding(attach.parsed_binding, tree, "{}", {});
  const json = validator_input_json(tree.node_at("/n@0"), initial.properties);
  const narrowed = attach.update_binding_by_changes(json);
  console.log(body);
  console.log(`  encoded:  ${json}`);
  console.log(`  required: ${JSON.stringify(narrowed?.binding.required_properties)}`);
}
