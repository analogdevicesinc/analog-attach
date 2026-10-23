#!/usr/bin/env node
// Regression corpus for the binding pipeline: Attach.parse every binding of a Linux tree
// and keep one hash of the resulting ParsedBinding (or the stage and message of the error)
// per file in corpus/bindings.json, so a change to the pipeline shows as a diff of that file.
//
//   node scripts/corpus-parse.mjs run          write corpus/bindings.json (and the dumps in corpus/cache/base/)
//   node scripts/corpus-parse.mjs diff [filter] parse again, compare with corpus/bindings.json
//
// diff lists the files that changed and writes the old and new ParsedBinding of each to
// corpus/cache/diff/{old,new}/ (the old one needs the dumps `run` left in corpus/cache/base/),
// so `diff -ru corpus/cache/diff/old corpus/cache/diff/new` shows what moved.
//
// filter  substring of the binding path, to compare a subset
// LINUX, DT_SCHEMA  the two trees (default test/linux and test/dt-schema)
// PROCESSED_SCHEMA  the output of `dt-mk-schema -j` over them, whose property types the pipeline reads (default: the one
//                   `make dt_binding_check` leaves in the bindings directory; empty for none). See processed-schema.mjs.
//
// Reads dist/: `yarn build` first. The baseline is only comparable on the Linux and
// dt-schema commits and the processed schema it records; the script warns when they differ.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processed_schema_of } from "./processed-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linux = resolve(process.env.LINUX ?? join(root, "test/linux"));
const dt_schema = resolve(process.env.DT_SCHEMA ?? join(root, "test/dt-schema"));
const processed_schema = processed_schema_of(linux);
const bindings_dir = join(linux, "Documentation/devicetree/bindings");
const baseline_file = join(root, "corpus/bindings.json");
const cache = join(root, "corpus/cache");

const [mode, filter = ""] = process.argv.slice(2);
if (!["run", "diff"].includes(mode ?? "")) {
  console.error("usage: corpus-parse.mjs run|diff [filter]");
  process.exit(2);
}
if (!existsSync(join(root, "dist/index.js"))) {
  console.error("missing dist/ (build first: yarn build)");
  process.exit(2);
}
for (const [what, path] of [["Linux bindings", bindings_dir], ["dt-schema", dt_schema]]) {
  if (!existsSync(path)) {
    console.error(`missing ${what}: ${path}`);
    process.exit(2);
  }
}
const { Attach, Result } = await import(join(root, "dist/index.js"));

function commit_of(directory) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && entry.name.endsWith(".yaml")) yield path;
  }
}

// bigints (enum options) are not JSON
const replacer = (_key, value) => (typeof value === "bigint" ? `${value}n` : value);

// What goes into the baseline for one binding: a hash of the ParsedBinding, or "!stage: message".
// The dump is the pretty ParsedBinding, kept for diff.
async function summarize(file) {
  const parsed = await Attach.parse(file, { linux, dt_schema, ...(processed_schema === undefined ? {} : { processed_schema }) });
  if (Result.is_err(parsed)) {
    const message = parsed.error.message.replaceAll(linux, "<linux>").replaceAll(dt_schema, "<dt-schema>").replaceAll("\n", " ");
    return { entry: `!${parsed.error.stage}: ${message.slice(0, 300)}` };
  }
  const binding = parsed.value.parsed_binding;
  return {
    entry: createHash("sha1").update(JSON.stringify(binding, replacer)).digest("hex").slice(0, 12),
    dump: JSON.stringify(binding, replacer, 2) + "\n",
  };
}

const dump_path = (directory, name) => join(directory, name.replace(/\.yaml$/, ".json"));

function save(directory, name, text) {
  const path = dump_path(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// One line per binding, so the file diffs line by line.
function write_baseline(meta, entries) {
  const lines = Object.entries(entries).map(([name, entry]) => `    ${JSON.stringify(name)}: ${JSON.stringify(entry)}`);
  const text = `{\n  "linux": "${meta.linux}",\n  "dt_schema": "${meta.dt_schema}",\n  "processed_schema": "${meta.processed_schema}",\n  "bindings": {\n${lines.join(",\n")}\n  }\n}\n`;
  mkdirSync(dirname(baseline_file), { recursive: true });
  writeFileSync(baseline_file, text);
}

// The processed schema is generated, so the baseline records which one it was made with
const meta = {
  linux: commit_of(linux),
  dt_schema: commit_of(dt_schema),
  processed_schema: processed_schema === undefined ? "none" : createHash("sha1").update(readFileSync(processed_schema)).digest("hex").slice(0, 12),
};
const files = [...walk(bindings_dir)].map((path) => relative(bindings_dir, path)).filter((name) => name.includes(filter));
const base_cache = join(cache, "base");

if (mode === "run") rmSync(base_cache, { recursive: true, force: true });

const baseline = mode === "diff" ? JSON.parse(readFileSync(baseline_file, "utf8")) : undefined;
if (baseline) {
  for (const key of ["linux", "dt_schema", "processed_schema"]) {
    if (baseline[key] !== meta[key]) console.error(`warning: ${key} is at ${meta[key]}, the baseline was made at ${baseline[key]}`);
  }
}
const diff_cache = join(cache, "diff");
if (mode === "diff") rmSync(diff_cache, { recursive: true, force: true });

const entries = {};
const changed = [];
for (const [i, name] of files.entries()) {
  if (process.stderr.isTTY && i % 50 === 0) process.stderr.write(`\r${i}/${files.length}\x1B[K`);
  const { entry, dump } = await summarize(join(bindings_dir, name));
  entries[name] = entry;
  if (mode === "run") {
    if (dump) save(base_cache, name, dump);
  } else if (baseline.bindings[name] !== entry) {
    changed.push(name);
    const old_dump = dump_path(base_cache, name);
    if (existsSync(old_dump)) save(join(diff_cache, "old"), name, readFileSync(old_dump, "utf8"));
    if (dump) save(join(diff_cache, "new"), name, dump);
  }
}
if (process.stderr.isTTY) process.stderr.write("\r\x1B[K");

const failed = Object.values(entries).filter((entry) => entry.startsWith("!")).length;
console.log(`${files.length} bindings, ${files.length - failed} parsed, ${failed} failed`);

if (mode === "run") {
  write_baseline(meta, entries);
  console.log(`wrote ${relative(root, baseline_file)}`);
} else {
  const removed = Object.keys(baseline.bindings).filter((name) => name.includes(filter) && !(name in entries));
  for (const name of changed) {
    const was = baseline.bindings[name];
    const now = entries[name];
    const what = was === undefined ? "added" : was.startsWith("!") && !now.startsWith("!") ? "now parses" : !was.startsWith("!") && now.startsWith("!") ? "now fails" : "changed";
    console.log(`${what.padEnd(10)} ${name}${now.startsWith("!") ? `  (${now})` : ""}`);
  }
  for (const name of removed) console.log(`removed    ${name}`);
  console.log(`${changed.length} changed, ${removed.length} removed`);
  if (changed.length > 0) console.log(`diff -ru ${relative(process.cwd(), join(diff_cache, "old"))} ${relative(process.cwd(), join(diff_cache, "new"))}`);
  process.exitCode = changed.length + removed.length > 0 ? 1 : 0;
}
