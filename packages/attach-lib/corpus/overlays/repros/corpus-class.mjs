#!/usr/bin/env node
// List the corpus snapshot errors whose first message line matches a regex.
//   node corpus/overlays/repros/corpus-class.mjs '<regex>' [--raw]
// Without --raw the raw-bytes class (`b'…' is not of type`) is left out.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [pattern, flag] = process.argv.slice(2);
if (pattern === undefined) {
  console.error("usage: corpus-class.mjs '<regex>' [--raw]");
  process.exit(2);
}
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../snapshots");
const regex = new RegExp(pattern);
const raw = (message) => message.includes("b'") && message.includes("is not of type");
const overlays = new Map();
let total = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const errors = JSON.parse(readFileSync(join(dir, file), "utf8")).validate?.errors ?? [];
  for (const error of errors) {
    const line = error.message.split("\n")[0];
    if (!regex.test(line) || (flag !== "--raw" && raw(line))) continue;
    total += 1;
    overlays.set(file.replace(/\.json$/, ""), [...(overlays.get(file.replace(/\.json$/, "")) ?? []), line]);
  }
}
console.log(`${total} errors in ${overlays.size} overlays`);
for (const [name, lines] of overlays) console.log(`${name} (${lines.length}): ${lines[0].slice(0, 150)}`);
