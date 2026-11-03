// The HTML view of the pipeline trace (build.mjs inlines this after DATA and pipeline-diff.mjs, without the imports).
// DATA: { steps: STEP_TREE, info: STEP_INFO by key, views: [{ file, error?, refs, overview, targets }] }, a target
// being { pointer, label, kind, source?, timeline } with only the entries that changed it (pipeline-trace.mjs).
import { format_pointer, format_value } from "../pipeline-diff.mjs";

/* global DATA */
const { steps: TREE, info: INFO, views: VIEWS } = DATA;
const $ = (id) => document.getElementById(id);

const state = { view: 0, target: 0, row: -1, touching: true, side: false, filter: "", tab: "steps" };

const SHARED = "Changed without a fixup event for this schema: through an object it shares with another, by that one's fixup. The trace has never shown one on the corpus, so this is worth a look.";
const PARSED_KEYS = new Set(["translate", "vendor-filter"]);

// --- text -------------------------------------------------------------------------------------------------------

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
/** A summary's `code` spans as <code>. */
const inline = (text) => escape(text).replaceAll(/`([^`]+)`/g, "<code>$1</code>");
const title_of = (key) => key.split(".").map(escape).join(" <span class=\"sep\">›</span> ");
const info_of = (key) => INFO[key] ?? (key.endsWith(".shared") ? { summary: SHARED } : { summary: "" });
/** A trace value for showing: bigints came as "<n>n". */
const shown = (value, width = 0) => format_value(value, width);

// --- rows: the steps of one target, in the order they ran ---------------------------------------------------------

/**
 * The rows of the step list for a target: `step` rows (selectable; `entry` when the step changed it, with `before`
 * and `value` the schema around it), `group` rows (a stage or a walk), `quiet` rows (the fixups of a walk that
 * changed nothing of it) and an `error` row where the binding failed.
 */
function rows_of(target) {
  const entries = target.timeline;
  const error = entries.find((entry) => entry.error !== undefined);
  const rows = [];
  const track = { schema: undefined, parsed: undefined };
  let stopped = false;

  const step_row = (key, depth, entry) => {
    const side = PARSED_KEYS.has(key) ? "parsed" : "schema";
    const before = track[side];
    const value = entry === undefined ? before : entry.value;
    track[side] = value;
    rows.push({ kind: "step", key, depth, entry, changed: entry !== undefined, before, value });
  };

  const walk = (node, depth) => {
    if (stopped) { return; }
    if (error !== undefined && node.key === error.key) {
      rows.push({ kind: "error", key: node.key, depth, error: error.error });
      stopped = true;
      return;
    }
    if (node.kind === "walk") {
      rows.push({ kind: "group", key: node.key, depth });
      const own = entries.filter((entry) => entry.key.startsWith(`${node.key}.`));
      for (const entry of own) { step_row(entry.key, depth + 1, entry); }
      const quiet = node.children.map((child) => child.key).filter((key) => !own.some((entry) => entry.key === key));
      if (quiet.length > 0) { rows.push({ kind: "quiet", key: node.key, depth: depth + 1, keys: quiet }); }
      return;
    }
    if (node.children !== undefined) {
      rows.push({ kind: "group", key: node.key, depth });
      for (const child of node.children) { walk(child, depth + 1); }
      return;
    }
    const found = entries.filter((entry) => entry.key === node.key);
    if (found.length === 0) { step_row(node.key, depth); }
    for (const entry of found) { step_row(node.key, depth, entry); }
  };
  for (const node of TREE) { walk(node, 0); }

  // A failure after the stages (`validation`) has no step of its own
  if (error !== undefined && !stopped) { rows.push({ kind: "error", key: error.key, depth: 0, error: error.error }); }
  return rows;
}

/** Which rows show: all, or (touching) the steps that changed it, the groups they are in, and the error. */
function visible(rows) {
  if (!state.touching) { return rows.map((_, index) => index); }
  const shown_rows = new Set();
  rows.forEach((row, index) => {
    if (row.kind === "error" || (row.kind === "step" && row.changed)) {
      shown_rows.add(index);
      // the groups above it
      let depth = row.depth;
      for (let at = index - 1; at >= 0 && depth > 0; at--) {
        if (rows[at].kind === "group" && rows[at].depth < depth) { shown_rows.add(at); depth = rows[at].depth; }
      }
    }
  });
  return [...shown_rows].sort((a, b) => a - b);
}

// --- the JSON tree ------------------------------------------------------------------------------------------------

const key_of = (pointer) => JSON.stringify(pointer);
const is_object = (value) => typeof value === "object" && value !== null;
const starts_with = (pointer, prefix) => prefix.length <= pointer.length && prefix.every((key, index) => pointer[index] === key);

/**
 * A value as lines of JSON, the changes marked: on the `after` side what was added (green) or changed (yellow, the
 * old value in its title), with what was removed put back struck through (red); on the `before` side what was
 * removed or changed (`ghosts: false` leaves the removed out of the after side). A subtree with nothing marked in it
 * and more than 12 lines is folded.
 */
function tree(value, changes, side, ghosts_shown = true) {
  const by_pointer = new Map(changes.map((change) => [key_of(change.pointer), change]));
  const lines = [];

  const marked_in = (pointer) => changes.some((change) => starts_with(change.pointer, pointer));
  const size = (item) => (is_object(item) ? Object.keys(item).length + 2 : 1);

  const line = (depth, html, mark = "", pointer = undefined, hint = "") => {
    const attributes = [
      `class="ln ${mark}"`,
      pointer === undefined ? "" : `data-pointer="${escape(key_of(pointer))}"`,
      hint === "" ? "" : `title="${escape(hint)}"`,
    ].join(" ");
    lines.push(`<div ${attributes} style="--depth:${depth}">${html}</div>`);
  };

  const label = (key) => (key === undefined ? "" : `<span class="k">${escape(typeof key === "number" ? "" : JSON.stringify(key))}</span>${typeof key === "number" ? "" : ": "}`);

  const node = (item, pointer, depth, key, last, inherited) => {
    const change = by_pointer.get(key_of(pointer));
    let mark = inherited;
    let hint = "";
    if (change !== undefined) {
      if (change.op === "add" && side === "after") { mark = "add"; }
      if (change.op === "remove" && side === "before") { mark = "remove"; }
      if (change.op === "change") { mark = "change"; hint = side === "after" ? `was ${shown(change.before, 200)}` : `now ${shown(change.after, 200)}`; }
    }
    const comma = last ? "" : ",";

    if (!is_object(item)) {
      line(depth, `${label(key)}<span class="v">${escape(shown(item))}</span>${comma}`, mark, pointer, hint);
      return;
    }

    const array = Array.isArray(item);
    const [open, close] = array ? ["[", "]"] : ["{", "}"];
    const children = array ? item.map((child, index) => [index, child]) : Object.entries(item);
    // What was removed from it, on the after side, goes back in struck through
    const ghosts = side === "after" && ghosts_shown
      ? changes.filter((other) => other.op === "remove" && other.pointer.length === pointer.length + 1 && starts_with(other.pointer, pointer))
      : [];

    if (children.length === 0 && ghosts.length === 0) {
      line(depth, `${label(key)}${open}${close}${comma}`, mark, pointer, hint);
      return;
    }

    const folded = mark === "" && !marked_in(pointer) && size(item) > 12 && depth > 0;
    if (folded) {
      lines.push(`<details style="--depth:${depth}"><summary class="ln" style="--depth:${depth}">${label(key)}${open}<span class="fold">… ${children.length} ${array ? "items" : "keys"}</span>${close}${comma}</summary>`);
    } else {
      line(depth, `${label(key)}${open}`, mark, pointer, hint);
    }
    children.forEach(([child_key, child], index) => {
      node(child, [...pointer, String(child_key)], depth + 1, array ? index : child_key, index === children.length - 1 && ghosts.length === 0, mark === "change" ? "" : mark);
    });
    for (const ghost of ghosts) {
      const ghost_key = ghost.pointer.at(-1);
      line(depth + 1, `${label(array ? Number(ghost_key) : ghost_key)}<span class="v">${escape(shown(ghost.before, 160))}</span>`, "remove ghost", ghost.pointer, "removed");
    }
    if (folded) {
      lines.push("</details>");
    } else {
      line(depth, `${close}${comma}`, mark);
    }
  };

  if (value === undefined) { return `<p class="none">${side === "before" ? "Nothing yet." : "Gone."}</p>`; }
  node(value, [], 0, undefined, true, "");
  return `<div class="tree">${lines.join("")}</div>`;
}

/** A diff as lines: `+` added, `-` removed, `~` changed; each points into the tree. */
function changes_list(changes) {
  if (changes.length === 0) { return "<p class=\"none\">Nothing.</p>"; }
  return `<ul class="changes">${changes.map(({ op, pointer, before, after }) => {
    const sign = { add: "+", remove: "−", change: "~" }[op];
    const what = op === "add" ? shown(after, 160) : op === "remove" ? shown(before, 160) : `${shown(before, 80)} → ${shown(after, 80)}`;
    return `<li class="${op}" data-pointer="${escape(key_of(pointer))}"><span class="sign">${sign}</span> <code class="p">${escape(format_pointer(pointer))}</code> <code>${escape(what)}</code></li>`;
  }).join("")}</ul>`;
}

// --- rendering ----------------------------------------------------------------------------------------------------

const view = () => VIEWS[state.view];
const target = () => view().targets[state.target];

function matching_targets() {
  const filter = state.filter.toLowerCase();
  return view().targets.map((item, index) => ({ item, index })).filter(({ item }) => item.label.toLowerCase().includes(filter));
}

function render_properties() {
  $("property-list").innerHTML = matching_targets().map(({ item, index }) => {
    const count = item.timeline.filter((entry) => entry.changed && !PARSED_KEYS.has(entry.key) && entry.key !== "source").length;
    const kind = { nodes: "<span class=\"badge\">nodes</span>", pattern: "<span class=\"badge\">pattern</span>" }[item.kind] ?? "";
    // A property of a child node sits under its pattern, by its own name
    const name = item.kind === "child" ? item.pointer.at(-1) : item.label;
    const classes = [index === state.target ? "selected" : "", item.kind].join(" ");
    return `<li role="option" data-index="${index}" aria-selected="${index === state.target}" class="${classes}" title="${escape(item.label)}">
      <span class="name">${escape(name)}</span>${kind}<span class="count" title="steps that change it">${count}</span></li>`;
  }).join("");
  $("property-list").querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function render_steps(rows) {
  const shown_rows = visible(rows);
  $("step-list").innerHTML = shown_rows.map((index) => {
    const row = rows[index];
    const indent = `style="--depth:${row.depth}"`;
    if (row.kind === "group") { return `<li class="group" ${indent}>${title_of(row.key.split(".").at(-1))}</li>`; }
    if (row.kind === "quiet") {
      return `<li class="quiet" ${indent}>unchanged: ${row.keys.map((key) => escape(key.split(".").at(-1))).join(", ")}</li>`;
    }
    if (row.kind === "error") { return `<li class="error" ${indent}>✗ ${escape(row.key)} failed</li>`; }
    const at = row.entry?.at?.length > 0 ? ` <span class="at">${escape(format_pointer(row.entry.at))}</span>` : "";
    const classes = [row.changed ? "changed" : "unchanged", index === state.row ? "selected" : "", row.key.endsWith(".shared") ? "shared" : ""].join(" ");
    return `<li class="${classes}" data-row="${index}" ${indent}><span class="dot">${row.changed ? "●" : "○"}</span> ${escape(row.key.split(".").at(-1))}${at}</li>`;
  }).join("");
  $("step-list").querySelector(".selected")?.scrollIntoView({ block: "nearest" });
}

function render_detail(rows) {
  const row = rows[state.row];
  const item = target();

  // What the CLI gets: the last ParsedBinding value
  const parsed_rows = rows.filter((candidate) => candidate.kind === "step" && PARSED_KEYS.has(candidate.key));
  const final = parsed_rows.at(-1);
  $("result").innerHTML = final === undefined
    ? "<p class=\"none\">The binding failed before it was translated.</p>"
    : final.value === undefined ? "<p class=\"none\">No entry: the property was dropped.</p>" : tree(final.value, [], "after");

  if (row === undefined || row.kind !== "step") {
    $("step-title").innerHTML = "";
    $("step-summary").innerHTML = "No step changes it.";
    for (const id of ["step-extra", "changes", "schema"]) { $(id).innerHTML = ""; }
    return;
  }

  const { summary, counterpart } = info_of(row.key);
  const at = row.entry?.at?.length > 0 ? ` <span class="at">at ${escape(format_pointer(row.entry.at))}</span>` : "";
  const port = row.key === "source" ? ""
    : counterpart === undefined ? "<span class=\"port ours\">attach-lib only</span>" : `<span class="port">dt-schema <code>${escape(counterpart)}</code></span>`;
  $("step-title").innerHTML = `<h2>${title_of(row.key)}${at}</h2>${port}`;
  $("changes-head").hidden = row.key === "source";
  $("side-toggle").hidden = row.key === "source";
  $("step-summary").innerHTML = inline(summary);

  $("step-extra").innerHTML = row.key === "references" && view().refs.length > 0
    ? `<details><summary>${view().refs.length} schema files it pulled in</summary><ul class="refs">${view().refs.map((ref) => `<li><code>${escape(ref)}</code></li>`).join("")}</ul></details>`
    : "";

  if (row.key === "source") {
    $("changes").innerHTML = "";
    $("schema-head").textContent = "As written";
    $("schema").innerHTML = item.source === undefined ? "<p class=\"none\">Not in the binding's own file.</p>" : `<pre class="yaml">${escape(item.source)}</pre>`;
    return;
  }

  const changes = row.entry?.changes ?? [];
  const whole = changes.length === 1 && changes[0].op === "add" && changes[0].pointer.length === 0;
  $("changes").innerHTML = !row.changed ? "<p class=\"none\">Nothing: this step leaves it as it was.</p>"
    : whole ? "<p class=\"none\">All of it: there was nothing before.</p>" : changes_list(changes);
  $("schema-head").textContent = PARSED_KEYS.has(row.key) ? "ParsedBinding entry after it" : "Schema after it";

  if (row.key === "references" && row.before === undefined) {
    $("changes").innerHTML = `<p class="none">Not in the binding's own file: it comes from a schema the binding references.</p>`;
  }

  $("schema").innerHTML = state.side
    ? `<div class="sides"><div><h3>before</h3>${tree(row.before, changes, "before")}</div><div><h3>after</h3>${tree(row.value, changes, "after", false)}</div></div>`
    : tree(row.value, changes, "after");
}

function render_overview() {
  const steps = new Map(view().overview.map((step) => [step.key, step.names]));
  const target_by_name = new Map();
  view().targets.forEach((item, index) => {
    const name = item.pointer.at(-1);
    if (!target_by_name.has(name)) { target_by_name.set(name, index); }
  });

  const chips = (names) => names.map((name) => target_by_name.has(name)
    ? `<button class="chip" data-target="${target_by_name.get(name)}">${escape(name)}</button>`
    : `<span class="chip plain">${escape(name)}</span>`).join("");

  const box = (node) => {
    const { summary, counterpart } = info_of(node.key);
    const names = steps.get(node.key) ?? [];
    const kids = node.children === undefined ? "" : `<div class="kids ${node.kind}">${node.children.map(box).join("")}</div>`;
    const port = counterpart === undefined ? "" : `<div class="port">dt-schema <code>${escape(counterpart)}</code></div>`;
    const count = node.kind === "source" ? "<span class=\"count\">where it starts</span>"
      : node.children === undefined || node.kind === "walk"
        ? `<span class="count">${names.length === 0 ? "changes nothing here" : `${names.length} changed`}</span>`
        : "";
    const idle = names.length === 0 && node.children === undefined && node.kind !== "source";
    return `<div class="box ${node.kind} ${idle ? "idle" : ""}" data-key="${escape(node.key)}">
      <div class="box-head"><button class="step-link" data-key="${escape(node.key)}">${escape(node.key.split(".").at(-1))}</button>${count}</div>
      ${port}
      <p>${inline(summary)}</p>
      ${names.length > 0 && node.kind !== "walk" ? `<div class="chips">${chips(names)}</div>` : ""}
      ${kids}
    </div>`;
  };
  $("flow").innerHTML = TREE.map(box).join("<div class=\"arrow\">↓</div>");
}

let current_rows = [];

function render() {
  const item = target();
  current_rows = item === undefined ? [] : rows_of(item);
  const selectable = visible(current_rows).filter((index) => current_rows[index].kind === "step");
  if (!selectable.includes(state.row)) { state.row = selectable.find((index) => current_rows[index].key !== "source") ?? selectable[0] ?? -1; }

  const error = view().error;
  $("error").hidden = error === undefined;
  $("error").innerHTML = error === undefined ? "" : `<strong>${escape(view().file)}</strong> fails at <strong>${escape(error.stage)}</strong>: ${escape(error.message)}`;

  $("steps-tab").hidden = state.tab !== "steps";
  $("overview-tab").hidden = state.tab !== "overview";
  for (const tab of document.querySelectorAll("#tabs button")) { tab.setAttribute("aria-selected", String(tab.dataset.tab === state.tab)); }

  render_properties();
  if (item !== undefined) {
    render_steps(current_rows);
    render_detail(current_rows);
  }
  if (state.tab === "overview") { render_overview(); }
  save_hash();
}

// --- state in the URL ---------------------------------------------------------------------------------------------

function save_hash() {
  const row = current_rows[state.row];
  const occurrence = row === undefined ? 0 : current_rows.slice(0, state.row).filter((other) => other.key === row.key).length;
  const parameters = new URLSearchParams({ b: String(state.view), p: target()?.label ?? "", s: row === undefined ? "" : `${row.key}~${occurrence}`, t: state.tab });
  if (!state.touching) { parameters.set("all", "1"); }
  history.replaceState(undefined, "", `#${parameters}`);
}

function load_hash() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  const index = Number(parameters.get("b") ?? 0);
  state.view = Number.isInteger(index) && index >= 0 && index < VIEWS.length ? index : 0;
  const found = view().targets.findIndex((item) => item.label === parameters.get("p"));
  state.target = found === -1 ? 0 : found;
  state.touching = parameters.get("all") !== "1";
  state.tab = parameters.get("t") === "overview" ? "overview" : "steps";
  const [key, occurrence] = (parameters.get("s") ?? "").split("~");
  const rows = target() === undefined ? [] : rows_of(target());
  const matches = rows.map((row, at) => ({ row, at })).filter(({ row }) => row.kind === "step" && row.key === key);
  const match = matches[Number(occurrence ?? 0)] ?? matches[0];
  if (match !== undefined) {
    state.row = match.at;
    if (!match.row.changed) { state.touching = false; }
  }
}

// --- events -------------------------------------------------------------------------------------------------------

function select_target(index) {
  const key = current_rows[state.row]?.key;
  state.target = index;
  // Stay at the same step if the new property has it
  const rows = rows_of(target());
  const same = rows.findIndex((row) => row.kind === "step" && row.key === key && (row.changed || !state.touching));
  state.row = same;
  render();
}

function move_step(by) {
  const selectable = visible(current_rows).filter((index) => current_rows[index].kind === "step");
  const at = selectable.indexOf(state.row);
  const next = selectable[Math.min(selectable.length - 1, Math.max(0, at + by))];
  if (next !== undefined) { state.row = next; render(); }
}

function move_target(by) {
  const list = matching_targets().map(({ index }) => index);
  const at = list.indexOf(state.target);
  const next = list[Math.min(list.length - 1, Math.max(0, at + by))];
  if (next !== undefined) { select_target(next); }
}

function show_step(key) {
  state.tab = "steps";
  let at = current_rows.findIndex((row) => row.kind === "step" && row.key === key && row.changed);
  if (at === -1) {
    // A step that doesn't change it, or a group: show every step, at its first
    state.touching = false;
    $("touching").checked = false;
    at = current_rows.findIndex((row) => row.kind === "step" && (row.key === key || row.key.startsWith(`${key}.`)));
  }
  state.row = at;
  render();
}

$("binding").innerHTML = VIEWS.map((item, index) => `<option value="${index}">${escape(item.file)}</option>`).join("");
$("binding").hidden = VIEWS.length === 1;
document.querySelector("h1").insertAdjacentHTML("afterend", VIEWS.length === 1 ? `<code class="file">${escape(VIEWS[0].file)}</code>` : "");

$("binding").addEventListener("change", (event) => {
  state.view = Number(event.target.value);
  state.target = 0;
  state.row = -1;
  render();
});
$("filter").addEventListener("input", (event) => {
  state.filter = event.target.value;
  render_properties();
});
$("filter").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const [first] = matching_targets();
    if (first !== undefined) { select_target(first.index); }
    event.target.blur();
  }
  if (event.key === "Escape") { event.target.blur(); }
});
$("property-list").addEventListener("click", (event) => {
  const item = event.target.closest("[data-index]");
  if (item !== null) { select_target(Number(item.dataset.index)); }
});
$("step-list").addEventListener("click", (event) => {
  const item = event.target.closest("[data-row]");
  if (item !== null) { state.row = Number(item.dataset.row); render(); }
});
$("touching").addEventListener("change", (event) => { state.touching = event.target.checked; render(); });
$("side-by-side").addEventListener("change", (event) => { state.side = event.target.checked; render(); });
$("changes").addEventListener("click", (event) => {
  const item = event.target.closest("[data-pointer]");
  if (item === null) { return; }
  const node = $("schema").querySelector(`[data-pointer="${CSS.escape(item.dataset.pointer)}"]`);
  node?.closest("details")?.setAttribute("open", "");
  node?.scrollIntoView({ block: "center", behavior: "smooth" });
  node?.classList.add("flash");
  setTimeout(() => node?.classList.remove("flash"), 900);
});
$("tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab !== null) { state.tab = tab.dataset.tab; render(); }
});
$("flow").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-target]");
  if (chip !== null) { state.tab = "steps"; select_target(Number(chip.dataset.target)); return; }
  const step = event.target.closest(".step-link");
  if (step !== null) { show_step(step.dataset.key); }
});

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type !== "checkbox") { return; }
  if (event.metaKey || event.ctrlKey || event.altKey) { return; }
  const actions = {
    ArrowRight: () => move_step(1), l: () => move_step(1),
    ArrowLeft: () => move_step(-1), h: () => move_step(-1),
    ArrowDown: () => move_target(1), j: () => move_target(1),
    ArrowUp: () => move_target(-1), k: () => move_target(-1),
    "/": () => $("filter").focus(),
    t: () => { state.touching = !state.touching; $("touching").checked = state.touching; render(); },
    s: () => { state.side = !state.side; $("side-by-side").checked = state.side; render(); },
    o: () => { state.tab = state.tab === "overview" ? "steps" : "overview"; render(); },
  };
  const action = actions[event.key];
  if (action !== undefined) { event.preventDefault(); action(); }
});

function from_hash() {
  load_hash();
  $("binding").value = String(state.view);
  $("touching").checked = state.touching;
  render();
}
// A link pasted into the address bar (replaceState, which the view uses, fires no hashchange)
window.addEventListener("hashchange", from_hash);
from_hash();
