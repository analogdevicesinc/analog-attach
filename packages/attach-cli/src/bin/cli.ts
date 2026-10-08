#!/usr/bin/env node
import { buildContext } from "../context";
import { buildApp } from "../app";
import { run_complete } from "../commands/completion/complete";
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
} catch (error: any) {
    if (json && error?.exitCode !== undefined) {
        process.exit(2);
    }
}
