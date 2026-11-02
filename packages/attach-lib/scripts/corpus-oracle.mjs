#!/usr/bin/env node
// Oracle for the binding pipeline: compares what Attach.parse makes of each binding of a Linux tree with what
// dt-schema's processed schema (`dt-mk-schema -j`, see processed-schema.mjs) says of it, and keeps the cases where
// they disagree, one line each by category, in corpus/oracle.json, so a pipeline change shows what it fixed and what
// it broke.
//
//   node scripts/corpus-oracle.mjs run [--dumps]                       write corpus/oracle.json
//   node scripts/corpus-oracle.mjs diff [--dumps] [filter]             check again, compare with corpus/oracle.json
//   node scripts/corpus-oracle.mjs list <category> [--dumps] [filter]  print every case of one category
//
// --dumps  read the ParsedBindings `yarn corpus` left in corpus/cache/base/ instead of parsing every binding: faster,
//          but only as current as the last `yarn corpus`
// filter   substring of the binding path, to check a subset
// LINUX, DT_SCHEMA, PROCESSED_SCHEMA  as for corpus-parse.mjs; the processed schema is required here
//
// The categories (a case is `<binding>:<property> <what each side says>`, a child node's property under its name):
//   type-gap          we don't know the type (`unknown`, or cells that are only `any`) and dt-schema does
//   type-mismatch     our shape is none of the types dt-schema gives
//   two-types         dt-schema gives the name more than one type and the binding doesn't say which; ours is one
//                     of them (not a disagreement: validation.json can't settle it either)
//   count-mismatch    a list's or matrix's minItems/maxItems differ from the processed schema's; an unset minItems
//                     is 1 on both sides
//   row-count-mismatch  the same for the rows of a matrix, where the processed schema sizes them
//   duplicate-key     a node lists a property twice
//   impossible-bound  minItems > maxItems, or minimum > maximum
//
// Limits: the processed schema has no descriptions or examples, and sizes only the properties a binding lists itself
// (an inherited one stays behind its `$ref`), so an inherited property is checked against the type dt-schema gives its
// name and its counts not at all.
//
// Reads dist/ (unless --dumps): `yarn build` first. Like corpus/bindings.json, the baseline is only comparable on the
// commits and processed schema it records.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corpus_meta, walk, warn_meta } from "./corpus-common.mjs";
import { processed_schema_of } from "./processed-schema.mjs";

const CATEGORIES = ["type-gap", "type-mismatch", "two-types", "count-mismatch", "row-count-mismatch", "duplicate-key", "impossible-bound"];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linux = resolve(process.env.LINUX ?? join(root, "test/linux"));
const dt_schema = resolve(process.env.DT_SCHEMA ?? join(root, "test/dt-schema"));
const processed_schema = processed_schema_of(linux);
const bindings_dir = join(linux, "Documentation/devicetree/bindings");
const baseline_file = join(root, "corpus/oracle.json");
const dumps_dir = join(root, "corpus/cache/base");

const argv = process.argv.slice(2);
const use_dumps = argv.includes("--dumps");
const [mode, ...rest] = argv.filter((word) => word !== "--dumps");
const category = mode === "list" ? rest.shift() : undefined;
const filter = rest[0] ?? "";

if (!["run", "diff", "list"].includes(mode ?? "") || (mode === "list" && !CATEGORIES.includes(category ?? ""))) {
  console.error("usage: corpus-oracle.mjs run|diff [--dumps] [filter]\n       corpus-oracle.mjs list <category> [--dumps] [filter]");
  console.error(`categories: ${CATEGORIES.join(", ")}`);
  process.exit(2);
}
for (const [what, path] of [["Linux bindings", bindings_dir], ["dt-schema", dt_schema]]) {
  if (!existsSync(path)) {
    console.error(`missing ${what}: ${path}`);
    process.exit(2);
  }
}
if (processed_schema === undefined) {
  console.error("missing the processed schema (make dt_binding_check, or set PROCESSED_SCHEMA)");
  process.exit(2);
}
if (use_dumps ? !existsSync(dumps_dir) : !existsSync(join(root, "dist/index.js"))) {
  console.error(use_dumps ? "missing corpus/cache/base/ (yarn corpus first)" : "missing dist/ (build first: yarn build)");
  process.exit(2);
}

// The processed schema: the type dt-schema gives each name (and pattern), and each binding's own schema by file.
const processed = JSON.parse(readFileSync(processed_schema, "utf8"));
const generated_types = processed["generated-types"]?.properties ?? {};
const generated_pattern_types = processed["generated-pattern-types"]?.properties ?? {};
const generated_patterns = Object.entries(generated_pattern_types).flatMap(([pattern, types]) => {
  try { return [{ regex: new RegExp(pattern), types }]; } catch { return []; }
});
const schema_by_file = new Map();
for (const schema of Object.values(processed)) {
  if (typeof schema?.$filename === "string" && schema.$filename.startsWith(bindings_dir)) {
    schema_by_file.set(relative(bindings_dir, schema.$filename), schema);
  }
}

const is_object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** dt-schema's type names of a generated-types entry, without `node`. */
const type_names = (entries) => [...new Set((entries ?? []).map((entry) => entry.type).filter((type) => typeof type === "string" && type !== "node"))].sort();

/** The types.yaml types a schema names itself, through `$ref` and its `allOf` / `oneOf` / `anyOf`. */
function own_types(schema) {
  if (!is_object(schema)) return [];
  const found = [];
  const reference = /types\.yaml#\/definitions\/([\w-]+)$/.exec(schema.$ref ?? "");
  if (reference) found.push(reference[1]);
  if (schema.type === "boolean") found.push("flag");
  for (const key of ["allOf", "oneOf", "anyOf"]) {
    for (const branch of Array.isArray(schema[key]) ? schema[key] : []) found.push(...own_types(branch));
  }
  return [...new Set(found)].sort();
}

/** The types dt-schema gives a property: its schema's own, else its name's, else the first pattern's that matches. */
function dt_types(name, schema, pattern) {
  const own = own_types(schema);
  if (own.length > 0) return { types: own, own: true };
  if (pattern !== undefined) return { types: type_names(generated_pattern_types[pattern]), own: false };
  const entries = generated_types[name] ?? generated_patterns.find(({ regex }) => regex.test(name))?.types;
  return { types: type_names(entries), own: false };
}

const INTEGER = /^u?int(8|16|32|64)$/;
const INTEGER_ARRAY = /^u?int(8|16|32|64)-array$/;
const MATRIX = /-matrix$|^phandle(-array)?$|^address$/;

/** What a cell holds: `number`, `string`, `phandle` or `any`. */
function cell_kind(cell) {
  if (cell._t === "enum") return cell.enum_type === "string" ? "string" : cell.enum_type === "phandle" ? "phandle" : "number";
  return cell._t;
}

function cell_kinds(value) {
  if (value._t === "scalar") return [cell_kind(value.cell)];
  if (value._t === "list") return (Array.isArray(value.item) ? value.item : [value.item]).map(cell_kind);
  return [];
}

/** Whether `value` is of dt-schema's `type`: `ok`, `gap` (we don't know) or `mismatch`. */
function fit(value, type) {
  if (value._t === "unknown") return "gap";
  if (type === "flag") return value._t === "flag" ? "ok" : "mismatch";
  if (MATRIX.test(type)) return value._t === "matrix" ? "ok" : "mismatch";

  const kinds = cell_kinds(value);
  if (kinds.length > 0 && kinds.every((kind) => kind === "any")) return "gap";

  const number = INTEGER.test(type) || INTEGER_ARRAY.test(type);
  const shapes = INTEGER.test(type) ? ["scalar"] : INTEGER_ARRAY.test(type) || type.endsWith("string-array") ? ["list"] : type === "string" ? ["scalar", "list"] : [];
  if (!shapes.includes(value._t)) return "mismatch";
  return kinds.every((kind) => kind === "any" || kind === (number ? "number" : "string")) ? "ok" : "mismatch";
}

/** Our shape, short: `list(number,string)`, `scalar(any)`, `matrix`. */
function shape(value) {
  const kinds = [...new Set(cell_kinds(value))];
  return kinds.length > 0 ? `${value._t}(${kinds.join(",")})` : value._t;
}

const count = (bound) => bound ?? "unset";
const counts_of = (min, max) => `(${count(min)}, ${count(max)})`;
const same_counts = (a, b) => (a.minItems ?? 1) === (b.minItems ?? 1) && a.maxItems === b.maxItems;
const big = (bound) => (typeof bound === "string" ? BigInt(bound.slice(0, -1)) : bound);

/** The bounds of `value` that can't hold: a minimum above its maximum, of the items or of a number cell. */
function impossible_bounds(value) {
  const found = [];
  const check_items = (what, schema) => {
    if (typeof schema.minItems === "number" && typeof schema.maxItems === "number" && schema.minItems > schema.maxItems) {
      found.push(`${what} items ${counts_of(schema.minItems, schema.maxItems)}`);
    }
  };
  const check_cell = (what, cell) => {
    if (cell._t === "number" && cell.minimum !== undefined && cell.maximum !== undefined && big(cell.minimum) > big(cell.maximum)) {
      found.push(`${what} range ${big(cell.minimum)}..${big(cell.maximum)}`);
    }
  };
  const check_list = (what, list) => {
    check_items(what, list);
    for (const cell of Array.isArray(list.item) ? list.item : [list.item]) check_cell(what, cell);
  };

  if (value._t === "scalar") check_cell("value", value.cell);
  if (value._t === "list") check_list("list", value);
  if (value._t === "matrix") {
    check_items("matrix", value);
    value.rows.forEach((row, index) => check_list(`row ${index}`, row));
  }
  return found;
}

/** Where the processed schema sizes a matrix's rows: one schema for every row, or one per position. */
function row_schemas(schema) {
  const items = schema?.items;
  const sizes = (row) => is_object(row) && (row.minItems !== undefined || row.maxItems !== undefined);
  if (Array.isArray(items)) return items.some(sizes) ? items : undefined;
  return sizes(items) ? items : undefined;
}

/** The cases of one binding, by category. */
function check(name, binding) {
  const cases = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
  const own_schema = schema_by_file.get(name);

  const check_property = (where, key, value, schema, pattern) => {
    const at = `${name}:${where}${key}`;
    if (!is_object(value)) return;

    for (const bound of impossible_bounds(value)) cases["impossible-bound"].push(`${at} ${bound}`);
    if (value._t === "node") return;

    const { types, own } = dt_types(key, schema, pattern);
    if (types.length > 0) {
      const fits = types.map((type) => fit(value, type));
      const said = `ours ${shape(value)}, dt-schema ${types.join("|")}`;
      if (fits.includes("ok")) {
        if (types.length > 1 && !own) cases["two-types"].push(`${at} ${said}`);
      } else {
        cases[fits.includes("gap") ? "type-gap" : "type-mismatch"].push(`${at} ${said}`);
      }
    }

    if (!is_object(schema) || (value._t !== "list" && value._t !== "matrix")) return;
    if ((schema.minItems !== undefined || schema.maxItems !== undefined) && !same_counts(value, schema)) {
      cases["count-mismatch"].push(`${at} ours ${counts_of(value.minItems, value.maxItems)}, dt-schema ${counts_of(schema.minItems, schema.maxItems)}`);
    }

    const rows = value._t === "matrix" ? row_schemas(schema) : undefined;
    if (rows === undefined) return;
    if (Array.isArray(rows) && rows.length !== value.rows.length && value.rows.length > 1) {
      cases["row-count-mismatch"].push(`${at} ours ${value.rows.length} rows, dt-schema ${rows.length}`);
      return;
    }
    value.rows.forEach((row, index) => {
      const theirs = Array.isArray(rows) ? rows[value.rows.length === 1 ? 0 : index] : rows;
      if (!is_object(theirs) || (theirs.minItems === undefined && theirs.maxItems === undefined) || same_counts(row, theirs)) return;
      cases["row-count-mismatch"].push(`${at} row ${index} ours ${counts_of(row.minItems, row.maxItems)}, dt-schema ${counts_of(theirs.minItems, theirs.maxItems)}`);
    });
  };

  const check_node = (where, properties, schema) => {
    const seen = new Map();
    for (const { key } of properties) seen.set(key, (seen.get(key) ?? 0) + 1);
    for (const [key, times] of seen) {
      if (times > 1) cases["duplicate-key"].push(`${name}:${where}${key} ${times} times`);
    }

    const checked = new Set();
    for (const { key, value } of properties) {
      if (checked.has(key)) continue;
      checked.add(key);
      const property_schema = is_object(schema?.properties) ? schema.properties[key] : undefined;
      check_property(where, key, value, property_schema);
      if (value?._t === "node") check_node(`${where}${key}/`, value.properties, is_object(property_schema) ? property_schema : undefined);
    }
  };

  const patterns = is_object(own_schema?.patternProperties) ? own_schema.patternProperties : {};
  check_node("", binding.properties, own_schema);
  for (const rule of binding.pattern_properties ?? []) {
    check_node(`${rule.pattern}/`, rule.properties, is_object(patterns[rule.pattern]) ? patterns[rule.pattern] : undefined);
  }
  for (const rule of binding.property_patterns ?? []) {
    check_property("", rule.pattern, rule.value, patterns[rule.pattern], rule.pattern);
  }
  return cases;
}

const { Attach, Result } = use_dumps ? {} : await import(join(root, "dist/index.js"));
const paths = { linux, dt_schema, processed_schema };

/** The ParsedBinding of a file, or undefined when it doesn't parse (or has no dump). */
async function binding_of(name) {
  if (use_dumps) {
    const dump = join(dumps_dir, name.replace(/\.yaml$/, ".json"));
    return existsSync(dump) ? JSON.parse(readFileSync(dump, "utf8")) : undefined;
  }
  const parsed = await Attach.parse(join(bindings_dir, name), paths);
  return Result.is_err(parsed) ? undefined : parsed.value.parsed_binding;
}

const files = [...walk(bindings_dir)].map((path) => relative(bindings_dir, path)).filter((name) => name.includes(filter));
const found = Object.fromEntries(CATEGORIES.map((category) => [category, []]));
let unparsed = 0;
for (const [index, name] of files.entries()) {
  if (process.stderr.isTTY && index % 50 === 0) process.stderr.write(`\r${index}/${files.length}\x1B[K`);
  const binding = await binding_of(name);
  if (binding === undefined) {
    unparsed++;
    continue;
  }
  for (const [category, cases] of Object.entries(check(name, binding))) found[category].push(...cases);
}
if (process.stderr.isTTY) process.stderr.write("\r\x1B[K");
for (const cases of Object.values(found)) cases.sort();

console.log(`${files.length} bindings, ${files.length - unparsed} checked, ${unparsed} ${use_dumps ? "without a dump" : "failed to parse"}`);

const EXAMPLES = 3;
const CHANGES = 20;
const width = Math.max(...CATEGORIES.map((category) => category.length));

// One case per line, so the file diffs line by line.
function write_baseline(meta) {
  const sections = CATEGORIES.map((category) => {
    const lines = found[category].map((entry) => `      ${JSON.stringify(entry)}`);
    return `    ${JSON.stringify(category)}: [${lines.length === 0 ? "" : `\n${lines.join(",\n")}\n    `}]`;
  });
  const text = `{\n  "linux": "${meta.linux}",\n  "dt_schema": "${meta.dt_schema}",\n  "processed_schema": "${meta.processed_schema}",\n  "cases": {\n${sections.join(",\n")}\n  }\n}\n`;
  mkdirSync(dirname(baseline_file), { recursive: true });
  writeFileSync(baseline_file, text);
}

if (mode === "list") {
  for (const entry of found[category]) console.log(entry);
  console.log(`${found[category].length} ${category}`);
} else if (mode === "run") {
  for (const category of CATEGORIES) {
    const cases = found[category];
    console.log(`${category.padEnd(width)} ${String(cases.length).padStart(5)}  ${cases.slice(0, EXAMPLES).join("; ")}`);
  }
  write_baseline(corpus_meta(linux, dt_schema, processed_schema));
  console.log(`wrote ${relative(root, baseline_file)}`);
} else {
  const baseline = JSON.parse(readFileSync(baseline_file, "utf8"));
  warn_meta(baseline, corpus_meta(linux, dt_schema, processed_schema));

  let changes = 0;
  for (const category of CATEGORIES) {
    const before = (baseline.cases[category] ?? []).filter((entry) => entry.slice(0, entry.indexOf(":")).includes(filter));
    const now = new Set(found[category]);
    const was = new Set(before);
    const gone = before.filter((entry) => !now.has(entry));
    const came = found[category].filter((entry) => !was.has(entry));
    changes += gone.length + came.length;

    const moved = gone.length + came.length === 0 ? "" : `  (-${gone.length} +${came.length})`;
    console.log(`${category.padEnd(width)} ${String(before.length).padStart(5)} → ${String(now.size).padEnd(5)}${moved}`);
    for (const [sign, entries] of [["-", gone], ["+", came]]) {
      for (const entry of entries.slice(0, CHANGES)) console.log(`    ${sign} ${entry}`);
      if (entries.length > CHANGES) console.log(`    ${sign} … ${entries.length - CHANGES} more (list ${category})`);
    }
  }
  console.log(changes === 0 ? "no change" : `${changes} cases changed`);
  process.exitCode = changes > 0 ? 1 : 0;
}
