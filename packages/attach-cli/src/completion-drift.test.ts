import { describe, test, expect } from "vitest";
import * as fs from "node:fs";

import { buildApp } from "./app";
import { buildContext } from "./context";

function registered_commands(): string[] {
    return buildApp(buildContext(false)).commands.map(c => c.name());
}

// Parse the zsh `commands=( 'name:description' ... )` describe array.
function zsh_commands(script: string): string[] {
    const block = script.match(/local -a commands=\(([\s\S]*?)\n\s*\)/);
    if (block === null) { throw new Error("could not find commands=() array in zsh.zsh"); }
    return [...block[1]!.matchAll(/'([^:']+):/g)].map(m => m[1]!);
}

// Parse the bash `local commands="a b c ..."` (line-continued) assignment.
function bash_commands(script: string): string[] {
    const block = script.match(/local commands="([^"]*)"/);
    if (block === null) { throw new Error('could not find commands="..." in bash.bash'); }
    return block[1]!.split(/\s+/).filter(t => /^[a-z][a-z0-9-]*$/.test(t));
}

// Parse the fish `complete ... -n __fish_use_subcommand -a <name>` directives.
function fish_commands(script: string): string[] {
    return [...script.matchAll(/-n __fish_use_subcommand -a (\S+)/g)].map(m => m[1]!);
}

const cases: [string, string, (script: string) => string[]][] = [
    ["zsh", "../completions/zsh.zsh", zsh_commands],
    ["bash", "../completions/bash.bash", bash_commands],
    ["fish", "../completions/fish.fish", fish_commands],
];

describe("shell completions are in sync with the command registry", () => {
    test.each(cases)("%s completion lists exactly the registered commands", (_shell, rel, parse) => {
        const script = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
        expect(parse(script).sort()).toEqual(registered_commands().sort());
    });
});
