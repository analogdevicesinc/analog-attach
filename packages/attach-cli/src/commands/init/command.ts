import { Command } from "commander";
import * as fs from "node:fs";
import path from "node:path";

import type { LocalContext } from "../../context";
import type { Settings } from "../../config/settings";
import { load_workspace } from "../../config/workspace";
import { respond, respond_fail } from "../../protocol/output";
import type { CommonResponse, InitResponse } from "../../protocol/types";
import { bold, cyan, dim } from "../../setup";
import { create_workfile, creation_problem, existing_overlay } from "../../workfile";

/** Create the configured workfile, or keep it when its file exists. The settings must have linux, devicetree and overlay. */
export function init_workfile(current: Settings & { linux: string; devicetree: string; overlay: string }, cwd = process.cwd()): InitResponse | CommonResponse {
    const kept = existing_overlay(current) !== undefined;
    if (!kept) {
        const problem = creation_problem(current.overlay);
        if (problem !== undefined) {
            return {
                ok: false,
                message: `Cannot create the workfile: ${problem}. Configure another with 'attach-linux config overlay <name>'.`,
                severity: "error",
            };
        }
        create_workfile(current.overlay, cwd);
    }
    const overlay = current.overlay;
    const created = !kept;
    return {
        ok: true,
        message: `Workspace ready: linux ${current.linux}, devicetree ${current.devicetree}, overlay ${overlay} (${created ? "created" : "kept"})`,
        severity: "info",
        linux: current.linux,
        devicetree: current.devicetree,
        overlay,
        created,
    };
}

/** What became of the overlay: init created or kept the file, or the setup run named one init has yet to create. */
export type OverlayState = "created" | "kept" | "not created yet";

export interface Summary {
    linux: string;
    devicetree: string;
    overlay: string;
    state: OverlayState;
    /** The setup run: whether it built the caches. */
    indexed?: boolean;
}

/** The lines printed once the workspace is set up; a workfile not created yet makes `init` the first step. */
export function format_summary(summary: Summary): string[] {
    const steps = [
        ...(summary.state === "not created yet" ? [["Create the workfile:", "attach-linux init"]] : []),
        ["Search for devices to add to the overlay:", "attach-linux list devices [filter]"],
        ["Add one (it asks for the missing required properties):", "attach-linux add <compatible>"],
    ];
    return [
        bold(summary.state === "not created yet" ? "Workspace configured" : "Workspace ready"),
        "",
        `  Linux:       ${summary.linux}`,
        `  Devicetree:  ${summary.devicetree}`,
        `  Overlay:     ${summary.overlay} ${dim(`(${summary.state})`)}`,
        ...(summary.indexed === undefined ? [] : [`  Caches:      ${summary.indexed ? "built now" : "current"}`]),
        "",
        bold("Next steps:"),
        "",
        ...steps.flatMap(([text, command], index) => [`  ${cyan(`${index + 1}.`)} ${text}`, `     ${dim(command ?? "")}`, ""]),
        `  Run ${cyan("attach-linux config --reload")} after the bindings of the Linux tree change.`,
    ];
}

export function build_init_command(context: LocalContext): Command {
    return new Command("init")
        .description("Create the overlay workfile, or keep the configured one")
        .addHelpText("after", `
init needs linux, devicetree and overlay configured, with the binding caches
built (a bare 'attach-linux' on a terminal sets them up, or 'attach-linux
config linux <path>', 'config devicetree <path>' and 'config overlay <name>').
It never asks.

When the configured overlay file exists, init keeps it; otherwise it creates
it, empty. It never picks another name.

--json gives { linux, devicetree, overlay, created }.

Examples:
  $ attach-linux init
  $ attach-linux --json init`)
        .action(() => {
            const workspace = load_workspace(context, ["bindings", "base", "overlay_path"]);
            if (!workspace) { return; }
            const { settings } = workspace;
            const response = init_workfile({ ...settings, linux: workspace.bindings.linux, devicetree: workspace.base.source, overlay: workspace.overlay_path });
            if (!("overlay" in response)) {
                if (context.json) { respond_fail(response); } else { console.log(response.message); }
                return;
            }
            if (context.json) {
                respond(response);
                return;
            }
            for (const line of format_summary({ ...response, state: response.created ? "created" : "kept" })) { console.log(line); }
            console.log("");
        });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");
    const { read_settings } = await import("../../config/settings");

    const SETTINGS_BASE = { overlay_syntax: "fragment", preprocess_command: "", linux: "/l", devicetree: "/d.dts" } as const;
    const plain = (lines: string[]): string => lines.join("\n").replaceAll(/\u001B\[[0-9;]*m/g, "");

    test("init_workfile — creates the configured workfile, then keeps it on a re-run", () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "attach-init-"));
        try {
            const overlay = path.join(work, "overlay.dtso");
            const first = init_workfile({ ...SETTINGS_BASE, overlay }, work);
            expect(first).toMatchObject({ ok: true, linux: "/l", devicetree: "/d.dts", overlay, created: true });
            expect(first.message).toBe(`Workspace ready: linux /l, devicetree /d.dts, overlay ${overlay} (created)`);
            expect(fs.readFileSync(overlay, "utf8")).toContain("/plugin/;");
            const saved = read_settings(work);
            expect(saved.ok && saved.value.overlay).toBe(overlay);

            fs.appendFileSync(overlay, "// mine\n");
            const second = init_workfile({ ...SETTINGS_BASE, overlay }, work);
            expect(second).toMatchObject({ overlay, created: false });
            expect(fs.readFileSync(overlay, "utf8")).toContain("// mine");
        } finally {
            fs.rmSync(work, { recursive: true });
        }
    });

    test("init_workfile — refuses a path whose directory is missing, or that isn't a file", () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "attach-init-"));
        try {
            expect(init_workfile({ ...SETTINGS_BASE, overlay: work }, work).message).toContain(`${work} is not a file`);
            const nowhere = path.join(work, "gone", "x.dtso");
            const refused = init_workfile({ ...SETTINGS_BASE, overlay: nowhere }, work);
            expect(refused).toMatchObject({ ok: false, severity: "error" });
            expect(refused.message).toContain(`${path.join(work, "gone")} is not a directory`);
            expect(refused.message).toContain("config overlay <name>");
            expect(fs.readdirSync(work)).toEqual([]);
        } finally {
            fs.rmSync(work, { recursive: true });
        }
    });

    test("format_summary — names the three paths and what became of the overlay; the caches only for the setup run", () => {
        const summary: Summary = { linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", state: "created" };
        expect(plain(format_summary(summary))).toContain("Linux:       /l");
        expect(plain(format_summary(summary))).toContain("Overlay:     /w/overlay.dtso (created)");
        expect(plain(format_summary(summary))).not.toContain("Caches:");
        expect(plain(format_summary(summary))).not.toContain("attach-linux init");
        expect(plain(format_summary({ ...summary, indexed: false }))).toContain("Caches:      current");
    });

    test("format_summary — a workfile not created yet makes init the first step", () => {
        const text = plain(format_summary({ linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", state: "not created yet", indexed: true }));
        expect(text).toContain("Workspace configured");
        expect(text).toContain("Overlay:     /w/overlay.dtso (not created yet)");
        expect(text).toContain("1. Create the workfile:\n     attach-linux init");
        expect(text).toContain("3. Add one");
    });
}
