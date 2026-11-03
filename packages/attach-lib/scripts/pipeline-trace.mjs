// The trace of one binding through Attach.parse (ParseOptions.trace), and what it says of one schema in it: the
// steps that changed it, and how. Used by scripts/repros/stages.mjs and scripts/pipeline-view/build.mjs.
// Reads dist/ (yarn build first).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { diff, equal, get, set } from "./pipeline-diff.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { Attach, PARSE_STEPS, Result, fixup_passes } = await import(join(root, "dist/index.js"));

const PASSES = fixup_passes({ names: new Map(), patterns: [] });

/** Each step's `{ id, summary, counterpart? }` by its key: a stage's id, `fixups.<pass>`, `fixups.<pass>.<fixup>`. */
export const STEP_INFO = new Map([
  ["source", { id: "source", summary: "The binding as its YAML file has it." }],
  ...PARSE_STEPS.map((step) => [step.id, step]),
  ...PASSES.map((pass) => [`fixups.${pass.id}`, pass]),
  ...PASSES.flatMap((pass) => pass.kind === "walk"
    ? [...pass.node, ...pass.property].map((fixup) => [`fixups.${pass.id}.${fixup.id}`, fixup])
    : []),
]);

/** The stages, passes and fixups as a tree, in the order they run: `{ key, kind, children? }`. */
export const STEP_TREE = [
  { key: "source", kind: "source" },
  ...PARSE_STEPS.map((step) => step.id === "fixups"
    ? {
      key: "fixups", kind: "stage", children: PASSES.map((pass) => ({
        key: `fixups.${pass.id}`, kind: pass.kind,
        ...(pass.kind === "walk"
          ? { children: [...pass.node, ...pass.property].map((fixup) => ({ key: `fixups.${pass.id}.${fixup.id}`, kind: "fixup" })) }
          : {}),
      })),
    }
    : { key: step.id, kind: step.id === "translate" || step.id === "vendor-filter" ? "translated" : "stage" }),
];

const FIXUP_ORDER = STEP_TREE.flatMap(function keys(node) { return [node.key, ...(node.children ?? []).flatMap(keys)]; })
  .filter((key) => key.split(".").length === 3);

export { FIXUP_ORDER };

/** Parses `file` with a tracer: `{ file, source_text, source, events, result }`; `result` an `Attach.parse` Result. */
export async function trace_binding(file, paths, options = {}) {
  const source_text = readFileSync(file, "utf8");
  const events = [];
  const result = await Attach.parse(file, paths, { ...options, trace: (event) => events.push(event) });
  return { file, source_text, source: parse(source_text), events, result: Result.is_err(result) ? result : Result.Ok(result.value.parsed_binding) };
}

const starts_with = (pointer, prefix) => prefix.length <= pointer.length && prefix.every((key, index) => pointer[index] === key);

/** The `ParsedBinding` entry for a schema pointer: a property, a pattern, or a property of a child-node pattern. */
export function parsed_entry(binding, pointer) {
  const [table, name, sub, sub_name] = pointer;
  if (table === "properties" && pointer.length === 2) {
    return binding.properties.find((property) => property.key === name);
  }
  if (table === "patternProperties") {
    const rule = binding.pattern_properties?.find((pattern) => pattern.pattern === name);
    if (pointer.length === 2) { return rule ?? binding.property_patterns?.find((pattern) => pattern.pattern === name); }
    if (sub === "properties" && pointer.length === 4) { return rule?.properties.find((property) => property.key === sub_name); }
  }
  return undefined;
}

/**
 * What each step made of the schema at `pointer` (`[]`: the whole binding), in the order they ran: entries
 * `{ key, value, changes, changed }`, `value` the schema after the step and `changes` the diff (`pipeline-diff.mjs`)
 * from the one before, its pointers under `pointer`. A walk pass has an entry per fixup event that reached the
 * schema (one at a `oneOf` branch says so in its pointers), then, if the pass changed more than they did, one
 * `fixups.<pass>.shared`: a change made through an object the schema shares with another. `translate` and
 * `vendor-filter` give the `ParsedBinding` entry (`parsed_entry`) as their `value`. A stage the binding failed at
 * ends the list with `{ key, error }`.
 */
export function timeline(trace, pointer) {
  const { events, source, result } = trace;
  const entries = [];
  let state = get(source, pointer);
  entries.push({ key: "source", value: state, changes: [], changed: state !== undefined });

  const step = (key, value) => {
    const changes = diff(state, value);
    entries.push({ key, value, changes, changed: changes.length > 0 });
    state = value;
  };

  let replay = structuredClone(state);
  let parsed;
  for (const event of events) {
    if (event.kind === "stage") {
      // The fixups stage ends with what its last pass gave: its passes are its steps
      if (event.stage !== "fixups") { step(event.stage, get(event.schema, pointer)); }
    } else if (event.kind === "fixup") {
      const fixup_entry = fixup_change(event, pointer, replay);
      if (fixup_entry !== undefined) {
        if (fixup_entry.unexplained.length > 0) {
          entries.push({ key: `fixups.${event.pass}.shared`, value: structuredClone(fixup_entry.known), changes: fixup_entry.unexplained, changed: true });
        }
        replay = fixup_entry.replay;
        entries.push({ key: `fixups.${event.pass}.${event.fixup}`, value: structuredClone(replay), changes: fixup_entry.changes, changed: true, at: event.pointer.slice(pointer.length) });
      }
    } else if (event.kind === "pass") {
      const value = get(event.schema, pointer);
      const pass = PASSES.find((candidate) => candidate.id === event.pass);
      if (pass.kind === "walk") {
        const shared = diff(replay, value);
        if (shared.length > 0) { entries.push({ key: `fixups.${event.pass}.shared`, value, changes: shared, changed: true }); }
        state = value;
      } else {
        step(`fixups.${event.pass}`, value);
      }
      replay = structuredClone(state);
    } else if (event.kind === "translated") {
      const entry = pointer.length === 0 ? event.binding : parsed_entry(event.binding, pointer);
      const value = entry?.value ?? entry;
      const changes = diff(parsed, value);
      entries.push({ key: event.step, value, changes, changed: changes.length > 0 });
      parsed = value;
    }
    if (event.kind === "stage" && event.stage !== "fixups") { replay = structuredClone(state); }
  }

  if (Result.is_err(result)) { entries.push({ key: result.error.stage, error: result.error.message }); }
  return entries;
}

/**
 * What a fixup event changed of the schema at `pointer`, applied to `replay` (that schema so far), or undefined.
 * `unexplained` is how the schema the fixup was given differs from `replay`, which the events so far made of it:
 * what changed it before without an event for it (`known` is `replay` with those changes).
 */
function fixup_change(event, pointer, replay) {
  if (starts_with(event.pointer, pointer)) {
    // The schema itself or one under it (a `oneOf` branch, a property of a node)
    const at = event.pointer.slice(pointer.length);
    const changes = diff(event.before, event.after, at);
    if (changes.length === 0) { return undefined; }
    const unexplained = diff(get(replay, at), event.before, at);
    const known = set(structuredClone(replay), at, structuredClone(event.before));
    return { changes, unexplained, known, replay: set(replay, at, structuredClone(event.after)) };
  }
  if (starts_with(pointer, event.pointer)) {
    // A node fixup of a node the schema is in
    const at = pointer.slice(event.pointer.length);
    const before = get(event.before, at);
    const after = get(event.after, at);
    if (equal(before, after)) { return undefined; }
    return { changes: diff(before, after), unexplained: diff(replay, before), known: structuredClone(before), replay: structuredClone(after) };
  }
  return undefined;
}

/**
 * The schemas a trace can follow: each property, pattern, and property of a child-node pattern the binding has at
 * any step (one a step removes too), as `{ pointer, label }`.
 */
export function targets(trace) {
  const schemas = [trace.source, ...trace.events.filter((event) => event.kind === "stage").map((event) => event.schema)];
  const found = new Map();
  const add = (pointer, label) => { found.set(JSON.stringify(pointer), { pointer, label }); };

  for (const schema of schemas) {
    for (const name of Object.keys(schema?.properties ?? {})) { add(["properties", name], name); }
    for (const [pattern, sub] of Object.entries(schema?.patternProperties ?? {})) {
      add(["patternProperties", pattern], pattern);
      for (const name of Object.keys(sub?.properties ?? {})) { add(["patternProperties", pattern, "properties", name], `${pattern} › ${name}`); }
    }
  }
  return [...found.values()];
}

/** For the whole binding: per step, the names of the properties it changed (`{ key, names }`), fixups per event. */
export function overview(trace) {
  const changed_names = (before, after) => {
    const names = new Set();
    for (const table of ["properties", "patternProperties"]) {
      const keys = new Set([...Object.keys(before?.[table] ?? {}), ...Object.keys(after?.[table] ?? {})]);
      for (const key of keys) {
        if (!equal(before?.[table]?.[key], after?.[table]?.[key])) { names.add(key); }
      }
    }
    return [...names];
  };

  const steps = [];
  let state = trace.source;
  const fixups = new Map();
  for (const event of trace.events) {
    if (event.kind === "fixup") {
      const key = `fixups.${event.pass}.${event.fixup}`;
      if (!fixups.has(key)) { fixups.set(key, new Set()); }
      fixups.get(key).add(event.name ?? (event.pointer.length === 0 ? "(the binding)" : event.pointer.join("/")));
    } else if ((event.kind === "stage" && event.stage !== "fixups") || event.kind === "pass") {
      // In the order they run, not that of their first change
      for (const key of FIXUP_ORDER.filter((candidate) => fixups.has(candidate))) { steps.push({ key, names: [...fixups.get(key)] }); }
      fixups.clear();
      steps.push({ key: event.kind === "stage" ? event.stage : `fixups.${event.pass}`, names: changed_names(state, event.schema) });
      state = event.schema;
    }
  }
  return steps;
}
