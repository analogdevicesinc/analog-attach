#!/usr/bin/env node
// Print the type of one property without the processed schema (`{ linux, dt_schema }`) and with it (`dt-mk-schema -j`
// output, which the CLI passes as `Bindings.processed_schema`, from its cache). The overlay corpus can't show such a
// change: what it records comes from dt-validate and the lib's overlay checks, not from the binding property types.
//   node corpus/overlays/repros/processed-types.mjs <binding path under Documentation/devicetree/bindings> <property> [--linux <dir>] [--processed <file>]
// Reads attach-lib's dist/ (yarn build first) and the CLI's bundled dt-schema (packages/cli/bundled/linux/dt-schema).
// --linux defaults to attach-lib's test/linux, --processed to the file `dt-mk-schema -j -o` leaves in its bindings
// directory (processed-schema.json).
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const lib = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args.splice(at, 2)[1];
};
const linux = resolve(option("--linux", join(lib, "test/linux")));
const processed = resolve(option("--processed", join(linux, "Documentation/devicetree/bindings/processed-schema.json")));
const [file, property] = args;
if (property === undefined) {
  console.error("usage: processed-types.mjs <binding> <property> [--linux <dir>] [--processed <file>]");
  process.exit(2);
}
if (!existsSync(processed)) {
  console.error(`no processed schema at ${processed} (dt-mk-schema -j -o <file> <bindings dir>)`);
  process.exit(2);
}
const { Attach, Result } = await import(join(lib, "dist/index.js"));
const dt_schema = resolve(lib, "../cli/bundled/linux/dt-schema");
const show = async (label, paths) => {
  const parsed = await Attach.parse(join(linux, "Documentation/devicetree/bindings", file), paths);
  if (Result.is_err(parsed)) { console.log(`${label}: ${parsed.error.stage}: ${parsed.error.message}`); return; }
  const found = parsed.value.parsed_binding.properties.find((entry) => entry.key === property);
  console.log(`${label}: ${found === undefined ? "not found" : JSON.stringify(found.value, (_key, value) => (typeof value === "bigint" ? Number(value) : value))}`);
};
await show("without   ", { linux, dt_schema });
await show("with      ", { linux, dt_schema, processed_schema: processed });
