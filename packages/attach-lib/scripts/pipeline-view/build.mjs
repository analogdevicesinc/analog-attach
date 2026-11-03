#!/usr/bin/env node
// Write an interactive HTML view of what the pipeline does to bindings: for each property, every step (stage, fixup
// pass, fixup, translate) with what it changed, its summary and its dt-schema counterpart. One self-contained file
// (no network), view.html / view.css / view.js with scripts/pipeline-diff.mjs and the traces inlined.
//   yarn pipeline:view <binding path under Documentation/devicetree/bindings>... [-o <file.html>]
//   (or node scripts/pipeline-view/build.mjs [--open] ..., after yarn build)
// -o defaults to pipeline-view.html; --open (which yarn pipeline:view passes) opens it in the default browser. Reads dist/ (yarn pipeline:view builds it first) and test/linux, test/dt-schema; the processed
// schema of test/linux (scripts/processed-schema.mjs) if there is one.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPair, isScalar, parseDocument } from "yaml";
import { STEP_INFO, STEP_TREE, overview, targets, timeline, trace_binding } from "../pipeline-trace.mjs";
import { schema_paths } from "../processed-schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const bindings = join(root, "test/linux/Documentation/devicetree/bindings");

const args = process.argv.slice(2);
const open = args.includes("--open") && args.splice(args.indexOf("--open"), 1).length === 1;
const out_at = args.indexOf("-o");
const out = resolve(out_at === -1 ? "pipeline-view.html" : args.splice(out_at, 2)[1]);
if (args.length === 0) {
  console.error("usage: build.mjs [--open] <binding>... [-o <file.html>]");
  process.exit(2);
}

/** The lines of the YAML file that hold the schema at `pointer` (its key's line included), dedented; or undefined. */
function source_lines(text, document, pointer) {
  if (pointer.length === 0) { return undefined; }
  const parent = document.getIn(pointer.slice(0, -1), true);
  const pair = parent?.items?.find((item) => isPair(item) && isScalar(item.key) && String(item.key.value) === pointer.at(-1));
  if (pair?.key?.range === undefined) { return undefined; }
  const start = text.lastIndexOf("\n", pair.key.range[0]) + 1;
  const end = pair.value?.range?.[2] ?? pair.key.range[2];
  const lines = text.slice(start, end).trimEnd().split("\n");
  const indent = Math.min(...lines.filter((line) => line.trim() !== "").map((line) => line.length - line.trimStart().length));
  return lines.map((line) => line.slice(indent)).join("\n");
}

/** `property`, `child` (a property of a child-node pattern), `nodes` (a pattern with them) or `pattern` (one naming properties). */
function kind_of(pointer, all) {
  if (pointer[0] === "properties") { return "property"; }
  if (pointer.length > 2) { return "child"; }
  return all.some((other) => other.pointer.length > 2 && other.pointer[1] === pointer[1]) ? "nodes" : "pattern";
}

async function view_of(file) {
  const trace = await trace_binding(join(bindings, file), schema_paths(join(root, "test/linux"), join(root, "test/dt-schema")));
  const document = parseDocument(trace.source_text);
  const references = trace.events.find((event) => event.kind === "stage" && event.stage === "references");
  return {
    file,
    error: trace.result.kind === "error" ? trace.result.error : undefined,
    refs: references?.refs ?? [],
    overview: overview(trace),
    targets: targets(trace).map(({ pointer, label }, _index, all) => ({
      pointer, label, kind: kind_of(pointer, all),
      source: source_lines(trace.source_text, document, pointer),
      // Only the steps that changed it, and an error; the view puts the others in from STEP_TREE
      timeline: timeline(trace, pointer).filter((entry) => entry.changed || entry.error !== undefined),
    })),
  };
}

const missing = args.filter((file) => !existsSync(join(bindings, file)));
if (missing.length > 0) {
  console.error(`no such binding under ${bindings}: ${missing.join(", ")}`);
  process.exit(2);
}

const views = [];
for (const file of args) {
  const view = await view_of(file);
  console.error(`${file}: ${view.targets.length} properties${view.error === undefined ? "" : `, fails at ${view.error.stage}`}`);
  views.push(view);
}

const data = {
  steps: STEP_TREE,
  info: Object.fromEntries(STEP_INFO),
  views,
};

// Bigints as "<n>n" (format_value prints them as numbers); `</` escaped so no value ends the script
const json = JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? `${value}n` : value)).replaceAll("</", "<\\/");

// pipeline-diff.mjs in a scope of its own, returning what it exports; view.js's import of it a destructuring of that
const diff_code = readFileSync(join(here, "../pipeline-diff.mjs"), "utf8");
const exported = [...diff_code.matchAll(/^export (?:function|const) (\w+)/gm)].map((match) => match[1]);
const diff_module = `const PIPELINE_DIFF = (() => {\n${diff_code.replaceAll(/^export /gm, "")}\nreturn { ${exported.join(", ")} };\n})();`;
const view_code = readFileSync(join(here, "view.js"), "utf8")
  .replace(/^import (\{[^}]*\}) from "\.\.\/pipeline-diff\.mjs";$/m, "const $1 = PIPELINE_DIFF;");

const html = readFileSync(join(here, "view.html"), "utf8")
  .replace("/* STYLE */", () => readFileSync(join(here, "view.css"), "utf8"))
  .replace("/* SCRIPT */", () => [`const DATA = ${json};`, diff_module, view_code].join("\n"));

writeFileSync(out, html);
console.error(`wrote ${out} (${Math.round(html.length / 1024)} KiB)`);

if (open) {
  // The desktop's opener: the default browser for an .html file
  const [command, ...command_args] = { darwin: ["open"], win32: ["cmd", "/c", "start", ""] }[process.platform] ?? ["xdg-open"];
  const opener = spawn(command, [...command_args, out], { detached: true, stdio: "ignore" });
  opener.on("error", () => { console.error(`couldn't run ${command}: open ${out} yourself`); });
  opener.unref();
}
