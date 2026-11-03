// JSON values by pointer: get / set, equality and a diff, for the pipeline trace (scripts/pipeline-trace.mjs) and its
// HTML view. Pure: no Node imports, so the view can inline it. A pointer is the keys down to a value, as an array.
// Values are what the trace gives: JSON, with bigints (64-bit bounds).

const is_object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function equal(a, b) {
  if (a === b) { return true; }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equal(item, b[index]));
  }
  if (is_object(a) && is_object(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && equal(a[key], b[key]));
  }
  return false;
}

/** The value at `pointer`, or undefined. */
export function get(value, pointer) {
  let at = value;
  for (const key of pointer) {
    if (typeof at !== "object" || at === null) { return undefined; }
    at = at[key];
  }
  return at;
}

/** `value` with `pointer` set to `to` (in place, but use the result: an empty pointer replaces the whole). */
export function set(value, pointer, to) {
  if (pointer.length === 0) { return to; }
  const parent = get(value, pointer.slice(0, -1));
  if (typeof parent === "object" && parent !== null) { parent[pointer.at(-1)] = to; }
  return value;
}

/**
 * What changed from `before` to `after`, as `{ op: "add" | "remove" | "change", pointer, before?, after? }`, the
 * pointers under `at`. Objects and arrays are compared key by key (an array's extra items are added or removed);
 * anything else that differs is a change.
 */
export function diff(before, after, at = []) {
  if (equal(before, after)) { return []; }
  if (before === undefined) { return [{ op: "add", pointer: at, after }]; }
  if (after === undefined) { return [{ op: "remove", pointer: at, before }]; }

  if (is_object(before) && is_object(after)) {
    const keys = [...Object.keys(before), ...Object.keys(after).filter((key) => !(key in before))];
    return keys.flatMap((key) => diff(before[key], after[key], [...at, key]));
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    return Array.from({ length }, (_, index) => diff(before[index], after[index], [...at, String(index)])).flat();
  }
  return [{ op: "change", pointer: at, before, after }];
}

/** A value as one line of JSON, bigints as numbers, cut at `width` characters (0: not cut). */
export function format_value(value, width = 120) {
  if (value === undefined) { return "undefined"; }
  const text = JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? `${item}n` : item))
    .replaceAll(/"(-?\d+)n"/g, "$1");
  return width > 0 && text.length > width ? `${text.slice(0, width - 1)}…` : text;
}

/** A pointer as a JSON pointer string (`/items/0/maximum`; `/` for the whole). */
export const format_pointer = (pointer) =>
  pointer.length === 0 ? "/" : pointer.map((key) => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
