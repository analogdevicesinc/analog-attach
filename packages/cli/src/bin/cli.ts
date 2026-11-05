#!/usr/bin/env node
// The `analog-attach` binary: `main` with the real process, then exit with its code once
// standard output and standard error are written out.
//
// Ctrl-C outside a prompt aborts the session's signal (a backend stops at its next check)
// and the exit status is 130; the process ends once the command returns, or a second later,
// or at a second Ctrl-C. Inside a prompt the terminal is raw, and the prompter handles it.

import { BACKENDS } from "../front/registry";
import { main } from "../front/main";
import { process_location } from "../front/settings-store";
import { claude_on_path } from "../front/skill";

const EXIT_CANCELLED = 130;
const interrupt = new AbortController();
process.on("SIGINT", () => {
    if (interrupt.signal.aborted) { process.exit(EXIT_CANCELLED); }
    interrupt.abort();
    process.exitCode = EXIT_CANCELLED;
    setTimeout(() => process.exit(EXIT_CANCELLED), 1000).unref();
});

// A reader that closes early (`| head`) only wants no more: stop quietly.
for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EPIPE") { process.exit(); }
        throw error;
    });
}

const code = await main(process.argv.slice(2), {
    registry: BACKENDS,
    streams: { stdout: process.stdout, stderr: process.stderr },
    location: process_location(),
    tty: { stdin: process.stdin.isTTY === true, stdout: process.stdout.isTTY === true },
    environment: process.env,
    prompter: async () => {
        const { create_prompter } = await import("../front/prompter");
        return create_prompter({ input: process.stdin, output: process.stdout });
    },
    claude_installed: claude_on_path,
    signal: interrupt.signal,
});
// A pipe is written asynchronously: exiting before it drains would cut the output (at 64 KB).
const flushed = (stream: NodeJS.WriteStream): Promise<void> => new Promise(resolve => { stream.write("", () => { resolve(); }); });
await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
process.exit(interrupt.signal.aborted ? EXIT_CANCELLED : code);
