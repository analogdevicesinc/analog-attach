#!/usr/bin/env node
import { proposeCompletions, run } from "@stricli/core";
import { app } from "../app";
import { CompletionContext } from "../completion/completion";
import { normalize_argv } from "../argv";
import type { AttachContext } from "../commands/shared";
import { resolve_route } from "../protocol";

const raw_arguments = process.argv.slice(2);

// --- completions ---
//
// `aa complete <route> <partial> [prior tokens...]`, shared by attach-meta and
// completion/aa.bash. <route> is a discovery key (`create_node`), a literal route
// word (`create`), or empty to complete the top-level routes; resolve_route maps all
// three to the prefix stricli expects, so the per-parameter proposeCompletions hooks
// do the real work unchanged.
if (raw_arguments[0] === "complete") {
    const [, key, partial, ...tokens] = raw_arguments;

    const route = resolve_route(key);
    if (!route) {
        // Unsupported key. Exit silent: a completion request is not user-visible, and
        // anything printed here lands in their shell.
        process.exit(0);
    }

    const words = [...route, ...tokens, partial ?? ""];
    const context: CompletionContext = { process, completionInputs: words };
    const completions = await proposeCompletions(app, words, context);

    // Values and command names first, flags last, each group sorted. aa.bash registers
    // with -o nosort so bash preserves this instead of interleaving flags.
    const is_flag = (c: (typeof completions)[number]) => c.kind === "argument:flag";
    const by_completion = (a: (typeof completions)[number], b: (typeof completions)[number]) =>
        a.completion.localeCompare(b.completion);
    const ordered = [
        ...completions.filter(c => !is_flag(c)).sort(by_completion),
        ...completions.filter(c => is_flag(c)).sort(by_completion),
    ];
    for (const completion of ordered) {
        console.log(completion.completion);
    }
    process.exit(0);
}

const { argv, workfile } = normalize_argv(raw_arguments);

// stricli hands this to each command as `this`, which is how --workfile reaches
// load_context.
const context: AttachContext = { process, workfile_path: workfile };
await run(app, argv, context);
