import type { AppConfig } from "./config";
import { findTool } from "./config";
import { AnalogAttachError } from "./error";
import { loadVerified } from "./manifest-store";
import type { Manifest, CommandName, CommandMapping } from "./protocol/manifest";
import { COMMAND_NAMES, getCommand } from "./protocol/manifest";
import { collectFlagNames, flagTypeInSchema } from "./dynargs";
import { metaIntelligences, isMetaKind, metaSuggest, mergeIntelligence } from "./meta-intelligence";
import { invoke } from "./transport";
import type { Intelligence, Suggestion } from "./protocol/types";

function tryLoadManifest(config: AppConfig, configPath: string): Manifest | undefined {
    const toolName = config.meta.default_tool;
    if (!toolName) {return undefined;}
    const tool = findTool(config, toolName);
    if (!tool) {return undefined;}
    try {
        return loadVerified(tool, config, configPath).manifest;
    } catch {
        return undefined;
    }
}

export function runComplete(arguments_: readonly string[], config: AppConfig, configPath: string): void {
    const manifest = tryLoadManifest(config, configPath);

    if (arguments_.length === 0) {
        printCommandList(manifest);
        return;
    }

    const subcommand = arguments_[0]!;
    const rest = arguments_.slice(1);
    const partial = rest.length > 0 ? rest.at(-1)! : "";

    if (subcommand === "init") {
        if (rest.length <= 1) {
            const suggestions = metaSuggest("attachable", []);
            printMatchingSuggestions(suggestions, partial);
        }
        return;
    }

    if (subcommand === "schema") {
        if (rest.length <= 1) {
            for (const name of ["responses", "manifest"]) {
                if (name.startsWith(partial)) {
                    console.log(name);
                }
            }
        }
        return;
    }

    const cmd = COMMAND_NAMES.find(c => c === subcommand) as CommandName | undefined;

    if (!cmd) {
        if (manifest) {
            for (const name of COMMAND_NAMES) {
                if (name.startsWith(subcommand) && manifest.commands[name] !== undefined) {
                    console.log(name);
                }
            }
        }
        for (const builtin of ["init", "completion", "schema", "list-intelligence", "suggest"]) {
            if (builtin.startsWith(subcommand)) {
                console.log(builtin);
            }
        }
        return;
    }

    if (cmd === "suggest") {
        handleSuggestCompletion(manifest, rest);
        return;
    }

    if (cmd === "list-intelligence") {
        return;
    }

    if (!manifest) {return;}

    const mapping = getCommand(manifest, cmd);
    if (!mapping) {return;}

    const arrayFlagContext = activeArrayFlagContext(
        rest.slice(0, Math.max(0, rest.length - 1)),
        cmd,
        mapping.args,
    );

    const precedingFlag =
        rest.length >= 2 &&
        rest.at(-2)!.startsWith("--") &&
        flagTypeInSchema(
            rest.at(-2)!.replace(/^--/, ""),
            cmd,
            mapping.args,
        ) !== "boolean";

    const wantsFlag = (partial === "" || partial.startsWith("--")) &&
        (arrayFlagContext
            ? (partial.startsWith("--") ||
               !mapping.completions?.some(c => c.arg === arrayFlagContext[0]))
            : !precedingFlag);

    if (wantsFlag) {
        const flagPrefix = partial.startsWith("--") ? partial.slice(2) : "";
        const alreadyUsed = new Set(rest.filter(a => a.startsWith("--")).map(a => a.slice(2)));
        const allFlags = collectFlagNames(cmd, mapping.args);
        for (const flag of allFlags) {
            if (flag.startsWith(flagPrefix) && !alreadyUsed.has(flag)) {
                console.log(`--${flag}`);
            }
        }
    }

    const completions = mapping.completions;
    if (!completions) {return;}

    let completionKind: string | undefined;
    let suggestContext: string[];

    if (arrayFlagContext) {
        const [flag, precedingValues] = arrayFlagContext;
        const entry = completions.find(c => c.arg === flag);
        completionKind = entry?.kind;
        suggestContext = precedingValues;
    } else {
        const preceding = rest.length >= 2 ? rest.at(-2) : undefined;
        if (preceding?.startsWith("--")) {
            const flagName = preceding.slice(2);
            completionKind = completions.find(c => c.arg === flagName)?.kind;
        } else {
            completionKind = completions.find(c => c.arg === subcommand)?.kind;
        }
        suggestContext = subcommandPositionalContext(rest, cmd, mapping.args);
    }

    if (!completionKind) {return;}

    if (isMetaKind(completionKind)) {
        const suggestions = metaSuggest(completionKind, suggestContext);
        printMatchingSuggestions(suggestions, partial);
        return;
    }

    const liMapping = getCommand(manifest, "list-intelligence");
    if (!liMapping) {return;}

    let liResponse: Record<string, unknown>;
    try {
        liResponse = invoke(liMapping, []);
    } catch {
        return;
    }

    const intelligence = liResponse["intelligence"] as Array<{ kind: string }> | undefined;
    const advertised = intelligence?.some(index => index.kind === completionKind) ?? false;
    if (!advertised) {return;}

    const suggestMapping = getCommand(manifest, "suggest");
    if (!suggestMapping) {return;}

    const suggestArguments = [completionKind, ...suggestContext];
    let suggestResponse: Record<string, unknown>;
    try {
        suggestResponse = invoke(suggestMapping, suggestArguments);
    } catch {
        return;
    }

    const suggs = suggestResponse["suggestions"] as Array<{ value: string }> | undefined;
    if (suggs) {
        for (const s of suggs) {
            if (s.value.startsWith(partial)) {
                console.log(s.value);
            }
        }
    }
}

function handleSuggestCompletion(manifest: Manifest | undefined, rest: readonly string[]): void {
    const meta = metaIntelligences();

    let toolIntelligence: Intelligence[] = [];
    if (manifest) {
        const liMapping = getCommand(manifest, "list-intelligence");
        if (liMapping) {
            try {
                const liResponse = invoke(liMapping, []);
                toolIntelligence = (liResponse["intelligence"] as Intelligence[] | undefined) ?? [];
            } catch { /* ignore */ }
        }
    }

    const intelligence = mergeIntelligence(meta, toolIntelligence);

    if (rest.length <= 1) {
        const partial = rest.length === 1 ? rest[0]! : "";
        for (const index of intelligence) {
            if (index.kind.startsWith(partial)) {
                console.log(index.kind);
            }
        }
        return;
    }

    const kindString = rest[0]!;
    const argumentIndex = rest.length - 2;

    const intel = intelligence.find(index => index.kind === kindString);
    if (!intel) {return;}

    const intelArgument = intel.args[argumentIndex];
    if (!intelArgument) {return;}

    const argumentKind = intelArgument.kind;
    if (!argumentKind) {return;}

    if (isMetaKind(argumentKind)) {
        const partial = rest.length > 0 ? rest.at(-1)! : "";
        const preceding = rest.slice(1, Math.max(1, rest.length - 1));
        const suggestions = metaSuggest(argumentKind, preceding);
        printMatchingSuggestions(suggestions, partial);
        return;
    }

    const advertised = intelligence.some(index => index.kind === argumentKind);
    if (!advertised) {return;}

    const suggestMapping = manifest ? getCommand(manifest, "suggest") : undefined;
    if (!suggestMapping) {return;}

    const preceding = rest.slice(1, Math.max(1, rest.length - 1));
    const suggestArguments = [argumentKind, ...preceding];

    const partial = rest.length > 0 ? rest.at(-1)! : "";

    let suggestResponse: Record<string, unknown>;
    try {
        suggestResponse = invoke(suggestMapping, suggestArguments);
    } catch {
        return;
    }

    const suggs = suggestResponse["suggestions"] as Array<{ value: string }> | undefined;
    if (suggs) {
        for (const s of suggs) {
            if (s.value.startsWith(partial)) {
                console.log(s.value);
            }
        }
    }
}

function activeArrayFlagContext(
    tokens: readonly string[],
    cmd: CommandName,
    toolArguments: Record<string, unknown> | undefined,
): [string, string[]] | undefined {
    const values: string[] = [];
    for (let index = tokens.length - 1; index >= 0; index--) {
        const tok = tokens[index]!;
        if (tok.startsWith("--")) {
            const flagName = tok.slice(2);
            if (flagTypeInSchema(flagName, cmd, toolArguments) === "array") {
                values.reverse();
                return [flagName, values];
            }
            return undefined;
        }
        values.push(tok);
    }
    return undefined;
}

function subcommandPositionalContext(
    rest: readonly string[],
    cmd: CommandName,
    toolArguments: Record<string, unknown> | undefined,
): string[] {
    const context: string[] = [];
    const limit = Math.max(0, rest.length - 1);
    let skip: "none" | "one" | "until-next-flag" = "none";

    for (let index = 0; index < limit; index++) {
        const argument = rest[index]!;

        if (skip === "one") {
            skip = "none";
            continue;
        }
        if (skip === "until-next-flag") {
            if (!argument.startsWith("--")) {continue;}
            skip = "none";
        }

        if (argument.startsWith("--")) {
            const flagName = argument.slice(2);
            const ft = flagTypeInSchema(flagName, cmd, toolArguments);
            if (ft === "array") {
                skip = "until-next-flag";
            } else if (ft !== "boolean") {
                skip = "one";
            }
        } else {
            context.push(argument);
        }
    }

    return context;
}

function printMatchingSuggestions(suggestions: Suggestion[], partial: string): void {
    for (const s of suggestions) {
        if (s.value.startsWith(partial)) {
            console.log(s.value);
        }
    }
}

function printCommandList(manifest: Manifest | undefined): void {
    if (manifest) {
        for (const cmd of COMMAND_NAMES) {
            if (manifest.commands[cmd] !== undefined) {
                console.log(cmd);
            }
        }
    }
    console.log("init");
    console.log("completion");
    console.log("schema");
    console.log("list-intelligence");
    console.log("suggest");
}

export function generateCompletionScript(shell: string): string {
    switch (shell) {
        case "zsh": { return generateZshScript();
        }
        case "bash": { return generateBashScript();
        }
        case "fish": { return generateFishScript();
        }
        default: {
            throw new AnalogAttachError("input", `unsupported shell: ${shell}`);
        }
    }
}

function generateZshScript(): string {
    return `#compdef analog-attach
# Generated by analog-attach completion zsh
#
# To activate, ensure this file is on your fpath before compinit, e.g. add to ~/.zshrc:
#   fpath=(~/.zsh/completions $fpath)
#   autoload -Uz compinit && compinit

_analog-attach() {
    local -a completions
    completions=("\${(@f)$(analog-attach __complete -- "\${words[@]:1}" 2>/dev/null)}")
    if [[ $#completions -gt 0 ]]; then
        compadd -a completions
    fi
}

compdef _analog-attach analog-attach
`;
}

function generateBashScript(): string {
    return `# Generated by analog-attach completion bash
#
# To activate, source this file from ~/.bashrc or ~/.bash_profile:
#   source /path/to/this/file
# Or run: analog-attach completion bash >> ~/.bashrc

_analog_attach_completions() {
    local IFS=$'\\n'
    local completions
    completions=$(analog-attach __complete -- "\${COMP_WORDS[@]:1}" 2>/dev/null) || return
    [ -z "$completions" ] && return
    while IFS= read -r value; do
        COMPREPLY+=("$value")
    done <<< "$completions"
}
complete -F _analog_attach_completions analog-attach
`;
}

function generateFishScript(): string {
    return `# Generated by analog-attach completion fish
#
# To activate, place this file in ~/.config/fish/completions/analog-attach.fish
# Fish sources that directory automatically on startup.

function __analog_attach_completions
    set -l words (commandline -opc)
    set -l count (count $words)
    test $count -le 1; and return
    analog-attach __complete -- $words[2..-1] 2>/dev/null
end
complete -c analog-attach -f -a "(__analog_attach_completions)"
`;
}
