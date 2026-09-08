#!/usr/bin/env node
import { run } from "@stricli/core";
import { buildContext } from "../context";
import { app } from "../app";

const arguments_ = process.argv.slice(2);
const jsonIndex = arguments_.indexOf("--json");
const json = jsonIndex !== -1;
if (json) {arguments_.splice(jsonIndex, 1);}

await run(app, arguments_, buildContext(process, json));
