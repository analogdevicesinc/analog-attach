import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

import { buildApp } from "./app";
import { buildContext } from "./context";
import { build_completion_command } from "./commands/completion/command";
import { run_complete } from "./commands/completion/complete";
import { COMPLETION_SPEC, NO_VALUE_COMPLETION, FILES_DIRECTIVE, DIRS_DIRECTIVE } from "./commands/completion/spec";
import * as suggest from "./commands/suggest/command";

function registered_commands(): string[] {
    return buildApp(buildContext(false)).commands.map(c => c.name());
}

// Capture the lines `run_complete` prints for a given set of shell words.
async function complete(words: string[]): Promise<string[]> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
        lines.push(parts.map(p => (typeof p === "string" ? p : String(p))).join(" "));
    });
    try {
        await run_complete(words);
    } finally {
        spy.mockRestore();
    }
    return lines;
}

const values = (lines: string[]): string[] => lines.map(l => l.split("\t")[0]!);

describe("completion spec stays in sync with the command registry", () => {
    test("every registered command has a spec entry or is explicitly value-less", () => {
        const covered = new Set([...Object.keys(COMPLETION_SPEC), ...NO_VALUE_COMPLETION]);
        // `completion` is a real command and is covered by COMPLETION_SPEC.
        expect([...covered].sort()).toEqual(registered_commands().sort());
    });

    test("no command appears in both the spec and the value-less list", () => {
        const overlap = Object.keys(COMPLETION_SPEC).filter(c => NO_VALUE_COMPLETION.includes(c));
        expect(overlap).toEqual([]);
    });

    test("every spec key names a real command", () => {
        const commands = new Set(registered_commands());
        for (const name of [...Object.keys(COMPLETION_SPEC), ...NO_VALUE_COMPLETION]) {
            expect(commands.has(name), `${name} is not a registered command`).toBe(true);
        }
    });

    test("every flag named in the spec exists on its command", () => {
        const app = buildApp(buildContext(false));
        for (const [name, spec] of Object.entries(COMPLETION_SPEC)) {
            if (spec.flags === undefined) { continue; }
            const cmd = app.commands.find(c => c.name() === name)!;
            const longs = new Set(cmd.options.map(o => o.long));
            for (const flag of Object.keys(spec.flags)) {
                expect(longs.has(flag), `${name} has no option ${flag}`).toBe(true);
            }
        }
    });
});

describe("__complete engine", () => {
    test("no subcommand lists exactly the registered commands", async () => {
        expect(values(await complete([""])).sort()).toEqual(registered_commands().sort());
    });

    test("partial command name is prefix-filtered", async () => {
        expect(values(await complete(["val"]))).toEqual(["validate", "validate2"]);
    });

    test("leading dash lists global flags", async () => {
        expect(values(await complete(["-"])).sort()).toEqual(["--help", "--json", "--version"]);
    });

    test("a subcommand's flags come from commander, filtered by prefix", async () => {
        const flags = values(await complete(["add", "--"]));
        expect(flags).toContain("--name");
        expect(flags).toContain("--overlay");
        expect(flags).toContain("--dt-schema");
        expect(flags).toContain("--help");
    });

    test("already-used flags are excluded", async () => {
        const flags = values(await complete(["add", "--overlay", "o.dtso", "--"]));
        expect(flags).not.toContain("--overlay");
        expect(flags).toContain("--name");
    });

    test("validate2 offers no bogus flags (only --help)", async () => {
        expect(values(await complete(["validate2", "--"]))).toEqual(["--help"]);
    });

    test("a file-valued flag emits the file directive", async () => {
        expect(await complete(["add", "--overlay", ""])).toEqual([FILES_DIRECTIVE]);
    });

    test("a dir-valued flag emits the dir directive", async () => {
        expect(await complete(["add", "--linux", ""])).toEqual([DIRS_DIRECTIVE]);
    });

    test("completion positional offers the shells", async () => {
        expect(values(await complete(["completion", ""])).sort()).toEqual(["bash", "fish", "zsh"]);
    });

    test("config-set completes fields then a file path", async () => {
        expect(values(await complete(["config-set", ""])).sort()).toEqual(["context", "dt-schema", "linux", "overlay"]);
        expect(await complete(["config-set", "linux", ""])).toEqual([FILES_DIRECTIVE]);
    });

    test("a free-value flag (no spec entry) yields no candidates", async () => {
        expect(await complete(["add", "--name", ""])).toEqual([]);
    });
});

describe("__complete delegates dynamic values to suggest in-process", () => {
    beforeEach(() => {
        // Stand in for the real intelligence: emit the JSON `suggest` protocol.
        vi.spyOn(suggest, "run_suggest").mockImplementation(async (context, args) => {
            const [kind] = args;
            const suggestions =
                kind === "device-key" ? [{ value: "ad7124" }, { value: "ad5940" }]
                : kind === "parent" ? [{ value: "spi0", display_string: "/soc/spi@0" }]
                : kind === "navigate" ? [{ value: "reg", display_string: "reg (required)" }]
                : [];
            if (context.json) { console.log(JSON.stringify({ ok: true, message: "", severity: "info", suggestions })); }
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    test("add positional completes device keys", async () => {
        expect(values(await complete(["add", ""])).sort()).toEqual(["ad5940", "ad7124"]);
    });

    test("add positional prefix-filters device keys", async () => {
        expect(values(await complete(["add", "ad7"]))).toEqual(["ad7124"]);
    });

    test("read positional completes navigate items with descriptions", async () => {
        const lines = await complete(["read", ""]);
        expect(lines).toEqual(["reg\treg (required)"]);
    });

    test("add --to passes the device key as parent context", async () => {
        const lines = await complete(["add", "ad7124", "--to", ""]);
        expect(values(lines)).toEqual(["spi0"]);
        expect(vi.mocked(suggest.run_suggest).mock.calls.some(
            ([, args]) => args[0] === "parent" && args[1] === "ad7124",
        )).toBe(true);
    });
});

describe("completion stubs", () => {
    const emit = (shell: string): string => {
        let out = "";
        const spy = vi.spyOn(console, "log").mockImplementation((s?: unknown) => { out += String(s); });
        build_completion_command(buildContext(false)).parse([shell], { from: "user" });
        spy.mockRestore();
        return out;
    };

    test("each stub calls __complete and registers its shell hook", () => {
        expect(emit("bash")).toContain("__complete");
        expect(emit("bash")).toContain("complete -F _attach_linux_complete attach-linux");
        expect(emit("zsh")).toContain("#compdef attach-linux");
        expect(emit("fish")).toContain("complete -c attach-linux");
    });

    test("the zsh stub registers via compdef so `source <(... zsh)` works, not just $fpath autoload", () => {
        // Regression: a bare `#compdef` file that only defines and calls the
        // function never registers when sourced, so TAB falls back to filename
        // completion. The compdef call is what makes sourcing work.
        expect(emit("zsh")).toContain("compdef _attach-linux attach-linux");
    });

    test("each stub handles the file/dir directives", () => {
        for (const shell of ["bash", "zsh", "fish"]) {
            expect(emit(shell)).toContain(FILES_DIRECTIVE);
            expect(emit(shell)).toContain(DIRS_DIRECTIVE);
        }
    });
});
