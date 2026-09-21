import { describe, test, expect } from "vitest";
import * as fs from "node:fs";

import { buildApp } from "./app";
import { buildContext } from "./context";

const script_path = new URL("../completions/zsh.zsh", import.meta.url);

function registered_commands(): string[] {
    return buildApp(buildContext(false)).commands.map(c => c.name());
}

function completed_commands(script: string): string[] {
    // Parse the `commands=( 'name:description' ... )` array.
    const block = script.match(/local -a commands=\(([\s\S]*?)\n\s*\)/);
    if (block === null) { throw new Error("could not find commands=() array in zsh.zsh"); }
    return [...block[1]!.matchAll(/'([^:']+):/g)].map(m => m[1]!);
}

describe("zsh completion is in sync with the command registry", () => {
    const script = fs.readFileSync(script_path, "utf8");

    test("completion script lists exactly the registered commands", () => {
        expect(completed_commands(script).sort()).toEqual(registered_commands().sort());
    });
});
