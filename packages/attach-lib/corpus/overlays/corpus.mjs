#!/usr/bin/env node
// Regression corpus for the overlay parser: parse every Raspberry Pi overlay of a Linux tree against that tree's
// bcm2711-rpi-4-b.dts with attach-lib, validate it with dt-validate, and keep one normalized JSON snapshot per overlay
// in corpus/overlays/snapshots/, so a change to the parser, the printer or the overlay checks shows as a diff.
//
//   node corpus/overlays/corpus.mjs run  [filter]   write the snapshots
//   node corpus/overlays/corpus.mjs diff [filter]   run into a temp dir, compare with the snapshots (exit 1 on a regression)
//
// Per overlay, the way `analog-attach import` then `validate` do it, but with the lib's calls only:
//   - preprocess the overlay with cpp (the CLI's default preprocess-command) and parse it against the base
//     (DeviceTreeOverlay.new_from_string), drop the root `__overrides__` (remove_root_node), and record the lib's
//     unresolved_targets / unresolved_references;
//   - print it as a workfile (fragment syntax) and parse that again, as validate reads it back;
//   - record the lib's reg_conflicts / chip_select_overflows that involve the overlay;
//   - build the stand-in tree of the CLI's validate (validation-tree.mjs), compile it with dtc and run dt-validate
//     against the processed schema (`dt-mk-schema -j` over the tree's bindings, built once per run into the cache).
//
// The Linux tree is fetched, not taken from the machine: a shallow, sparse checkout of LINUX_COMMIT (see below) into
// the cache directory, reused by later runs. To move the corpus to another kernel, change LINUX_COMMIT and rerun `run`.
//
// filter  substring of the overlay file name, to run a subset
// CORPUS_JOBS  overlays validated in parallel (default: the CPUs minus one, at most 8)
// CORPUS_CACHE  where the checkout and the processed schema go (default $XDG_CACHE_HOME/attach-corpus)
//
// Reads dist/ (`yarn build` first) and the CLI's bundled dtc / dt-mk-schema / dt-validate
// (packages/cli/bundled/linux/tools: `packages/cli/scripts/bundle-dt-schema.sh`, which `yarn test` runs too).
import { execFile, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { validation_tree } from "./validation-tree.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const baseline = join(here, "snapshots");
const tools = resolve(root, "../cli/bundled/linux/tools");
const LINUX_URL = "https://github.com/analogdevicesinc/linux";
const LINUX_COMMIT = "16bea53d3413344f5561b1fc45b90699239b55bb"; // rpi-6.12.y, 2026-09-30
const LINUX_PATHS = ["arch/arm/boot/dts/broadcom", "arch/arm/boot/dts/overlays", "include", "Documentation/devicetree/bindings"];
const PREPROCESS = ["-nostdinc", "-undef", "-x", "assembler-with-cpp", "-P"]; // the CLI's DEFAULT_PREPROCESS_COMMAND, plus -I <linux>/include
const cache = process.env.CORPUS_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "attach-corpus");
const linux = join(cache, `linux-${LINUX_COMMIT.slice(0, 12)}`);
const devicetree = join(linux, "arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts");
const overlays_dir = join(linux, "arch/arm/boot/dts/overlays");
const processed_schema = join(cache, `processed-schema-${LINUX_COMMIT.slice(0, 12)}.json`);
const run_tool = promisify(execFile);

function git(...args) {
  const result = spawnSync("git", args, { cwd: linux, stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) {
    console.error(`git ${args.join(" ")} failed`);
    process.exit(2);
  }
}

// Shallow (one commit, no tags, blobs on demand), sparse (only what the corpus reads).
function fetch_linux() {
  if (existsSync(join(linux, ".fetched"))) return;
  console.error(`fetching ${LINUX_URL} @ ${LINUX_COMMIT.slice(0, 12)} into ${linux}`);
  rmSync(linux, { recursive: true, force: true });
  mkdirSync(linux, { recursive: true });
  git("init", "-q");
  git("remote", "add", "origin", LINUX_URL);
  git("sparse-checkout", "set", "--cone", ...LINUX_PATHS);
  git("fetch", "-q", "--depth=1", "--no-tags", "--filter=blob:none", "origin", LINUX_COMMIT);
  git("checkout", "-q", "FETCH_HEAD");
  writeFileSync(join(linux, ".fetched"), LINUX_COMMIT + "\n");
}

const [mode, filter = ""] = process.argv.slice(2);
if (!["run", "diff"].includes(mode ?? "")) {
  console.error("usage: corpus.mjs run|diff [filter]");
  process.exit(2);
}
if (!existsSync(join(root, "dist/index.js"))) {
  console.error("missing dist/ (build first: yarn build)");
  process.exit(2);
}
for (const tool of ["dtc", "dt-mk-schema", "dt-validate"]) {
  if (!existsSync(join(tools, tool))) {
    console.error(`missing ${join(tools, tool)} (run packages/cli/scripts/bundle-dt-schema.sh)`);
    process.exit(2);
  }
}
if (spawnSync("cpp", ["--version"], { stdio: "ignore" }).status !== 0) {
  console.error("cpp not found on PATH (needed to preprocess the devicetrees)");
  process.exit(2);
}
const lib = await import(join(root, "dist/index.js"));
const { DeviceTree, DeviceTreeOverlay, get_full_node_name, unresolved_targets, unresolved_references, reg_conflicts, chip_select_overflows } = lib;
const build_validation_dts = validation_tree(lib);

fetch_linux();
for (const [what, path] of [["Linux overlays", overlays_dir], ["base devicetree", devicetree]]) {
  if (!existsSync(path)) {
    console.error(`missing ${what}: ${path}`);
    process.exit(2);
  }
}

// Every file the run writes (preprocessed sources, stand-in trees, dtbs, dt-validate output) goes in one temp dir.
const work = mkdtempSync(join(tmpdir(), "attach-corpus-"));
const cleanup = () => rmSync(work, { recursive: true, force: true });
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

function normalize(text) {
  return text.replaceAll(work, "<sandbox>").replaceAll(devicetree, "<base>").replaceAll(linux, "<linux>");
}

const failure = (error) => normalize((error.stderr?.toString() || error.message || String(error)).trim()).slice(0, 500);

function preprocess(input, output) {
  const result = spawnSync("cpp", [...PREPROCESS, "-I", join(linux, "include"), "-o", output, input], { encoding: "utf8" });
  if (result.status !== 0) return { error: normalize(result.stderr.trim()).slice(0, 500) };
  return { text: readFileSync(output, "utf8") };
}

// The processed schema is built once per run (it follows the bundled dt-schema), meanwhile the overlays parse.
const schema_ready = (async () => {
  mkdirSync(cache, { recursive: true });
  const temporary = `${processed_schema}.${process.pid}.tmp`;
  try {
    await run_tool(join(tools, "dt-mk-schema"), ["-j", "-o", temporary, join(linux, "Documentation/devicetree/bindings")], { maxBuffer: 64 * 1024 * 1024 });
    if (!existsSync(temporary) || statSync(temporary).size === 0) return "dt-mk-schema produced no output";
    renameSync(temporary, processed_schema);
    return undefined;
  } catch (error) {
    return `dt-mk-schema failed: ${failure(error)}`;
  } finally {
    rmSync(temporary, { force: true });
  }
})();

const base = preprocess(devicetree, join(work, "base.dts"));
if (base.error !== undefined) {
  console.error(`preprocessing ${devicetree} failed:\n${base.error}`);
  process.exit(2);
}
// A fresh base per overlay, so one overlay's parse can't leak into the next.
function base_tree() {
  const tree = DeviceTree.new_from_string(base.text);
  if (typeof tree === "string") {
    console.error(`${devicetree} does not parse after preprocessing: ${tree}`);
    process.exit(2);
  }
  return tree;
}

// bigints (reg addresses, chip selects) are not JSON
const replacer = (_key, value) => (typeof value === "bigint" ? `0x${value.toString(16)}` : value);
const key = (entry) => `${(entry.path ?? []).join("/")}: ${entry.message}`;
const by_key = (a, b) => key(a).localeCompare(key(b));

// What import reports: the fragments whose target the base lacks, and the references that resolve to nothing (a
// reference named twice in a property once).
function parse_result(tree, dropped_overrides) {
  const fragments = tree.get_fragments();
  const targets = unresolved_targets(tree).map(({ fragment, target }) => {
    const node = fragments[fragment];
    const by_path = node?.properties.some((p) => p.name === "target") !== true;
    return { fragment: node === undefined ? `fragment ${fragment}` : get_full_node_name(node), property: by_path ? "target-path" : "target", target: target.replace(/^&/, "") };
  });
  const seen = new Set();
  const references = unresolved_references(tree).filter(({ path, property, reference }) => {
    const id = `${path}\u0000${property}\u0000${reference}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return {
    ok: true,
    dropped_overrides,
    unresolved_targets: targets,
    unresolved: references.map((u) => ({ path: u.path.split("/").filter(Boolean), property: u.property, reference: u.reference })),
  };
}

// The clashes validate warns about: those the overlay is part of (a base-only clash is left out).
function reg_result(tree) {
  return {
    conflicts: reg_conflicts(tree).filter((conflict) => conflict.in_overlay.some(Boolean)),
    chip_select_overflows: chip_select_overflows(tree).filter((overflow) => overflow.in_overlay),
  };
}

// dt-validate's diagnostics as validate maps them: the path is the stand-in tree's node and the property path, the
// message without the `<dtb>: ` prefix.
async function validate(name, tree) {
  const dts = join(work, `${name}.validate.dts`);
  const dtb = join(work, `${name}.dtb`);
  const json = join(work, `${name}.errors.json`);
  writeFileSync(dts, build_validation_dts(tree));
  try {
    await run_tool(join(tools, "dtc"), ["-I", "dts", "-O", "dtb", "-o", dtb, dts]);
  } catch (error) {
    return { crash: true, message: `dtc: ${failure(error)}` };
  }
  const schema_error = await schema_ready;
  if (schema_error !== undefined) return { crash: true, message: schema_error };
  try {
    // exits non-zero when there are errors: only a missing output file is a failure
    await run_tool(join(tools, "dt-validate"), ["-s", processed_schema, dtb, "--json-output", json], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (!existsSync(json)) return { crash: true, message: `dt-validate: ${failure(error)}` };
  }
  let diagnostics;
  try {
    diagnostics = JSON.parse(readFileSync(json, "utf8"));
  } catch (error) {
    return { crash: true, message: `dt-validate output unreadable: ${failure(error)}` };
  }
  if (!Array.isArray(diagnostics)) return { crash: true, message: "dt-validate output unreadable: not an array" };
  const errors = [];
  const warnings = [];
  for (const d of diagnostics) {
    const node = typeof d.node === "string" ? d.node.split("/").filter(Boolean) : [];
    const property = Array.isArray(d.property_path) ? d.property_path.map(String) : [];
    const message = normalize((d.formatted ?? d.message ?? "Unknown error").replaceAll(`${dtb}: `, ""));
    (d.level === "warning" ? warnings : errors).push({ path: [...node, ...property], message });
  }
  return { errors: errors.sort(by_key), warnings: warnings.sort(by_key) };
}

async function snapshot(file) {
  const name = file.replace(/-overlay\.dts$/, "");
  const source = preprocess(join(overlays_dir, file), join(work, `${name}.dts`));
  if (source.error !== undefined) return { parse: { ok: false, crash: false, message: `preprocess: ${source.error}` } };

  let parsed;
  let parse;
  try {
    parsed = DeviceTreeOverlay.new_from_string(source.text, base_tree());
    if (typeof parsed === "string") return { parse: { ok: false, crash: false, message: normalize(parsed).slice(0, 500) } };
    parse = parse_result(parsed, parsed.remove_root_node("__overrides__"));
  } catch (error) {
    return { parse: { ok: false, crash: true, message: normalize(String(error?.stack ?? error)).slice(0, 500) } };
  }

  // validate reads the overlay back from the workfile import wrote
  let workfile;
  let reg;
  try {
    workfile = DeviceTreeOverlay.new_from_string(parsed.print({ syntax: "fragment" }), base_tree());
    if (typeof workfile === "string") return { parse, validate: { crash: true, message: `the printed overlay does not parse: ${normalize(workfile).slice(0, 500)}` } };
    reg = reg_result(workfile);
  } catch (error) {
    return { parse, validate: { crash: true, message: normalize(String(error?.stack ?? error)).slice(0, 500) } };
  }
  return { parse, validate: await validate(name, workfile), reg };
}

const files = readdirSync(overlays_dir).filter((f) => f.endsWith("-overlay.dts") && f.includes(filter)).sort();
const out = mode === "run" ? baseline : mkdtempSync(join(tmpdir(), "attach-corpus-out-"));
mkdirSync(out, { recursive: true });
const jobs = Math.max(1, Number(process.env.CORPUS_JOBS ?? Math.min(8, availableParallelism() - 1)));
const started = Date.now();
let next = 0;
let done = 0;
await Promise.all(Array.from({ length: jobs }, async () => {
  while (next < files.length) {
    const file = files[next++];
    const result = await snapshot(file);
    writeFileSync(join(out, file.replace(/-overlay\.dts$/, ".json")), JSON.stringify(result, replacer, 2) + "\n");
    if (process.stderr.isTTY) process.stderr.write(`\r${++done}/${files.length} ${file}\x1B[K`);
  }
}));
if (process.stderr.isTTY) process.stderr.write("\r\x1B[K");

// totals over what this run wrote
const snapshots = files.map((file) => JSON.parse(readFileSync(join(out, file.replace(/-overlay\.dts$/, ".json")), "utf8")));
const count = (test) => snapshots.filter(test).length;
console.log(
  `${files.length} overlays in ${Math.round((Date.now() - started) / 1000)} s: ${count((s) => s.parse.ok)} parsed, ` +
    `${count((s) => s.parse.crash || s.validate?.crash)} crashed, ${count((s) => s.validate?.errors?.length > 0)} with errors, ` +
    `${count((s) => s.validate?.warnings?.length > 0 || s.reg?.conflicts.length > 0 || s.reg?.chip_select_overflows.length > 0)} with warnings or reg clashes`,
);

if (mode === "run") {
  console.log(`wrote ${files.length} snapshots to ${baseline}`);
  process.exit(0);
}

// diff: group what changed against the committed snapshots
const groups = { crashes: [], "new errors": [], "removed errors": [], "changed parse": [], "changed warnings": [], "no baseline": [] };
for (const [index, file] of files.entries()) {
  const name = file.replace(/-overlay\.dts$/, "");
  const old_path = join(baseline, `${name}.json`);
  const now = snapshots[index];
  if (now.validate?.crash || now.parse.crash) groups.crashes.push(`${name}: ${now.validate?.message ?? now.parse.message}`);
  if (!existsSync(old_path)) {
    groups["no baseline"].push(name);
    continue;
  }
  const old = JSON.parse(readFileSync(old_path, "utf8"));
  const before = new Set((old.validate?.errors ?? []).map(key));
  const after = new Set((now.validate?.errors ?? []).map(key));
  for (const k of after) if (!before.has(k)) groups["new errors"].push(`${name}: ${k.split("\n")[0]}`);
  for (const k of before) if (!after.has(k)) groups["removed errors"].push(`${name}: ${k.split("\n")[0]}`);
  if (JSON.stringify(old.parse) !== JSON.stringify(now.parse)) groups["changed parse"].push(name);
  if (JSON.stringify([old.validate?.warnings, old.reg]) !== JSON.stringify([now.validate?.warnings, now.reg])) groups["changed warnings"].push(name);
}
let changed = false;
for (const [title, rows] of Object.entries(groups)) {
  if (rows.length === 0) continue;
  if (title !== "removed errors" && title !== "no baseline") changed = true;
  console.log(`\n${title} (${rows.length})`);
  for (const row of rows.slice(0, 50)) console.log(`  ${row}`);
  if (rows.length > 50) console.log(`  … ${rows.length - 50} more`);
}
if (changed || groups["removed errors"].length > 0) console.log(`\nfull snapshots in ${out}`);
if (!changed) console.log("corpus: no regressions");
process.exit(changed ? 1 : 0);
