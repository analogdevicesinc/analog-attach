#!/usr/bin/env node
import { run } from "@stricli/core";
import { app } from "../app";
import { get_completions } from "../completion/completion";

const args = process.argv.slice(2);

// Handle hidden --complete flag for shell completion
if (args[0] === "--complete") {
    const line = args.slice(1).join(" ");
    const completions = get_completions(line);
    for (const c of completions) {
        console.log(c);
    }
    process.exit(0);
}

run(app, args, { process });
