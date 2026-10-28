import * as fs from "node:fs";
import path from "node:path";

import { ensure_caches, type EnsureResult } from "../../config/rebuild";
import { read_settings, save_settings, type ConfigResult, type Settings } from "../../config/settings";
import { format_config_errors } from "../../config/workspace";
import { cancelled, input_error } from "../../protocol/output";
import type { ProgressStream } from "../../progress";
import { bold, create_rl, cyan, step_context, step_linux, step_overlay } from "../../setup";
import type { OverlayChoice } from "../../workfile";
import { format_summary, type Summary } from "../init/command";

/** What the setup run is going to set up, every part checked. */
export interface SetupPlan {
    linux: string;
    devicetree: string;
    overlay: OverlayChoice;
}

export interface SetupResult extends Summary {
    /** True when the binding caches were built, false when they were already current. */
    indexed: boolean;
}

export interface ExecuteOptions {
    cwd?: string;
    /** Builds the binding caches unless they are current; replaced in tests. */
    ensure?: (settings: Settings, cwd: string, stream: ProgressStream) => Promise<ConfigResult<EnsureResult>>;
    stream?: ProgressStream;
    /** Called once the settings are saved, before the (slow) cache build. */
    on_saved?: () => void;
}

/**
 * Save linux, devicetree and the overlay's name, then build the binding
 * caches when they are not current. The workfile itself is left to `init`.
 * What was saved stays when the build fails.
 */
export async function execute_setup(plan: SetupPlan, options: ExecuteOptions = {}): Promise<{ ok: true; result: SetupResult } | { ok: false; message: string }> {
    const cwd = options.cwd ?? process.cwd();
    const overlay = plan.overlay.kind === "keep" ? plan.overlay.path : path.resolve(cwd, plan.overlay.filename);
    save_settings({ linux: plan.linux, devicetree: plan.devicetree, overlay }, cwd);
    options.on_saved?.();

    const settings = read_settings(cwd);
    if (!settings.ok) { return { ok: false, message: format_config_errors(settings.errors).human }; }
    const ensured = await (options.ensure ?? ensure_caches)(settings.value, cwd, options.stream ?? process.stderr);
    if (!ensured.ok || !ensured.value.ok) {
        const reason = ensured.ok ? ensured.value.message : format_config_errors(ensured.errors).human;
        return { ok: false, message: `${reason}\nFix the problem, then run 'attach-linux config --reload' to build the binding caches and 'attach-linux init' to create the workfile.` };
    }
    const exists = fs.statSync(overlay, { throwIfNoEntry: false })?.isFile() === true;
    return { ok: true, result: { linux: plan.linux, devicetree: plan.devicetree, overlay, state: exists ? "kept" : "not created yet", indexed: ensured.value.rebuilt } };
}

/** The three steps, the current values as the Enter defaults. */
async function ask_plan(current: Settings | undefined): Promise<SetupPlan | "cancelled"> {
    const rl = create_rl();
    try {
        console.log("");
        console.log(bold("attach-linux setup"));
        console.log("==================");
        console.log("");
        console.log("This sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.");
        console.log("");
        const linux = await step_linux(rl, current?.linux);
        console.log("");
        const devicetree = await step_context(rl, linux, current?.devicetree);
        console.log("");
        const overlay = await step_overlay(rl, current?.overlay);
        console.log("");
        return { linux, devicetree, overlay };
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "interrupted") { return "cancelled"; }
        throw error;
    } finally {
        rl.close();
    }
}

/**
 * A bare `attach-linux` on a terminal: ask for the Linux tree, the base
 * devicetree and the overlay's name, save them and build the binding caches.
 * `init` creates the workfile.
 */
export async function run_setup(): Promise<void> {
    const settings = read_settings();
    // A config with unknown keys is no reason to refuse: the setup is how a workspace gets fixed. Only TOML that doesn't parse is.
    if (!settings.ok && settings.errors.some(error => error.field === "config.toml")) {
        input_error(format_config_errors(settings.errors).human);
        return;
    }

    const planned = await ask_plan(settings.ok ? settings.value : undefined);
    if (planned === "cancelled") {
        cancelled("\nSetup cancelled.");
        return;
    }

    const executed = await execute_setup(planned, {
        on_saved: () => { console.log(`Saved linux, devicetree and overlay to ${cyan(".attach-linux/config.toml")}.\n`); },
    });
    if (!executed.ok) {
        console.log(executed.message);
        return;
    }
    // After the cache build's progress line.
    if (executed.result.indexed) { console.log(""); }
    for (const line of format_summary(executed.result)) { console.log(line); }
    console.log("");
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    const capture = (): { stream: ProgressStream; text: () => string } => {
        let written = "";
        return { stream: { isTTY: false, write: (chunk: string) => { written += chunk; return true; } }, text: () => written };
    };

    /** A directory with a Linux tree skeleton, a base .dts and a workspace directory. */
    const workspace = (): { root: string; linux: string; dts: string; work: string } => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-setup-"));
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

    test("execute_setup — saves the settings with the overlay's name and builds the caches, creating no workfile", async () => {
        const { root, linux, dts, work } = workspace();
        try {
            const plan: SetupPlan = { linux, devicetree: dts, overlay: { kind: "create", filename: "mine.dtso" } };
            const executed = await execute_setup(plan, { cwd: work, ensure: built, stream: capture().stream });
            expect(executed.ok && executed.result).toEqual({ linux, devicetree: dts, overlay: path.join(work, "mine.dtso"), state: "not created yet", indexed: true });
            expect(fs.existsSync(path.join(work, "mine.dtso"))).toBe(false);
            const saved = read_settings(work);
            expect(saved.ok && saved.value).toMatchObject({ linux, devicetree: dts, overlay: path.join(work, "mine.dtso") });
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("execute_setup — keeping the overlay leaves the file, and a current cache isn't rebuilt", async () => {
        const { root, linux, dts, work } = workspace();
        try {
            const kept = path.join(work, "overlay.dtso");
            fs.writeFileSync(kept, "/dts-v1/;\n/plugin/;\n/ {\n};\n// mine\n");
            const current_caches = async (): Promise<ConfigResult<EnsureResult>> => ({ ok: true, value: { ok: true, rebuilt: false, message: "current" } });
            const executed = await execute_setup({ linux, devicetree: dts, overlay: { kind: "keep", path: kept } }, { cwd: work, ensure: current_caches, stream: capture().stream });
            expect(executed.ok && executed.result).toMatchObject({ state: "kept", indexed: false, overlay: kept });
            expect(fs.readFileSync(kept, "utf8")).toContain("// mine");
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });

    test("execute_setup — a failed cache build keeps the saved settings", async () => {
        const { root, linux, dts, work } = workspace();
        try {
            const failing = async (): Promise<ConfigResult<EnsureResult>> => ({ ok: true, value: { ok: false, rebuilt: true, message: "Compiling binding schemas failed:\nbad binding" } });
            const executed = await execute_setup({ linux, devicetree: dts, overlay: { kind: "create", filename: "overlay.dtso" } }, { cwd: work, ensure: failing, stream: capture().stream });
            expect(!executed.ok && executed.message).toContain("bad binding");
            expect(!executed.ok && executed.message).toContain("config --reload");
            expect(!executed.ok && executed.message).toContain("'attach-linux init' to create the workfile");
            expect(fs.existsSync(path.join(work, "overlay.dtso"))).toBe(false);
            const saved = read_settings(work);
            expect(saved.ok && saved.value).toMatchObject({ linux, overlay: path.join(work, "overlay.dtso") });
        } finally {
            fs.rmSync(root, { recursive: true });
        }
    });
}
