#!/usr/bin/env node
import { buildContext } from "../context";
import { buildApp } from "../app";

const argv = process.argv.slice(2);
const jsonIndex = argv.indexOf("--json");
const json = jsonIndex !== -1;
if (json) { argv.splice(jsonIndex, 1); }

const ctx = buildContext(json);
const app = buildApp(ctx);
await app.parseAsync(argv, { from: "user" });
