#!/usr/bin/env node
import { proposeCompletions, run } from "@stricli/core";
import { app } from "../app";
import { CompletionContext } from "../completion/completion";
import { normalize_argv } from "../argv";
import type { AttachContext } from "../commands/shared";

const raw_arguments = process.argv.slice(2);

// --- completions ---
//
// `attach-noos complete <route> <partial> [prior tokens...]`, used by
// completion/attach-noos.bash.
//
// attach-meta does not come through here: it drives completion through `list-intelligence`
// and `suggest` instead (see src/commands/intelligence.ts). This entry point exists for the
// shell, where stricli's own per-parameter hooks give better answers than a suggestion kind
// can — they know about flags too.
if (raw_arguments[0] === "complete") {
    const [, key, partial, ...tokens] = raw_arguments;

    // Every route is one word now that the commands are named after the protocol, so the
    // route is the key itself; an empty key completes the top-level route names. A
    // two-word route (`completion install`) arrives with its second word among the tokens,
    // which land after the route either way.
    const words = [...(key ? [key] : []), ...tokens, partial ?? ""];
    const context: CompletionContext = { process, completionInputs: words };
    const completions = await proposeCompletions(app, words, context);

    // Values and command names first, flags last, each group sorted.
    // attach-noos.bash registers with -o nosort so bash preserves this instead of
    // interleaving flags.
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

const { argv } = normalize_argv(raw_arguments);

const context: AttachContext = { process };
await run(app, argv, context);
