// An in-memory backend for the front end's tests: a few settings of each kind, a check
// hook with `also`, one command per way a command can end, commands that echo what they
// got, two extras, backend flags, a `complete` with every shape, and an optional setup.

import {
    answer, cancelled, command, input_error, PromptCancelled, refuse,
    type Backend, type Completion, type ExtraCommand, type InteractiveSession, type Outcome, type SettingSpec, type SettingsHooks, type Slot,
} from "../../interface/backend-interface";
import type { CommonResponse, SetupResponse } from "../../interface/backend-responses";

export const FAKE_SETTINGS: readonly SettingSpec[] = [
    { key: "tree", category: "Sources", description: "The source tree", type: "path", required: true, must_exist: true, hint: "Run 'analog-attach config tree <path>'." },
    { key: "modules", category: "Sources", description: "Module directories", type: "path_list", required: false },
    { key: "syntax", category: "Output", description: "Output syntax", type: "string", options: ["fragment", "label"], required: false, default: "fragment" },
    { key: "board", category: "Target", description: "Board; setting it sets its chip", type: "string", options: "dynamic", required: false },
    { key: "chip", category: "Target", description: "Chip", type: "string", required: false },
];

/** Board → the chip it carries. */
export const FAKE_BOARDS: Readonly<Record<string, string | undefined>> = { "eval-a": "chip-a", "eval-b": "chip-b", "bare": undefined };

export const FAKE_HOOKS: SettingsHooks = {
    options: key => Promise.resolve(key === "board" ? Object.keys(FAKE_BOARDS) : []),
    check: (key, value) => {
        // eslint-disable-next-line unicorn/no-null -- `also` resets a setting with null
        if (key === "board") { return Promise.resolve({ ok: true, also: { chip: FAKE_BOARDS[value] ?? null } }); }
        if (key === "chip" && value.startsWith("x")) { return Promise.resolve({ ok: false, message: `chip: no chip ${value}` }); }
        return Promise.resolve({ ok: true });
    },
};

export interface FakeCounters {
    /** How often `read`'s response thunk ran. */
    read_response: number;
    /** How often `read`'s Render ran. */
    read_render: number;
}

export interface FakeOptions {
    /** Default `fake`. */
    id?: string;
    /** A directory with a SKILL.md: the backend gets the skill `fake-skill` from it. */
    skill_dir?: string;
    /** `ready`: setup asks for `tree` and is ready; `not-ready`: it answers without; default: no setup. */
    setup?: "ready" | "not-ready";
    /** Without extras (`list parent`, `move`) and the backend flags of `add` and `build`. */
    plain?: boolean;
    /** A `changed` hook. */
    changed?: SettingsHooks["changed"];
}

/** The fake's completion: a little of every shape (groups, partial stems, the files fallback). */
function fake_complete(slot: Slot): Completion {
    switch (slot.kind) {
        case "device": { return { candidates: [{ value: "adi,ad7124-8", description: "ADC" }, { value: "adi,ad5592r" }] }; }
        case "path": { return { candidates: [{ value: "spi0/", partial: true }, { value: "spi1/", partial: true }] }; }
        case "property": {
            return {
                candidates: [
                    { value: "reg", description: "required", group: "set" },
                    { value: "status", group: "set" },
                    { value: "fan-", description: "child node", partial: true, group: "not set" },
                ],
            };
        }
        case "value": { return { candidates: [{ value: "0x10" }, { value: "&vref" }] }; }
        case "source": { return { candidates: [{ value: "rpi-ad7124.dtbo", description: "overlays/rpi-ad7124.dts" }], fallback: "files" }; }
        case "flag": { return { candidates: slot.flag === "parent" ? [{ value: "spi0" }, { value: "i2c1" }] : [] }; }
        case "extra": { return { candidates: [{ value: `${slot.id}-a` }] }; }
    }
}

/** An answer that echoes what the command got, so tests see the parsing. Not the command's response type: a fake. */
function echo<R>(name: string, arguments_: unknown, flags: unknown): Outcome<R> {
    const text = `${name} ${JSON.stringify(arguments_)} ${JSON.stringify(flags)}`;
    const response: CommonResponse & { arguments: unknown; flags: unknown } = { ok: true, message: name, severity: "info", arguments: arguments_, flags };
    return answer(response as unknown as R, text);
}

const MOVE: ExtraCommand = {
    docs: { brief: "Move a node to another parent", examples: ["move spi0/adc@0 spi1"] },
    positionals: [
        { name: "path", placeholder: "path", brief: "The node", slot: () => ({ kind: "path", command: "move" }) },
        { name: "destination", placeholder: "destination", brief: "The new parent", slot: prior => ({ kind: "extra", command: "move", id: "destination", prior }) },
    ],
    flags: { "dry-run": { kind: "boolean", brief: "Say what would move" } },
    group: "edit",
    schema: "move.schema.json",
    run: (arguments_, flags) => Promise.resolve(echo("move", arguments_, flags)),
};

const LIST_PARENT: ExtraCommand = {
    docs: { brief: "List the parents a device can go under" },
    positionals: [{ name: "device", placeholder: "device", brief: "The device", slot: () => ({ kind: "device", command: "list parent" }) }],
    schema: "list-parent.schema.json",
    run: arguments_ => Promise.resolve(echo("list parent", arguments_, {})),
};

/** A fresh fake backend, with counters for the laziness of `read`'s outcome, and the slots `complete` got. */
export function create_fake_backend(options: FakeOptions = {}): { backend: Backend; counters: FakeCounters; slots: Slot[] } {
    const counters: FakeCounters = { read_response: 0, read_render: 0 };
    const slots: Slot[] = [];
    const id = options.id ?? "fake";
    const backend: Backend = {
        id,
        title: `Fake devices (${id})`,
        version: "0.0.0",
        words: { device: "device", path: "path", workfile: "workfile" },
        settings: FAKE_SETTINGS,
        settings_hooks: { ...FAKE_HOOKS, ...(options.changed === undefined ? {} : { changed: options.changed }) },
        skills: options.skill_dir === undefined ? [] : [{ name: "fake-skill", about: "fake devices", source_dir: options.skill_dir }],
        commands: {
            init: command({
                run: (_arguments, _flags, session) => Promise.resolve(answer(
                    { ok: true, message: "Created the workfile", severity: "info" as const, path: `${session.cwd}/workfile`, created: true },
                    "Created the workfile",
                )),
            }),
            import: command({ run: arguments_ => Promise.resolve(echo("import", arguments_, {})) }),
            list: {
                devices: command({
                    docs: { placeholders: { filter: "prefix" } },
                    run: arguments_ => Promise.resolve(echo("list devices", arguments_, {})),
                }),
                property: command({ run: arguments_ => Promise.resolve(echo("list property", arguments_, {})) }),
                value: command({ run: arguments_ => Promise.resolve(echo("list value", arguments_, {})) }),
            },
            // answer, both sides lazy
            read: command({
                run: () => Promise.resolve(answer(
                    () => { counters.read_response += 1; return Promise.resolve({ kind: "node" as const, key: "/", properties: [], children: [], origin: "fake" }); },
                    style => { counters.read_render += 1; return style.bold("/ {}"); },
                )),
            }),
            // refused
            delete: command({ run: () => Promise.resolve(refuse("Nothing to delete")) }),
            // input-error
            rename: command({ run: arguments_ => Promise.resolve(input_error(`Bad name: ${arguments_.name}`)) }),
            // cancelled
            update: command({ run: () => Promise.resolve(cancelled("Cancelled.")) }),
            // a prompt stopped: thrown
            add: command({
                ...(options.plain === true ? {} : { flags: { parent: { kind: "value", brief: "Parent node", placeholder: "path" } } as const }),
                run: () => Promise.reject(new PromptCancelled("Add cancelled.")),
            }),
            // a crash
            validate: command({ run: () => Promise.reject(new Error("validator crashed")) }),
            build: command({
                ...(options.plain === true ? {} : { flags: { board: { kind: "value", brief: "Board to build for", placeholder: "board" } } as const }),
                run: (arguments_, flags) => Promise.resolve(echo("build", arguments_, flags)),
            }),
        },
        ...(options.plain === true ? {} : { extra: { "list parent": LIST_PARENT, move: MOVE } }),
        complete: slot => {
            slots.push(slot);
            return Promise.resolve(fake_complete(slot));
        },
        ...(options.setup === undefined ? {} : {
            setup: async (session: InteractiveSession): Promise<Outcome<SetupResponse>> => {
                if (options.setup === "not-ready") {
                    return answer({ ok: true, message: "Nothing set", severity: "info", saved: [], ready: false }, "Nothing set up.");
                }
                const tree = await session.prompter.input({ message: "Source tree" });
                const write = await session.settings.set("tree", tree);
                if (!write.ok) { return refuse(write.message); }
                session.say("Asked for the tree.");
                return answer({ ok: true, message: "Saved tree", severity: "info", saved: ["tree"], ready: true }, "Saved tree.");
            },
        }),
    };
    return { backend, counters, slots };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { default: path } = await import("node:path");
    const { open_settings, settings_files, backend_setting } = await import("../settings-store");
    const { create_session } = await import("../session");
    const { capture_stream } = await import("../output");

    test("the fake backend's settings through the store and a session: board sets its chip, a bare board resets it", async () => {
        const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aa-fake-")));
        try {
            const { backend } = create_fake_backend();
            const files = settings_files({ cwd: base, home: path.join(base, "home") });
            const settings = open_settings({
                files,
                specs: [backend_setting(["fake"]), ...backend.settings],
                hooks: backend.settings_hooks,
                session: () => session,
            });
            const session = create_session({
                program: "analog-attach", mode: "text", cwd: base, project_root: files.project_root, backend_id: backend.id,
                assets_dir: base, settings, streams: { stdout: capture_stream(), stderr: capture_stream() },
            });
            expect(await settings.set("board", "nope")).toEqual({ ok: false, message: "board: \"nope\" is not one of eval-a | eval-b | bare" });
            expect(await settings.set("board", "eval-a")).toMatchObject({ ok: true });
            expect([settings.get("board"), settings.get("chip")]).toEqual(["eval-a", "chip-a"]);
            expect(await settings.set("board", "bare")).toMatchObject({ ok: true });
            expect(settings.origin("chip")).toBe("unset");
            expect(await settings.set("chip", "xyz")).toEqual({ ok: false, message: "chip: no chip xyz" });
            expect(settings.get("syntax")).toBe("fragment");
        } finally {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });
}
