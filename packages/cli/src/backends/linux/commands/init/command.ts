import * as fs from "node:fs";
import path from "node:path";

import { answer, command, refuse, type Style } from "../../../../interface/backend-interface";
import { DEFAULT_PROGRAM, type Settings } from "../../config/settings";
import { load_workspace } from "../../config/workspace";
import type { CommonResponse, InitResponse } from "../../protocol/types";
import { create_workfile, creation_problem, existing_overlay } from "../../workfile";

/** Create the configured workfile, or keep it when its file exists. The settings must have linux, devicetree and workfile. */
export function init_workfile(
    current: Settings & { linux: string; devicetree: string; workfile: string },
    cwd = process.cwd(),
    program = DEFAULT_PROGRAM,
): InitResponse | (CommonResponse & { ok: false }) {
    const kept = existing_overlay(current) !== undefined;
    if (!kept) {
        const problem = creation_problem(current.workfile);
        if (problem !== undefined) {
            return {
                ok: false,
                message: `Cannot create the workfile: ${problem}. Configure another with '${program} config workfile <name>'.`,
                severity: "error",
            };
        }
        create_workfile(current.workfile, cwd);
    }
    const overlay = current.workfile;
    const created = !kept;
    return {
        ok: true,
        message: `Workspace ready: linux ${current.linux}, devicetree ${current.devicetree}, overlay ${overlay} (${created ? "created" : "kept"})`,
        severity: "info",
        path: overlay,
        created,
        linux: current.linux,
        devicetree: current.devicetree,
        overlay,
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
export function format_summary(summary: Summary, { bold, cyan, dim }: Pick<Style, "bold" | "cyan" | "dim">, program: string): string[] {
    const steps = [
        ...(summary.state === "not created yet" ? [["Create the workfile:", `${program} init`]] : []),
        ["Search for devices to add to the overlay:", `${program} list devices [filter]`],
        ["Add one (it asks for the missing required properties):", `${program} add <compatible>`],
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
        `  Run ${cyan(`${program} config --reload`)} after the bindings of the Linux tree change.`,
    ];
}

export const init = command<Record<never, never>, InitResponse>({
    docs: {
        brief: "Create the overlay workfile, or keep the configured one",
        full: `init needs linux, devicetree and workfile configured, with the binding caches
built (a bare 'analog-attach' on a terminal sets them up, or 'analog-attach
config linux <path>', 'config devicetree <path>' and 'config workfile <name>').
It never asks.

When the configured workfile exists, init keeps it; otherwise it creates
it, empty. It never picks another name.

--json gives { path, created, linux, devicetree, overlay }.`,
        examples: ["init", "--json init"],
    },
    run(_arguments, _flags, session) {
        const loaded = load_workspace(session, ["bindings", "base", "overlay_path"]);
        if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
        const { workspace } = loaded;
        const response = init_workfile(
            { ...workspace.settings, linux: workspace.bindings.linux, devicetree: workspace.base.source, workfile: workspace.overlay_path },
            session.cwd,
            session.program,
        );
        if (!response.ok) { return Promise.resolve(refuse(response.message)); }
        return Promise.resolve(answer(response, style => `${format_summary({ ...response, state: response.created ? "created" : "kept" }, style, session.program).join("\n")}\n`));
    },
});

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");
    const { create_style } = await import("../../../../front/session");

    const SETTINGS_BASE = { overlay_syntax: "fragment", preprocess_command: "", linux: "/l", devicetree: "/d.dts" } as const;
    const summary_text = (summary: Summary): string => format_summary(summary, create_style(false), "aa").join("\n");

    test("init_workfile — creates the configured workfile, then keeps it on a re-run", () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "attach-init-"));
        try {
            const overlay = path.join(work, "overlay.dtso");
            const first = init_workfile({ ...SETTINGS_BASE, workfile: overlay }, work);
            expect(first).toMatchObject({ ok: true, linux: "/l", devicetree: "/d.dts", path: overlay, overlay, created: true });
            expect(first.message).toBe(`Workspace ready: linux /l, devicetree /d.dts, overlay ${overlay} (created)`);
            expect(fs.readFileSync(overlay, "utf8")).toContain("/plugin/;");
            expect(fs.readdirSync(work)).toEqual(["overlay.dtso"]);

            fs.appendFileSync(overlay, "// mine\n");
            const second = init_workfile({ ...SETTINGS_BASE, workfile: overlay }, work);
            expect(second).toMatchObject({ path: overlay, created: false });
            expect(fs.readFileSync(overlay, "utf8")).toContain("// mine");
        } finally {
            fs.rmSync(work, { recursive: true });
        }
    });

    test("init_workfile — refuses a path whose directory is missing, or that isn't a file", () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), "attach-init-"));
        try {
            expect(init_workfile({ ...SETTINGS_BASE, workfile: work }, work).message).toContain(`${work} is not a file`);
            const nowhere = path.join(work, "gone", "x.dtso");
            const refused = init_workfile({ ...SETTINGS_BASE, workfile: nowhere }, work, "aa");
            expect(refused).toMatchObject({ ok: false, severity: "error" });
            expect(refused.message).toContain(`${path.join(work, "gone")} is not a directory`);
            expect(refused.message).toContain("'aa config workfile <name>'");
            expect(fs.readdirSync(work)).toEqual([]);
        } finally {
            fs.rmSync(work, { recursive: true });
        }
    });

    test("format_summary — names the three paths and what became of the overlay; the caches only for the setup run", () => {
        const summary: Summary = { linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", state: "created" };
        expect(summary_text(summary)).toContain("Linux:       /l");
        expect(summary_text(summary)).toContain("Overlay:     /w/overlay.dtso (created)");
        expect(summary_text(summary)).not.toContain("Caches:");
        expect(summary_text(summary)).not.toContain("aa init");
        expect(summary_text(summary)).toContain("Run aa config --reload after");
        expect(summary_text({ ...summary, indexed: false })).toContain("Caches:      current");
    });

    test("format_summary — a workfile not created yet makes init the first step", () => {
        const text = summary_text({ linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", state: "not created yet", indexed: true });
        expect(text).toContain("Workspace configured");
        expect(text).toContain("Overlay:     /w/overlay.dtso (not created yet)");
        expect(text).toContain("1. Create the workfile:\n     aa init");
        expect(text).toContain("3. Add one");
    });
}
