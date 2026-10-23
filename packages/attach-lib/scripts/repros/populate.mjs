#!/usr/bin/env node
// Populate one binding for a devicetree (default test/dts_source/rpi.prepro.dts, the one
// test/BindingParserCompletion.test.ts uses) and print each property's populated type,
// marking the ones that stay unknown or open. Bigints print as numbers.
//   node scripts/repros/populate.mjs <binding path under Documentation/devicetree/bindings> [--dts <file>] [--parent <node name>] [--json]
// --parent defaults to spi@7e204000. --json prints the whole populated ParsedBinding.
// Reads dist/ (yarn build first) and test/linux, test/dt-schema; the processed schema of test/linux (scripts/processed-schema.mjs) if there is one.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { schema_paths } from "../processed-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { Attach, DeviceTree, Result, is_open, populate_binding } = await import(join(root, "dist/index.js"));

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args.splice(at, 2)[1];
};
const json = args.includes("--json") && args.splice(args.indexOf("--json"), 1).length === 1;
const dts = resolve(option("--dts", join(root, "test/dts_source/rpi.prepro.dts")));
const parent_name = option("--parent", "spi@7e204000");
const [file] = args;
if (file === undefined) {
  console.error("usage: populate.mjs <binding> [--dts <file>] [--parent <node name>] [--json]");
  process.exit(2);
}

const document = DeviceTree.new_from_string(readFileSync(dts, "utf8"));
if (typeof document === "string") {
  console.error(`${dts}: ${document}`);
  process.exit(1);
}
const parsed = await Attach.parse(join(root, "test/linux/Documentation/devicetree/bindings", file), schema_paths(join(root, "test/linux"), join(root, "test/dt-schema")));
if (Result.is_err(parsed)) {
  console.error(`${parsed.error.stage}: ${parsed.error.message}`);
  process.exit(1);
}

const populated = populate_binding(parsed.value.parsed_binding, document, "{}", { parent_name });
const replacer = (_key, value) => (typeof value === "bigint" ? Number(value) : value);
if (json) {
  console.log(JSON.stringify(populated, replacer, 2));
  process.exit(0);
}

const show = (properties, indent = "") => {
  for (const { key, value } of properties) {
    const mark = value._t === "unknown" ? " UNKNOWN" : is_open(value) ? " OPEN" : "";
    console.log(`${indent}${key}: ${value._t}${mark}`);
  }
};
show(populated.properties);
for (const rule of populated.pattern_properties ?? []) {
  console.log(`pattern ${rule.pattern}`);
  show(rule.properties, "  ");
}
