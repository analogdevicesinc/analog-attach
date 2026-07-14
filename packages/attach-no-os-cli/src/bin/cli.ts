#!/usr/bin/env node
import { proposeCompletions, run } from "@stricli/core";
import { app } from "../app";
import { CompletionContext } from "../completion/completion";

const arguments_ = process.argv.slice(2);

// Handle hidden --complete flag for shell completion.
// aa.bash invokes `aa --complete "${COMP_LINE}"`, so the whole command line
// arrives as one string. We split it into words, drop the leading "aa", and —
// when the line ends in whitespace — append an empty token so stricli knows a
// new argument is being started.
if (arguments_[0] === "--complete") {
    const line = arguments_.slice(1).join(" ");
    const words = line.trimStart().split(/\s+/).filter(Boolean).slice(1);
    if (/\s$/.test(line)) {
        words.push("");
    }

    const context: CompletionContext = { process, completionInputs: words };
    const completions = await proposeCompletions(app, words, context);

    // Emit workfile values / command names first and flags (--foo) last, each
    // group sorted alphabetically. aa.bash registers completion with -o nosort
    // so bash preserves this order instead of interleaving flags into the list.
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

run(app, arguments_, { process });
