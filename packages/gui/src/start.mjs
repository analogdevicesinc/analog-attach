#!/usr/bin/env node
// The GUI's server on its own, for working on the page:
//
//   node src/start.mjs [project folder] [--port 5177]
//
// runs the `analog-attach` on PATH, or the command in $ANALOG_ATTACH (`node path/to/cli.js`).
// It is a file of its own so that a bundle of server.mjs (the CLI's standalone binary, where
// every module is the one file) never starts a server on import.

import path from "node:path";
import { DEFAULT_PORT, start_gui } from "./server.mjs";

const argv = process.argv.slice(2);
const port_flag = argv.indexOf("--port");
const port = port_flag >= 0 ? Number(argv[port_flag + 1]) : DEFAULT_PORT;
const next_free = port_flag < 0;
const positional = argv.filter((arg, index) => !arg.startsWith("--") && argv[index - 1] !== "--port");
const cli = (process.env.ANALOG_ATTACH ?? "analog-attach").split(" ").filter(word => word !== "");
const { url } = await start_gui({ cli, project: positional[0] ?? process.cwd(), port, next_free });
console.log(`analog-attach GUI on ${url}  (project: ${path.resolve(positional[0] ?? process.cwd())})`);
