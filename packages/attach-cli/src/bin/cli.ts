#!/usr/bin/env node
import { buildContext } from "../context";
import { buildApp } from "../app";

const argv = process.argv.slice(2);
const jsonIndex = argv.indexOf("--json");
const json = jsonIndex !== -1;
if (json) { argv.splice(jsonIndex, 1); }

const context = buildContext(json);
const app = buildApp(context);
await app.parseAsync(argv, { from: "user" });
