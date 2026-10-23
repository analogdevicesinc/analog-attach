#!/usr/bin/env node
// Print the type of one property without the processed schema (`{ linux, dt_schema }`, how attach-cli parsed bindings
// before it passed `Bindings.processed_schema`) and with it (`.attach-linux/validation.json`, `dt-mk-schema -j` output,
// which the CLI passes now).
//   node scripts/repros/processed-types.mjs <binding path under Documentation/devicetree/bindings> <property> [--linux <dir>] [--processed <file>]
// Reads attach-lib's dist/ (yarn build first). --linux defaults to attach-lib's test/linux, --processed to the file
// `dt-mk-schema -j -o` leaves in its bindings directory (processed-schema.json), the same content as validation.json.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = resolve(root, "../attach-lib");
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
const dt_schema = join(root, "bundled/dt-schema");
const show = async (label, paths) => {
  const parsed = await Attach.parse(join(linux, "Documentation/devicetree/bindings", file), paths);
  if (Result.is_err(parsed)) { console.log(`${label}: ${parsed.error.stage}: ${parsed.error.message}`); return; }
  const found = parsed.value.parsed_binding.properties.find((entry) => entry.key === property);
  console.log(`${label}: ${found === undefined ? "not found" : JSON.stringify(found.value, (_key, value) => (typeof value === "bigint" ? Number(value) : value))}`);
};
await show("without   ", { linux, dt_schema });
await show("with      ", { linux, dt_schema, processed_schema: processed });
