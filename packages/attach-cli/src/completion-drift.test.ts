/* eslint-disable unicorn/no-nested-ternary */
/* eslint-disable unicorn/consistent-function-scoping */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

import { buildApp } from "./app";
import { buildContext } from "./context";
import { build_completion_command } from "./commands/completion/command";
import { run_complete, shell_dequote } from "./commands/completion/complete";
import { COMPLETION_SPEC, NO_VALUE_COMPLETION, FILES_DIRECTIVE, DIRS_DIRECTIVE } from "./commands/completion/spec";
import { CONFIG_REGISTRY } from "./config";
import * as suggest from "./commands/suggest/command";
import * as internal from "./commands/list/internal";
import { LIST_KINDS } from "./commands/list/command";

const CONFIG_SET_FIELD_NAMES = CONFIG_REGISTRY
    .filter(spec => !spec.internal && spec.env === undefined)
    .map(spec => spec.toml)
    .sort();

const CONFIG_GET_FIELD_NAMES = CONFIG_REGISTRY
    .filter(spec => !spec.internal)
    .map(spec => spec.toml)
    .sort();

function registered_commands(): string[] {
    return buildApp(buildContext(false)).commands.map(c => c.name()).filter(n => !n.startsWith("__"));
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
            if (typeof spec === "string" || spec.flags === undefined) { continue; }
            const cmd = app.commands.find(c => c.name() === name)!;
            const longs = new Set(cmd.options.map(o => o.long));
            for (const flag of Object.keys(spec.flags)) {
                expect(longs.has(flag), `${name} has no option ${flag}`).toBe(true);
            }
        }
    });
});

describe("__complete engine", () => {
    test("no subcommand lists exactly the registered commands (excluding hidden __* commands)", async () => {
        const visible = registered_commands().filter(name => !name.startsWith("__"));
        expect(values(await complete([""])).sort()).toEqual(visible.sort());
    });

    test("partial command name is prefix-filtered", async () => {
        expect(values(await complete(["val"]))).toEqual(["validate"]);
    });

    test("leading dash lists global flags", async () => {
        expect(values(await complete(["-"])).sort()).toEqual(["--help", "--json", "--version"]);
    });

    test("a subcommand's flags come from commander, filtered by prefix", async () => {
        const flags = values(await complete(["add", "--"]));
        expect(flags).toContain("--name");
        expect(flags).toContain("--parent");
        expect(flags).toContain("--help");
        expect(flags).not.toContain("--overlay");
        expect(flags).not.toContain("--linux");
    });

    test("already-used flags are excluded", async () => {
        const flags = values(await complete(["add", "--name", "foo", "--"]));
        expect(flags).not.toContain("--name");
        expect(flags).toContain("--parent");
    });

    test("validate offers no bogus flags (only --help)", async () => {
        expect(values(await complete(["validate", "--"]))).toEqual(["--help"]);
    });

    test("a file-valued positional emits the file directive", async () => {
        expect(await complete(["config-set", "linux", ""])).toEqual([FILES_DIRECTIVE]);
    });

    test("completion positional offers the shells", async () => {
        expect(values(await complete(["completion", ""])).sort()).toEqual(["bash", "fish", "zsh"]);
    });

    test("config-set completes every settable field then a file path", async () => {
        expect(values(await complete(["config-set", ""])).sort()).toEqual(CONFIG_SET_FIELD_NAMES);
        expect(await complete(["config-set", "overlay", ""])).toEqual([FILES_DIRECTIVE]);
    });

    test("config-get completes every visible field", async () => {
        expect(values(await complete(["config-get", ""])).sort()).toEqual(CONFIG_GET_FIELD_NAMES);
    });

    test("a free-value flag (no spec entry) yields no candidates", async () => {
        expect(await complete(["add", "--name", ""])).toEqual([]);
    });
});

describe("__complete delegates dynamic values to suggest in-process", () => {
    beforeEach(() => {
        vi.spyOn(suggest, "run_suggest").mockImplementation(async (context, arguments_) => {
            const key = arguments_.join(" ");
            const suggestions =
                arguments_[0] === "device-key" ? [{ value: "ad7124" }, { value: "ad5940" }]
                : arguments_[0] === "parent" ? [{ value: "spi0", display_string: "/soc/spi@0" }]
                : key === "navigate" ? [{ value: "spi0" }, { value: "i2c1" }]
                : key === "navigate spi0/adc@0" ? [{ value: "reg", display_string: "reg (required)" }]
                : arguments_[0] === "children" ? [{ value: "adc@0" }, { value: "spidev@0" }]
                : arguments_[0] === "value" ? [{ value: "19 IRQ_TYPE_EDGE_FALLING", display_string: "19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int" }]
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

    test("read path: no slash offers roots with trailing /", async () => {
        const lines = await complete(["read", ""]);
        expect(lines[0]).toBe("__ATTACH_COMPLETE_NOSPACE__");
        expect(values(lines.slice(1))).toStrictEqual(["spi0/", "i2c1/"]);
    });

    test("read path: after slash offers children joined to parent", async () => {
        const lines = await complete(["read", "spi0/"]);
        expect(values(lines)).toStrictEqual(["spi0/adc@0", "spi0/spidev@0"]);
    });

    test("read second positional completes properties via navigate", async () => {
        const lines = await complete(["read", "spi0/adc@0", ""]);
        expect(lines).toStrictEqual(["reg\treg (required)"]);
    });

    test("add --parent completes as path with trailing /", async () => {
        const lines = await complete(["add", "ad7124", "--parent", ""]);
        expect(lines[0]).toBe("__ATTACH_COMPLETE_NOSPACE__");
        expect(values(lines.slice(1))).toStrictEqual(["spi0/", "i2c1/"]);
    });
});

describe("update value completion", () => {
    beforeEach(() => {
        vi.spyOn(suggest, "run_suggest").mockImplementation(async (context, arguments_) => {
            const key = arguments_.join(" ");
            const suggestions =
                key === "navigate" ? [{ value: "spi0" }]
                : arguments_[0] === "children" ? [{ value: "adc@0" }]
                : arguments_[0] === "value" ? [{ value: "19 IRQ_TYPE_EDGE_FALLING", display_string: "19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int" }]
                : arguments_[0] === "navigate" ? [{ value: "reg" }]
                : [];
            if (context.json) { console.log(JSON.stringify({ ok: true, message: "", severity: "info", suggestions })); }
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    test("update value completes through suggest value", async () => {
        const lines = await complete(["update", "spi0/adc@0", "interrupts", ""]);
        expect(lines).toEqual(["19 IRQ_TYPE_EDGE_FALLING\t19 IRQ_TYPE_EDGE_FALLING — spi_pmod1.int"]);
    });
});

describe("move completion", () => {
    beforeEach(() => {
        vi.spyOn(suggest, "run_suggest").mockImplementation(async (context, arguments_) => {
            const key = arguments_.join(" ");
            const suggestions =
                key === "navigate" ? [{ value: "spi0" }, { value: "i2c1" }]
                : arguments_[0] === "children" ? [{ value: "adc@0" }]
                : key === "entry-points" ? [{ value: "spi0" }, { value: "spi1" }]
                : [];
            if (context.json) { console.log(JSON.stringify({ ok: true, message: "", severity: "info", suggestions })); }
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    test("second positional offers destination paths with trailing /", async () => {
        const lines = await complete(["move", "adc", ""]);
        expect(values(lines).some(v => v.endsWith("/"))).toBe(true);
    });
});

describe("list kind completion", () => {
    test("offers exactly the list kinds with their summaries", async () => {
        const lines = await complete(["list", ""]);
        expect(lines.map(line => line.split("\t")[0])).toStrictEqual(LIST_KINDS.map(entry => entry.kind));
    });

    test("filters by prefix", async () => {
        expect((await complete(["list", "va"])).map(line => line.split("\t")[0])).toStrictEqual(["value"]);
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

    test("the bash stub does not re-filter with compgen -W", () => {
        expect(emit("bash")).not.toContain("compgen -W");
    });

    test("the bash stub does not fork a subshell per candidate", () => {
        expect(emit("bash")).not.toContain("$(printf");
    });
});

describe("shell_dequote", () => {
    test.each([
        ["19\\ IRQ_TYPE_", "19 IRQ_TYPE_"],
        ['"19 IRQ', "19 IRQ"],
        ["'a b'", "a b"],
        ["plain", "plain"],
        ["a\\\\b", "a\\b"],
        ['"hello \\"world\\""', 'hello "world"'],
        ["", ""],
    ])("shell_dequote(%j) → %j", (input, expected) => {
        expect(shell_dequote(input)).toBe(expected);
    });
});

describe("quoted prefix matches in __complete", () => {
    beforeEach(() => {
        vi.spyOn(suggest, "run_suggest").mockImplementation(async (context, arguments_) => {
            const suggestions = arguments_[0] === "value"
                ? [{ value: "bash" }, { value: "batch" }]
                : [];
            if (context.json) { console.log(JSON.stringify({ ok: true, message: "", severity: "info", suggestions })); }
        });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    test("a quoted prefix is dequoted before matching", async () => {
        const lines = await complete(["update", "ad7124", "interrupts", "--with", '"ba']);
        expect(values(lines)).toEqual(["bash", "batch"]);
    });
});
