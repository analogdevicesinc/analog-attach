#!/usr/bin/env node
// Print what each step of the pipeline (references → ... → fixups, each fixup of a walk → translate) did to one
// property of a binding, as a diff from the step before; with no property, which properties each step changed.
//   node scripts/repros/stages.mjs <binding path under Documentation/devicetree/bindings> [property] [--pattern <regex>] [--all] [--full] [--markdown]
// --pattern follows a patternProperties entry (with a property: that property of the child node it names).
// --all lists the steps that changed nothing too, --full doesn't cut long values, --markdown writes a walkthrough.
// Reads dist/ (yarn build first) and test/linux, test/dt-schema; the processed schema of test/linux (scripts/processed-schema.mjs) if there is one.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { format_pointer, format_value } from "../pipeline-diff.mjs";
import { FIXUP_ORDER, STEP_INFO, overview, timeline, trace_binding } from "../pipeline-trace.mjs";
import { schema_paths } from "../processed-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name) && args.splice(args.indexOf(name), 1).length === 1;
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const all = flag("--all");
const full = flag("--full");
const markdown = flag("--markdown");
const pattern = option("--pattern");
const [file, property] = args;
if (file === undefined) {
  console.error("usage: stages.mjs <binding> [property] [--pattern <regex>] [--all] [--full] [--markdown]");
  process.exit(2);
}

const pointer = pattern === undefined
  ? (property === undefined ? [] : ["properties", property])
  : ["patternProperties", pattern, ...(property === undefined ? [] : ["properties", property])];

const trace = await trace_binding(
  join(root, "test/linux/Documentation/devicetree/bindings", file),
  schema_paths(join(root, "test/linux"), join(root, "test/dt-schema")),
);

const color = !markdown && process.stdout.isTTY;
const paint = (code) => (text) => (color ? `\u001B[${code}m${text}\u001B[0m` : text);
const [green, red, yellow, dim, bold] = [paint(32), paint(31), paint(33), paint(2), paint(1)];
const width = full ? 0 : 120;
const MAX_LINES = 40;

const title = (key) => key.split(".").join(" › ");
const info = (key) => STEP_INFO.get(key) ?? (key.endsWith(".shared")
  ? { summary: "Changed through an object the schema shares with another (one `types.yaml` definition under many properties), by a fixup of that one." }
  : { summary: "" });

const cut = (lines) => (full || lines.length <= MAX_LINES ? lines : [...lines.slice(0, MAX_LINES), `… ${lines.length - MAX_LINES} more lines (--full)`]);

/** A whole value, as indented lines (JSON, bigints as numbers), cut at MAX_LINES unless --full. */
const block = (value) => cut(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? `${item}n` : item), 2)
  .replaceAll(/"(-?\d+)n"/g, "$1").split("\n"));

/** A diff (`pipeline-diff.mjs`) as lines: `+` added, `-` removed, a change as both, or `~` when the text is coloured. */
function diff_lines(changes) {
  return changes.flatMap(({ op, pointer: at, before, after }) => {
    const where = format_pointer(at);
    if (op === "add" && at.length === 0) { return block(after).map((line) => green(`+ ${line}`)); }
    if (op === "add") { return [green(`+ ${where}: ${format_value(after, width)}`)]; }
    if (op === "remove") { return [red(`- ${where}: ${format_value(before, width)}`)]; }
    if (color) { return [yellow(`~ ${where}: ${format_value(before, width)} → ${format_value(after, width)}`)]; }
    return [`- ${where}: ${format_value(before, width)}`, `+ ${where}: ${format_value(after, width)}`];
  });
}

const out = [];
const print = (line = "") => out.push(line);

if (pointer.length === 0) {
  // The whole binding: which properties each step changed
  const heading = `Steps of ${file}`;
  if (markdown) { print(`## ${heading}`); print(); print("| step | properties it changed |"); print("| --- | --- |"); } else { print(bold(heading)); }
  for (const { key, names } of overview(trace)) {
    if (names.length === 0 && !all) { continue; }
    const shown = names.length > 12 && !full ? `${names.slice(0, 12).join(", ")}, … ${names.length - 12} more` : names.join(", ");
    if (markdown) { print(`| ${title(key)} | ${shown.replaceAll("|", "\\|") || "—"} |`); } else { print(`${title(key).padEnd(40)} ${names.length === 0 ? dim("(none)") : shown}`); }
  }
} else {
  const entries = timeline(trace, pointer);
  const name = property ?? pattern;
  const heading = `${pattern !== undefined && property !== undefined ? `${pattern} › ${property}` : name} in ${file}`;
  if (markdown) { print(`## \`${heading.replace(" in ", "` in `")}\``); print(); } else { print(bold(heading)); print(); }

  const seen = new Set(entries.map((entry) => entry.key));
  for (const entry of entries) {
    if (entry.error !== undefined) {
      print(markdown ? `**${title(entry.key)} failed:** ${entry.error}` : red(`✗ ${title(entry.key)}: ${entry.error}`));
      continue;
    }
    if (!entry.changed && !all) { continue; }

    const { summary, counterpart } = info(entry.key);
    const where = entry.at !== undefined && entry.at.length > 0 ? ` (at ${format_pointer(entry.at)})` : "";
    const ported = counterpart === undefined ? "" : ` [dt-schema ${counterpart}]`;

    if (markdown) {
      print(`### ${title(entry.key)}${where}`);
      print();
      if (summary !== "") { print(`${summary}${counterpart === undefined ? "" : ` (dt-schema \`${counterpart}\`)`}`); print(); }
    } else {
      print(`${entry.changed ? bold(title(entry.key)) : dim(`· ${title(entry.key)}`)}${where}${dim(ported)}`);
      if (summary !== "") { print(dim(`  ${summary}`)); }
    }
    if (!entry.changed) { continue; }

    let lines;
    let language = "diff";
    if (entry.key === "source") {
      lines = cut(stringify(entry.value).trimEnd().split("\n"));
      language = "yaml";
    } else if (entry.key === "translate" || entry.key === "vendor-filter") {
      lines = entry.key === "translate" ? block(entry.value) : diff_lines(entry.changes);
      language = entry.key === "translate" ? "json" : "diff";
    } else {
      lines = diff_lines(entry.changes);
    }

    if (markdown) {
      print(`\`\`\`${language}`);
      for (const line of lines) { print(line); }
      print("```");
    } else {
      for (const line of lines) { print(`  ${line}`); }
    }
    print();
  }

  if (entries[0]?.changed === false) {
    print(markdown ? "_Not in the binding's own file: it comes from a schema it references._" : dim("(not in the binding's own file: it comes from a schema it references)"));
  }
  if (all) {
    // The fixups of a walk that changed nothing of it
    const quiet = FIXUP_ORDER.filter((key) => !seen.has(key));
    print(markdown ? `Fixups that changed nothing of it: ${quiet.map((key) => `\`${key.split(".")[2]}\``).join(", ")}.` : dim(`fixups that changed nothing of it: ${quiet.map((key) => key.split(".")[2]).join(", ")}`));
  }
}

if (trace.result.kind === "error") {
  const { stage, message } = trace.result.error;
  if (pointer.length === 0) { print(markdown ? `**${stage} failed:** ${message}` : red(`✗ ${stage}: ${message}`)); }
  process.exitCode = 1;
}
console.log(out.join("\n").trimEnd());
