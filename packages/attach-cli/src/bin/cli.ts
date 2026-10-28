#!/usr/bin/env node
import { CommanderError } from "commander";

import { buildContext } from "../context";
import { buildApp } from "../app";
import { run_complete } from "../commands/completion/complete";
import { run_setup } from "../commands/setup/command";
import { on_terminal } from "../missing-required";
import { input_error } from "../protocol/output";

const argv = process.argv.slice(2);

if (argv[0] === "__complete") {
    const dashDash = argv.indexOf("--");
    const words = dashDash === -1 ? argv.slice(1) : argv.slice(dashDash + 1);
    await run_complete(words);
    process.exit(0);
}

const jsonIndex = argv.indexOf("--json");
const json = jsonIndex !== -1;
if (json) { argv.splice(jsonIndex, 1); }

// A bare `attach-linux` on a terminal is the setup run. `--quiet` alone never asks: it is the bare usage.
if (argv.length === 1 && argv[0] === "--quiet") { argv.pop(); }
else if (argv.length === 0 && !json && on_terminal()) {
    await run_setup();
    process.exit();
}

const context = buildContext(json);
const app = buildApp(context);

if (json) {
    const json_output = {
        writeOut: () => {},
        writeErr: (message: string) => { input_error(message.trim()); },
    };
    app.exitOverride();
    app.configureOutput(json_output);
    for (const cmd of app.commands) {
        cmd.exitOverride();
        cmd.configureOutput(json_output);
    }
}

try {
    await app.parseAsync(argv, { from: "user" });
} catch (error: unknown) {
    if (error instanceof CommanderError) {
        if (json) { process.exit(2); }
    } else {
        // The command didn't finish, so there is no answer to give: say why on stderr and exit 1.
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
