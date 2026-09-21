// The `__complete` engine: given the shell words typed so far (the last element
// is the word under the cursor, possibly empty), it prints one completion
// candidate per line to stdout. The thin per-shell stubs in `command.ts` call
// this on every TAB press, so this is the single place that knows the grammar.
//
// A candidate line is either `value` or `value\tdescription` (zsh/fish show the
// description; bash ignores the tail). When a file or directory should be
// completed, a lone directive line is printed instead and the stub falls back
// to the shell's native path completion.

import type { Command, Option } from "commander";

import { buildApp } from "../../app";
import { buildContext } from "../../context";
import { run_suggest } from "../suggest/command";
import type { Suggestion } from "../../protocol/types";
import { COMPLETION_SPEC, FILES_DIRECTIVE, DIRS_DIRECTIVE, type CommandSpec, type ValueSource, type SuggestKind } from "./spec";

const GLOBAL_FLAGS: readonly Candidate[] = [
    { value: "--json", description: "Output as JSON" },
    { value: "--help", description: "Print help information and exit" },
    { value: "--version", description: "Print version information and exit" },
];

interface Candidate {
    value: string;
    description?: string;
}

export async function run_complete(words: string[]): Promise<void> {
    const prefix = words.length > 0 ? words.at(-1)! : "";
    const committed = words.slice(0, -1);

    const app = buildApp(buildContext(false));

    // Locate the subcommand: the first non-flag word. Only value-less global
    // flags (--json/--help/--version) can precede it, so no value-skipping is
    // needed here.
    let sub: string | undefined;
    let subIndex = -1;
    for (const [index, element] of committed.entries()) {
        const w = element!;
        if (!w.startsWith("-")) { sub = w; subIndex = index; break; }
    }

    // No subcommand yet: complete command names, or global flags.
    if (sub === undefined) {
        if (prefix.startsWith("-")) {
            emit(filter_by_prefix(GLOBAL_FLAGS, prefix));
        } else {
            emit(filter_by_prefix(app.commands.map(c => ({ value: c.name(), description: c.description() })), prefix));
        }
        return;
    }

    const cmd = app.commands.find(c => c.name() === sub);
    if (cmd === undefined) { return; }
    const spec = COMPLETION_SPEC[sub];

    // Walk the words after the subcommand, collecting positional arguments while
    // skipping flags and their values. This replaces the per-shell word walkers.
    const positionals: string[] = [];
    for (let index = subIndex + 1; index < committed.length; index++) {
        const w = committed[index]!;
        if (w.startsWith("-")) {
            const opt = find_option(cmd, w);
            if (opt !== undefined && option_takes_argument(opt)) { index++; }
            continue;
        }
        positionals.push(w);
    }

    // Are we completing the value of a flag? (The last committed word is a
    // value-taking flag for this command.)
    const last = committed.at(-1);
    if (last !== undefined && last.startsWith("-")) {
        const opt = find_option(cmd, last);
        if (opt !== undefined && option_takes_argument(opt)) {
            const source = spec?.flags?.[opt.long ?? last];
            if (source !== undefined) { await emit_value_source(source, prefix, positionals); }
            return;
        }
    }

    // Completing a flag name.
    if (prefix.startsWith("-")) {
        emit(command_flags(cmd, committed, prefix));
        return;
    }

    // Completing a positional argument.
    const source = positional_source(spec, positionals.length);
    if (source !== undefined) { await emit_value_source(source, prefix, positionals); }
}

function positional_source(spec: CommandSpec | undefined, index: number): ValueSource | undefined {
    const positional = spec?.positional;
    if (positional === undefined) { return undefined; }
    if (positional.mode === "all") { return positional.source; }
    return positional.sources[index] ?? positional.rest;
}

async function emit_value_source(source: ValueSource, prefix: string, positionals: string[]): Promise<void> {
    switch (source.kind) {
        case "file": {
            console.log(FILES_DIRECTIVE);
            return;
        }
        case "dir": {
            console.log(DIRS_DIRECTIVE);
            return;
        }
        case "values": {
            emit(filter_by_prefix(source.values.map(value => ({ value })), prefix));
            return;
        }
        case "suggest": {
            const suggestions = await suggest_values(source.suggest, prefix, positionals);
            const candidates = suggestions.map(s => ({ value: s.value, description: s.display_string }));
            emit(filter_by_prefix(candidates, prefix));
            return;
        }
    }
}

// Build the `suggest` context argv for each dynamic kind, mirroring what the old
// per-shell scripts computed, then run the intelligence in-process.
async function suggest_values(kind: SuggestKind, prefix: string, positionals: string[]): Promise<Suggestion[]> {
    switch (kind) {
        case "device-key": {
            return capture_suggest(kind, [prefix]);
        }
        case "parent": {
            const key = positionals[0];
            return key === undefined ? [] : capture_suggest(kind, [key]);
        }
        case "navigate": {
            return capture_suggest(kind, positionals);
        }
    }
}

// Run `suggest` in-process with JSON output and collect its `suggestions`.
// Completion must stay silent on failure, so any error yields no candidates.
async function capture_suggest(kind: SuggestKind, arguments_: string[]): Promise<Suggestion[]> {
    const original = console.log;
    const saved_exit = process.exitCode;
    const lines: string[] = [];
    console.log = (...parts: unknown[]) => { lines.push(parts.map(p => (typeof p === "string" ? p : String(p))).join(" ")); };
    try {
        await run_suggest(buildContext(true), [kind, ...arguments_]);
    } catch {
        // ignore — no candidates
    } finally {
        console.log = original;
        process.exitCode = saved_exit;
    }
    try {
        const parsed = JSON.parse(lines.join("\n")) as { suggestions?: Suggestion[] };
        return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    } catch {
        return [];
    }
}

function command_flags(cmd: Command, committed: string[], prefix: string): Candidate[] {
    const used = new Set(committed.filter(w => w.startsWith("--")));
    const flags: Candidate[] = cmd.options
        .filter(opt => opt.long !== undefined && !used.has(opt.long))
        .map(opt => ({ value: opt.long!, description: opt.description }));
    flags.push({ value: "--help", description: "display help for command" });
    return filter_by_prefix(flags, prefix);
}

function find_option(cmd: Command, token: string): Option | undefined {
    return cmd.options.find(opt => opt.long === token || opt.short === token);
}

function option_takes_argument(opt: Option): boolean {
    return opt.required || opt.optional;
}

function filter_by_prefix(candidates: readonly Candidate[], prefix: string): Candidate[] {
    return candidates.filter(c => c.value.startsWith(prefix));
}

function emit(candidates: Candidate[]): void {
    for (const c of candidates) {
        console.log(c.description ? `${c.value}\t${c.description}` : c.value);
    }
}
