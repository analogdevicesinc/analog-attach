#!/usr/bin/env node
import { buildContext } from "../context";
import { buildApp } from "../app";
import { run_complete } from "../commands/completion/complete";

const argv = process.argv.slice(2);

// Hidden completion entry point: the shell stubs call `attach-linux __complete
// -- <words...>`. Handle it before any flag processing so partial/raw words are
// passed through untouched, and never let commander parse them.
if (argv[0] === "__complete") {
    const dashDash = argv.indexOf("--");
    const words = dashDash === -1 ? argv.slice(1) : argv.slice(dashDash + 1);
    await run_complete(words);
    process.exit(0);
}

const jsonIndex = argv.indexOf("--json");
const json = jsonIndex !== -1;
if (json) { argv.splice(jsonIndex, 1); }

const context = buildContext(json);
const app = buildApp(context);
await app.parseAsync(argv, { from: "user" });
