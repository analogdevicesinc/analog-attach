#!/usr/bin/env node
// Regression corpus: import and validate every Raspberry Pi overlay of a Linux
// tree through the built CLI and keep normalized JSON snapshots.
//
//   node scripts/corpus.mjs run  [filter]   write snapshots to corpus-snapshots/
//   node scripts/corpus.mjs diff [filter]   run into a temp dir, compare with corpus-snapshots/
//
// The Linux tree is fetched, not taken from the machine: a shallow, sparse
// checkout of LINUX_COMMIT (see below) into the cache directory, reused by later
// runs. The base is that tree's own bcm2711-rpi-4-b.dts, preprocessed by the CLI.
// To move the corpus to another kernel, change LINUX_COMMIT and rerun `run`.
//
// filter  substring of the overlay file name, to run a subset
// CORPUS_CACHE  where the checkout goes (default $XDG_CACHE_HOME/attach-corpus)
//
// Build first (`yarn workspace attach-linux build`): this runs dist/cli.js.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist/cli.js");
const baseline = join(root, "corpus-snapshots");
const LINUX_URL = "https://github.com/analogdevicesinc/linux";
const LINUX_COMMIT = "16bea53d3413344f5561b1fc45b90699239b55bb"; // rpi-6.12.y, 2026-09-30
const LINUX_PATHS = ["arch/arm/boot/dts/broadcom", "arch/arm/boot/dts/overlays", "include", "Documentation/devicetree/bindings"];
const cache = process.env.CORPUS_CACHE ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "attach-corpus");
const linux = join(cache, `linux-${LINUX_COMMIT.slice(0, 12)}`);
const devicetree = join(linux, "arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts");
const overlays_dir = join(linux, "arch/arm/boot/dts/overlays");

function git(...args) {
  const result = spawnSync("git", args, { cwd: linux, stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) {
    console.error(`git ${args.join(" ")} failed`);
    process.exit(2);
  }
}

// Shallow (one commit, no tags, blobs on demand), sparse (only what the CLI reads).
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
if (!existsSync(cli)) {
  console.error(`missing CLI (build it first): ${cli}`);
  process.exit(2);
}
fetch_linux();
for (const [what, path] of [["Linux overlays", overlays_dir], ["base devicetree", devicetree]]) {
  if (!existsSync(path)) {
    console.error(`missing ${what}: ${path}`);
    process.exit(2);
  }
}

// One sandbox for the whole run, so the compiled binding schemas (30 s) are built once.
const sandbox = mkdtempSync(join(tmpdir(), "attach-corpus-"));
const env = { ...process.env, ATTACH_LINUX: linux, ATTACH_DEVICETREE: devicetree };

function normalize(text) {
  return text.replaceAll(sandbox, "<sandbox>").replaceAll(devicetree, "<base>").replaceAll(linux, "<linux>");
}

function run(args) {
  const result = spawnSync("node", [cli, "--json", ...args], { cwd: sandbox, env, encoding: "utf8", timeout: 300_000 });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // not JSON: reported as a crash below
  }
  return { status: result.status, json, stderr: result.stderr };
}

const key = (error) => `${(error.path ?? []).join("/")}: ${error.message}`;

function snapshot(file) {
  const imported = run(["import", file]);
  if (!imported.json?.ok) {
    return { import: { ok: false, crash: imported.json === null, message: imported.json?.message ?? normalize(imported.stderr).slice(0, 500) } };
  }
  const validated = run(["validate"]);
  const result = {
    import: { ok: true, fit: imported.json.fit, unresolved_targets: imported.json.unresolved_targets, unresolved: imported.json.unresolved },
  };
  if (validated.json === null || !Array.isArray(validated.json.errors)) {
    result.validate = { crash: true, message: normalize(validated.stderr || validated.stdout).slice(0, 500) };
  } else {
    result.validate = {
      errors: validated.json.errors.map((e) => ({ path: e.path, message: e.message })).sort((a, b) => key(a).localeCompare(key(b))),
      warnings: (validated.json.warnings ?? []).map((w) => (typeof w === "string" ? w : JSON.stringify(w))).sort(),
    };
  }
  return JSON.parse(normalize(JSON.stringify(result)));
}

const files = readdirSync(overlays_dir).filter((f) => f.endsWith("-overlay.dts") && f.includes(filter)).sort();
const out = mode === "run" ? baseline : mkdtempSync(join(tmpdir(), "attach-corpus-out-"));
mkdirSync(out, { recursive: true });
files.forEach((file, i) => {
  process.stderr.write(`\r${i + 1}/${files.length} ${file}\x1b[K`);
  writeFileSync(join(out, file.replace(/-overlay\.dts$/, ".json")), JSON.stringify(snapshot(file), null, 2) + "\n");
});
process.stderr.write("\n");
rmSync(sandbox, { recursive: true, force: true });

if (mode === "run") {
  console.log(`wrote ${files.length} snapshots to ${baseline}`);
  process.exit(0);
}

// diff: group what changed against the committed snapshots
const groups = { crashes: [], "new errors": [], "removed errors": [], "changed import": [], "no baseline": [] };
for (const file of files) {
  const name = file.replace(/-overlay\.dts$/, "");
  const old_path = join(baseline, `${name}.json`);
  const now = JSON.parse(readFileSync(join(out, `${name}.json`), "utf8"));
  if (now.validate?.crash || now.import.crash) groups.crashes.push(`${name}: ${now.validate?.message ?? now.import.message}`);
  if (!existsSync(old_path)) {
    groups["no baseline"].push(name);
    continue;
  }
  const old = JSON.parse(readFileSync(old_path, "utf8"));
  const before = new Set((old.validate?.errors ?? []).map(key));
  const after = new Set((now.validate?.errors ?? []).map(key));
  for (const k of after) if (!before.has(k)) groups["new errors"].push(`${name}: ${k.split("\n")[0]}`);
  for (const k of before) if (!after.has(k)) groups["removed errors"].push(`${name}: ${k.split("\n")[0]}`);
  if (JSON.stringify(old.import) !== JSON.stringify(now.import)) groups["changed import"].push(name);
}
let changed = false;
for (const [title, rows] of Object.entries(groups)) {
  if (rows.length === 0) continue;
  if (title !== "removed errors" && title !== "no baseline") changed = true;
  console.log(`\n${title} (${rows.length})`);
  for (const row of rows.slice(0, 50)) console.log(`  ${row}`);
  if (rows.length > 50) console.log(`  … ${rows.length - 50} more (full snapshots in ${out})`);
}
if (!changed) console.log("corpus: no regressions");
process.exit(changed ? 1 : 0);
