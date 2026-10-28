import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";
import { ensure_caches, type EnsureResult } from "../../config/rebuild";
import { read_settings, save_settings, type ConfigResult, type Settings } from "../../config/settings";
import { format_config_errors } from "../../config/workspace";
import { on_terminal } from "../../missing-required";
import { cancelled, input_error, respond, respond_fail } from "../../protocol/output";
import type { InitResponse } from "../../protocol/types";
import type { ProgressStream } from "../../progress";
import { bold, check_devicetree, check_linux, create_rl, cyan, dim, step_context, step_linux, step_overlay } from "../../setup";
import { create_workfile, next_workfile_name, workfile_filename, workfile_problem, type OverlayChoice } from "../../workfile";

export interface InitOptions {
    linux?: string;
    devicetree?: string;
    overlay?: string;
}

/** What init is going to set up, every part checked. */
export interface InitPlan {
    linux: string;
    devicetree: string;
    overlay: OverlayChoice;
}

/** A refusal: `missing` is a required input that was not given (an input error), `invalid` one that was given and is wrong. */
export interface InitProblem {
    kind: "missing" | "invalid";
    message: string;
}

export type Planned<T> = { ok: true; value: T } | ({ ok: false } & InitProblem);

const problem = (kind: InitProblem["kind"], message: string): { ok: false } & InitProblem => ({ ok: false, kind, message });

/** The configured overlay, when its file exists. */
export function existing_overlay(current: Settings | undefined): string | undefined {
    return current?.overlay !== undefined && fs.statSync(current.overlay, { throwIfNoEntry: false })?.isFile() === true ? current.overlay : undefined;
}

/** The linux tree from `--linux` or, without it, the configured one. */
export function plan_linux(flag: string | undefined, current: Settings | undefined): Planned<string> {
    const chosen = flag ?? current?.linux;
    if (chosen === undefined) { return problem("missing", "init needs --linux <path>: no Linux tree is configured"); }
    const checked = check_linux(chosen);
    return checked.ok ? { ok: true, value: checked.path } : problem("invalid", `linux: ${checked.problem}`);
}

/** The base devicetree from `--devicetree` or, without it, the configured one. */
export function plan_devicetree(flag: string | undefined, current: Settings | undefined): Planned<string> {
    const chosen = flag ?? current?.devicetree;
    if (chosen === undefined) { return problem("missing", "init needs --devicetree <path>: no base devicetree is configured"); }
    const checked = check_devicetree(chosen);
    return checked.ok ? { ok: true, value: checked.path } : problem("invalid", `devicetree: ${checked.problem}`);
}

/**
 * The overlay without asking: `--overlay <name>` creates that file (an existing one is refused, never
 * overwritten); without it the configured overlay is kept when its file exists, else the next free
 * `overlay[-N].dtso` is created.
 */
export function plan_overlay(flag: string | undefined, current: Settings | undefined, cwd = process.cwd()): Planned<OverlayChoice> {
    if (flag !== undefined) {
        const filename = workfile_filename(flag);
        const refused = workfile_problem(filename, cwd);
        return refused === undefined ? { ok: true, value: { kind: "create", filename } } : problem("invalid", refused);
    }
    const kept = existing_overlay(current);
    return { ok: true, value: kept === undefined ? { kind: "create", filename: next_workfile_name("overlay", cwd) } : { kind: "keep", path: kept } };
}

/** The whole plan from the flags and the current settings, asking nothing. */
export function plan_from_flags(options: InitOptions, current: Settings | undefined, cwd = process.cwd()): Planned<InitPlan> {
    const linux = plan_linux(options.linux, current);
    if (!linux.ok) { return linux; }
    const devicetree = plan_devicetree(options.devicetree, current);
    if (!devicetree.ok) { return devicetree; }
    const overlay = plan_overlay(options.overlay, current, cwd);
    if (!overlay.ok) { return overlay; }
    return { ok: true, value: { linux: linux.value, devicetree: devicetree.value, overlay: overlay.value } };
}

export interface ExecuteOptions {
    cwd?: string;
    /** Builds the binding caches unless they are current; replaced in tests. */
    ensure?: (settings: Settings, cwd: string, stream: ProgressStream) => Promise<ConfigResult<EnsureResult>>;
    stream?: ProgressStream;
    /** Called once linux and devicetree are saved, before the (slow) cache build. */
    on_saved?: () => void;
}

/**
 * Save linux and devicetree, build the binding caches when they are not
 * current, then create the workfile (or keep the configured one). Stops at the
 * first failure; what was saved before it stays.
 */
export async function execute_init(plan: InitPlan, options: ExecuteOptions = {}): Promise<{ ok: true; response: InitResponse } | { ok: false; message: string }> {
    const cwd = options.cwd ?? process.cwd();
    save_settings({ linux: plan.linux, devicetree: plan.devicetree }, cwd);
    options.on_saved?.();

    const settings = read_settings(cwd);
    if (!settings.ok) { return { ok: false, message: format_config_errors(settings.errors).human }; }
    const ensured = await (options.ensure ?? ensure_caches)(settings.value, cwd, options.stream ?? process.stderr);
    if (!ensured.ok || !ensured.value.ok) {
        const reason = ensured.ok ? ensured.value.message : format_config_errors(ensured.errors).human;
        return { ok: false, message: `${reason}\nFix the problem, then run 'attach-linux config-get --reload' to build the binding caches and 'attach-linux init' again.` };
    }

    const overlay = plan.overlay.kind === "keep" ? plan.overlay.path : create_workfile(plan.overlay.filename, cwd).path;
    const created = plan.overlay.kind === "create";
    return {
        ok: true,
        response: {
            ok: true,
            message: `Workspace ready: linux ${plan.linux}, devicetree ${plan.devicetree}, overlay ${overlay} (${created ? "created" : "kept"})`,
            severity: "info",
            linux: plan.linux,
            devicetree: plan.devicetree,
            overlay,
            created,
            indexed: ensured.value.rebuilt,
        },
    };
}

/** The lines `init` prints when it is done. */
export function format_summary(response: InitResponse): string[] {
    return [
        bold("Workspace ready"),
        "",
        `  Linux:       ${response.linux}`,
        `  Devicetree:  ${response.devicetree}`,
        `  Overlay:     ${response.overlay} ${dim(response.created ? "(created)" : "(kept)")}`,
        `  Caches:      ${response.indexed ? "built now" : "current"}`,
        "",
        bold("Next steps:"),
        "",
        `  ${cyan("1.")} Search for devices to add to the overlay:`,
        `     ${dim("attach-linux list devices [filter]")}`,
        "",
        `  ${cyan("2.")} Add one (it asks for the missing required properties):`,
        `     ${dim("attach-linux add <compatible>")}`,
        "",
        `  Run ${cyan("attach-linux config-get --reload")} after the bindings of the Linux tree change.`,
    ];
}

/** The questions, on a terminal. What the flags give is not asked; `wizard` (no flags at all) asks everything, the current values as defaults. */
async function ask_plan(options: InitOptions, current: Settings | undefined, wizard: boolean): Promise<Planned<InitPlan> | "cancelled"> {
    const rl = create_rl();
    let asked = false;
    const intro = (): void => {
        if (asked) { return; }
        asked = true;
        console.log("");
        console.log(bold("attach-linux init"));
        console.log("=================");
        console.log("");
        console.log("This sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.");
        console.log("");
    };
    try {
        let linux: string;
        if (options.linux === undefined && (wizard || current?.linux === undefined)) {
            intro();
            linux = await step_linux(rl, current?.linux);
            console.log("");
        } else {
            const planned = plan_linux(options.linux, current);
            if (!planned.ok) { return planned; }
            linux = planned.value;
        }

        let devicetree: string;
        if (options.devicetree === undefined && (wizard || current?.devicetree === undefined)) {
            intro();
            devicetree = await step_context(rl, linux, current?.devicetree);
            console.log("");
        } else {
            const planned = plan_devicetree(options.devicetree, current);
            if (!planned.ok) { return planned; }
            devicetree = planned.value;
        }

        let overlay: OverlayChoice;
        const kept = existing_overlay(current);
        if (options.overlay === undefined && (wizard || (kept === undefined && asked))) {
            intro();
            overlay = await step_overlay(rl, kept);
            console.log("");
        } else {
            const planned = plan_overlay(options.overlay, current);
            if (!planned.ok) { return planned; }
            overlay = planned.value;
        }
        return { ok: true, value: { linux, devicetree, overlay } };
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "interrupted") { return "cancelled"; }
        throw error;
    } finally {
        rl.close();
    }
}

export function build_init_command(context: LocalContext): Command {
    return new Command("init")
        .description("Set up the workspace: Linux tree, base devicetree and the overlay workfile")
        .option("--linux <path>", "Linux kernel source tree (its binding caches are built)")
        .option("--devicetree <path>", "Base .dts file")
        .option("--overlay <name>", "Create a new overlay workfile with this name (.dtso is added); never overwrites")
        .addHelpText("after", `
On a terminal without options (a bare 'attach-linux' does the same) init asks
for the Linux tree and the base devicetree, then for the overlay file name. On
a re-run the configured values are the Enter defaults, and the overlay can be
kept or replaced by a new one.

With --linux and --devicetree, or with --json, init never asks. A value you
leave out is taken from the configuration; without one it is an input error
(exit 2). Without --overlay the configured overlay is kept, or overlay.dtso
(overlay-1.dtso, ... when it exists) is created. On a terminal with only some
of the options, init asks for what is neither given nor configured.

The binding caches (compat index and validation.json) are built from the Linux
tree unless they are already current for it (about 50 s for the kernel tree).
overlay-syntax, preprocess-command and deploy-* are set with config-set.

--json gives { linux, devicetree, overlay, created, indexed }.

Examples:
  $ attach-linux init
  $ attach-linux init --linux ~/linux --devicetree ~/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
  $ attach-linux init --overlay my-overlay`)
        .action(async (options: InitOptions) => {
            const settings = read_settings();
            // A config with unknown keys is no reason to refuse: init is how a workspace gets fixed. Only TOML that doesn't parse is.
            if (!settings.ok && settings.errors.some(error => error.field === "config.toml")) {
                input_error(format_config_errors(settings.errors).human);
                return;
            }
            const current = settings.ok ? settings.value : undefined;

            const given = options.linux !== undefined || options.devicetree !== undefined || options.overlay !== undefined;
            const full_flags = options.linux !== undefined && options.devicetree !== undefined;
            const ask = !context.json && on_terminal() && !full_flags;

            const planned = ask ? await ask_plan(options, current, !given) : plan_from_flags(options, current);
            if (planned === "cancelled") {
                cancelled("\nSetup cancelled.");
                return;
            }
            if (!planned.ok) {
                if (planned.kind === "missing") { input_error(planned.message); }
                else if (context.json) { respond_fail({ ok: false, message: planned.message, severity: "error" }); }
                else { console.log(planned.message); }
                return;
            }

            const result = await execute_init(planned.value, {
                on_saved: () => { if (!context.json) { console.log(`Saved linux and devicetree to ${cyan(".attach-linux/config.toml")}.\n`); } },
            });
            if (!result.ok) {
                if (context.json) { respond_fail({ ok: false, message: result.message, severity: "error" }); }
                else { console.log(result.message); }
                return;
            }
            if (context.json) { respond(result.response); }
            else {
                // After the cache build's progress line.
                if (result.response.indexed) { console.log(""); }
                for (const line of format_summary(result.response)) { console.log(line); }
                console.log("");
            }
        });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    const capture = (): { stream: ProgressStream; text: () => string } => {
        let written = "";
        return { stream: { isTTY: false, write: (chunk: string) => { written += chunk; return true; } }, text: () => written };
    };
    const SETTINGS_BASE = { overlay_syntax: "fragment", preprocess_command: "" } as const;

    /** A directory with a Linux tree skeleton, a base .dts and a workspace directory. */
    const workspace = (): { root: string; linux: string; dts: string; work: string } => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-init-"));
        const linux = path.join(root, "linux");
        fs.mkdirSync(path.join(linux, "Documentation", "devicetree", "bindings"), { recursive: true });
        fs.mkdirSync(path.join(linux, "include"), { recursive: true });
        const dts = path.join(root, "base.dts");
        fs.writeFileSync(dts, "/dts-v1/;\n/ {\n};\n");
        const work = path.join(root, "work");
        fs.mkdirSync(work);
        return { root, linux, dts, work };
    };
    const built = async (): Promise<ConfigResult<EnsureResult>> => ({ ok: true, value: { ok: true, rebuilt: true, message: "built" } });

    test("plan_from_flags — linux and devicetree come from the flags, else the configuration, else it is a missing input", () => {
        const { root, linux, dts, work } = workspace();
        try {
            const missing = plan_from_flags({}, undefined, work);
            expect(!missing.ok && missing.kind).toBe("missing");
            expect(!missing.ok && missing.message).toContain("--linux");
            const half = plan_from_flags({ linux }, undefined, work);
            expect(!half.ok && half.message).toContain("--devicetree");

            const planned = plan_from_flags({ linux, devicetree: dts }, undefined, work);
            expect(planned).toEqual({ ok: true, value: { linux, devicetree: dts, overlay: { kind: "create", filename: "overlay.dtso" } } });

            const configured = plan_from_flags({}, { ...SETTINGS_BASE, linux, devicetree: dts }, work);
            expect(configured.ok && configured.value.linux).toBe(linux);
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("plan_from_flags — a path that is not a Linux tree or a file is invalid, not missing", () => {
        const { root, linux, dts, work } = workspace();
        try {
            const not_linux = plan_from_flags({ linux: work, devicetree: dts }, undefined, work);
            expect(!not_linux.ok && not_linux.kind).toBe("invalid");
            expect(!not_linux.ok && not_linux.message).toContain("not a Linux source tree");
            const no_file = plan_from_flags({ linux, devicetree: path.join(root, "nope.dts") }, undefined, work);
            expect(!no_file.ok && no_file.message).toContain("Path does not exist");
            const directory = plan_from_flags({ linux, devicetree: work }, undefined, work);
            expect(!directory.ok && directory.message).toContain("Not a file");
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("plan_overlay — --overlay creates a new file and refuses an existing one; without it the configured file is kept", () => {
        const { root, work } = workspace();
        try {
            expect(plan_overlay("mine", undefined, work)).toEqual({ ok: true, value: { kind: "create", filename: "mine.dtso" } });
            fs.writeFileSync(path.join(work, "mine.dtso"), "");
            const refused = plan_overlay("mine.dtso", undefined, work);
            expect(!refused.ok && refused.kind).toBe("invalid");
            expect(!refused.ok && refused.message).toContain("mine.dtso already exists");

            const configured = { ...SETTINGS_BASE, overlay: path.join(work, "mine.dtso") };
            expect(plan_overlay(undefined, configured, work)).toEqual({ ok: true, value: { kind: "keep", path: configured.overlay } });
            // A configured overlay whose file is gone is replaced by a new one, not kept.
            fs.rmSync(configured.overlay);
            expect(plan_overlay(undefined, configured, work)).toEqual({ ok: true, value: { kind: "create", filename: "overlay.dtso" } });
            fs.writeFileSync(path.join(work, "overlay.dtso"), "");
            expect(plan_overlay(undefined, undefined, work)).toEqual({ ok: true, value: { kind: "create", filename: "overlay-1.dtso" } });
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("execute_init — saves the settings, builds the caches and creates the workfile", async () => {
        const { root, linux, dts, work } = workspace();
        try {
            const planned = plan_from_flags({ linux, devicetree: dts }, undefined, work);
            if (!planned.ok) { throw new Error(planned.message); }
            const result = await execute_init(planned.value, { cwd: work, ensure: built, stream: capture().stream });
            expect(result.ok && result.response).toMatchObject({ ok: true, linux, devicetree: dts, overlay: path.join(work, "overlay.dtso"), created: true, indexed: true });
            expect(fs.readFileSync(path.join(work, "overlay.dtso"), "utf8")).toContain("/plugin/;");
            const saved = read_settings(work);
            expect(saved.ok && saved.value).toMatchObject({ linux, devicetree: dts, overlay: path.join(work, "overlay.dtso") });
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("execute_init — a re-run keeps the configured values and the overlay file, and skips a current cache build", async () => {
        const { root, linux, dts, work } = workspace();
        try {
            const first = plan_from_flags({ linux, devicetree: dts }, undefined, work);
            if (!first.ok) { throw new Error(first.message); }
            await execute_init(first.value, { cwd: work, ensure: built, stream: capture().stream });
            fs.writeFileSync(path.join(work, "overlay.dtso"), "/dts-v1/;\n/plugin/;\n/ {\n};\n// mine\n");

            const current = read_settings(work);
            const second = plan_from_flags({}, current.ok ? current.value : undefined, work);
            expect(second.ok && second.value.overlay).toEqual({ kind: "keep", path: path.join(work, "overlay.dtso") });
            if (!second.ok) { throw new Error(second.message); }
            const current_caches = async (): Promise<ConfigResult<EnsureResult>> => ({ ok: true, value: { ok: true, rebuilt: false, message: "current" } });
            const result = await execute_init(second.value, { cwd: work, ensure: current_caches, stream: capture().stream });
            expect(result.ok && result.response).toMatchObject({ created: false, indexed: false, overlay: path.join(work, "overlay.dtso") });
            expect(fs.readFileSync(path.join(work, "overlay.dtso"), "utf8")).toContain("// mine");
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("execute_init — a failed cache build keeps the saved settings and creates no workfile", async () => {
        const { root, linux, dts, work } = workspace();
        try {
            const planned = plan_from_flags({ linux, devicetree: dts }, undefined, work);
            if (!planned.ok) { throw new Error(planned.message); }
            const failing = async (): Promise<ConfigResult<EnsureResult>> => ({ ok: true, value: { ok: false, rebuilt: true, message: "Compiling binding schemas failed:\nbad binding" } });
            const result = await execute_init(planned.value, { cwd: work, ensure: failing, stream: capture().stream });
            expect(!result.ok && result.message).toContain("bad binding");
            expect(!result.ok && result.message).toContain("config-get --reload");
            expect(fs.existsSync(path.join(work, "overlay.dtso"))).toBe(false);
            const saved = read_settings(work);
            expect(saved.ok && saved.value.linux).toBe(linux);
            expect(saved.ok && saved.value.overlay).toBeUndefined();
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("format_summary — names the three paths and what init did with the overlay", () => {
        const lines = format_summary({ ok: true, message: "", severity: "info", linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", created: true, indexed: false });
        const text = lines.join("\n").replaceAll(/\u001B\[[0-9;]*m/g, "");
        expect(text).toContain("Linux:       /l");
        expect(text).toContain("Overlay:     /w/overlay.dtso (created)");
        expect(text).toContain("Caches:      current");
    });
}
