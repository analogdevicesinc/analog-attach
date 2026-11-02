// What the corpus scripts share: the binding files of a tree, and the commits and processed schema a baseline was made
// with, so a script can warn when it compares against one made from other trees.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function commit_of(directory) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

/** The `.yaml` files under `directory`, in a stable order. */
export function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && entry.name.endsWith(".yaml")) yield path;
  }
}

/** The Linux and dt-schema commits and a hash of the processed schema (generated, so it is recorded too). */
export function corpus_meta(linux, dt_schema, processed_schema) {
  return {
    linux: commit_of(linux),
    dt_schema: commit_of(dt_schema),
    processed_schema: processed_schema === undefined ? "none" : createHash("sha1").update(readFileSync(processed_schema)).digest("hex").slice(0, 12),
  };
}

/** Warns of each tree the baseline was made from another commit (or processed schema) of. */
export function warn_meta(baseline, meta) {
  for (const key of ["linux", "dt_schema", "processed_schema"]) {
    if (baseline[key] !== meta[key]) console.error(`warning: ${key} is at ${meta[key]}, the baseline was made at ${baseline[key]}`);
  }
}
