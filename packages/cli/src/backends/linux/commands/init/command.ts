import * as fs from "node:fs";
import path from "node:path";

import { answer, command, refuse, type Outcome, type Session, type Style } from "../../../../interface/backend-interface";
import { project_root } from "../../../shell";
import { DEFAULT_PROGRAM, type Settings } from "../../config/settings";
import { load_workspace, SCRIPTS, type ScriptCommand } from "../../config/workspace";
import type { CommonResponse, InitResponse, InitScript, RestoreResponse } from "../../protocol/types";
import { create_workfile, creation_problem, existing_overlay } from "../../workfile";
import { set_starter_variables, variable_text, write_starter } from "./starters";

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
				error_type: "write-failed",
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
	/** `init`: the scripts at the project root, written now or kept. */
	scripts?: readonly InitScript[];
}

/** The lines printed once the workspace is set up; a workfile not created yet makes `init` the first step. */
export function format_summary(summary: Summary, { bold, cyan, dim }: Pick<Style, "bold" | "cyan" | "dim">, program: string): string[] {
	// The variables init set with the starters it wrote (INIT-110).
	const variables = (summary.scripts ?? []).flatMap(script => script.variables);
	const steps = [
		...(summary.state === "not created yet" ? [["Create the workfile:", `${program} init`]] : []),
		["Search for devices to add to the overlay:", `${program} list devices [filter]`],
		["Add one (it asks for the missing required properties):", `${program} add <compatible>`],
	];
	return [
		bold(summary.state === "not created yet" ? "Workspace configured" : "Workspace ready"),
		"",
		`  Linux:         ${summary.linux}`,
		`  Devicetree:    ${summary.devicetree}`,
		`  Overlay:       ${summary.overlay} ${dim(`(${summary.state})`)}`,
		...(summary.scripts ?? []).map(script => `  ${`${path.basename(script.path)}:`.padEnd(15)}${script.path} ${dim(`(${script.created ? "created" : "kept"})`)}`),
		...(variables.length === 0 ? [] : [`  Variables:     ${variables.map(variable => variable_text(variable)).join(", ")} ${dim("(set now)")}`]),
		...(summary.indexed === undefined ? [] : [`  Caches:        ${summary.indexed ? "built now" : "current"}`]),
		"",
		bold("Next steps:"),
		"",
		...steps.flatMap(([text, command], index) => [`  ${cyan(`${index + 1}.`)} ${text}`, `     ${dim(command ?? "")}`, ""]),
		`  Run ${cyan(`${program} config --reload`)} after the bindings of the Linux tree change.`,
		...(variables.length === 0 ? [] : [`  Change a variable with ${cyan(`${program} config var <NAME> <value>`)}.`]),
	];
}

/** The scripts `init` writes, in order. */
const SCRIPT_COMMANDS = Object.keys(SCRIPTS) as ScriptCommand[];

/** Set the variables of the starter just written (INIT-107 to INIT-109): those set; each that couldn't be is a warning. */
function set_variables(script: ScriptCommand, session: Session): InitScript["variables"] {
	const { set, problems } = set_starter_variables(script, session.settings);
	for (const problem of problems) { session.warn(problem); }
	return set;
}

/**
 * Each script's starter at the project root, unless the file is there (INIT-100, INIT-101), with
 * its variables (INIT-107); one that can't be written is a warning (INIT-102).
 */
function write_starters(session: Session): InitScript[] {
	const written: InitScript[] = [];
	for (const script of SCRIPT_COMMANDS) {
		const result = write_starter(script, project_root(session), false);
		if (result.ok) {
			// A script kept is the user's, and so are the variables it uses: none is set.
			written.push({ path: result.path, created: result.created, variables: result.created ? set_variables(script, session) : [] });
		} else {
			session.warn(`warning: the starter ${SCRIPTS[script]} was not written: ${result.problem}`);
		}
	}
	return written;
}

/** `init --restore <build|deploy>`: that script's starter over the file (INIT-104 to INIT-106), with its variables (INIT-107). */
function restore(which: string, session: Session): Outcome<RestoreResponse> {
	if (!SCRIPT_COMMANDS.includes(which as ScriptCommand)) {
		return refuse(`Unknown script '${which}'. Restore one of: ${SCRIPT_COMMANDS.join(", ")}`, { type: "unknown-choice" });
	}
	const script = which as ScriptCommand;
	const result = write_starter(script, project_root(session), true);
	if (!result.ok) { return refuse(`Cannot write the starter ${SCRIPTS[script]}: ${result.problem}`, { type: "write-failed" }); }
	const message = `Wrote the starter ${SCRIPTS[script]}: ${result.path}`;
	const variables = set_variables(script, session);
	// Then the line `config var` answers with, for each variable set (INIT-110).
	const text = [message, ...variables.map(variable => `Set variable ${variable_text(variable)}`)].join("\n");
	return answer<RestoreResponse>({ ok: true, message, severity: "info", path: result.path, created: result.created, variables }, text);
}

const INIT_FLAGS = {
	restore: { kind: "value", brief: "Write that script's starter again, over the file: build or deploy", placeholder: "build|deploy" },
} as const;

export const init = command<Record<never, never>, InitResponse | RestoreResponse, typeof INIT_FLAGS>({
	flags: INIT_FLAGS,
	docs: {
		brief: "Create the overlay workfile and the starter scripts, or keep them",
		full: `init needs linux, devicetree and workfile configured, with the binding caches
built (a bare 'analog-attach' on a terminal sets them up, or 'analog-attach
config linux <path>', 'config devicetree <path>' and 'config workfile <name>').
It never asks.

When the configured workfile exists, init keeps it; otherwise it creates
it, empty. It never picks another name.

It also writes the scripts build and deploy run, at the base of the project:
aa_build.sh (compile with dtc) and aa_deploy.sh (copy to a Raspberry Pi running
Kuiper and reboot it). One that is there is kept, as you edited it.
--restore build (or deploy) writes that starter again over it, and needs
nothing else configured.

With a starter it writes, it sets the project variables that starter uses
and the project doesn't have yet: for aa_deploy.sh, BOARD_IP analog.local and
BOARD_USER analog (Kuiper's defaults), and BOARD_PASSWORD as a secret, its
name only. Change one with 'analog-attach config var <NAME> <value>'.

--json gives { path, created, linux, devicetree, overlay, scripts }, each
script with the variables set now.`,
		examples: ["init", "--json init", "init --restore deploy"],
	},
	run(_arguments, flags, session) {
		if (flags.restore !== undefined) { return Promise.resolve(restore(flags.restore, session)); }
		const loaded = load_workspace(session, ["bindings", "base", "overlay_path"]);
		if (!loaded.ok) { return Promise.resolve(loaded.outcome); }
		const { workspace } = loaded;
		const workfile = init_workfile(
			{ ...workspace.settings, linux: workspace.bindings.linux, devicetree: workspace.base.source, workfile: workspace.overlay_path },
			session.cwd,
			session.program,
		);
		if (!workfile.ok) { return Promise.resolve(refuse(workfile.message, { type: "write-failed" })); }
		const response: InitResponse = { ...workfile, scripts: write_starters(session) };
		return Promise.resolve(answer<InitResponse | RestoreResponse>(response, style => `${format_summary({ ...response, state: response.created ? "created" : "kept" }, style, session.program).join("\n")}\n`));
	},
});

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;
	const os = await import("node:os");
	const { create_style } = await import("../../../../front/session");

	const SETTINGS_BASE = { overlay_syntax: "fragment", preprocess_command: "", interview: true, output: "overlay", build_dir: "/build", linux: "/l", devicetree: "/d.dts" } as const;
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
		expect(summary_text(summary)).toContain("Linux:         /l");
		expect(summary_text(summary)).toContain("Overlay:       /w/overlay.dtso (created)");
		expect(summary_text(summary)).not.toContain("Caches:");
		expect(summary_text(summary)).not.toContain("aa init");
		expect(summary_text(summary)).toContain("Run aa config --reload after");
		expect(summary_text({ ...summary, indexed: false })).toContain("Caches:        current");
		const kept = summary_text({ ...summary, scripts: [{ path: "/w/aa_build.sh", created: true, variables: [] }, { path: "/w/aa_deploy.sh", created: false, variables: [] }] });
		expect(kept).toContain("  aa_build.sh:   /w/aa_build.sh (created)\n  aa_deploy.sh:  /w/aa_deploy.sh (kept)\n\n");
		expect(kept).not.toContain("Variables:");
		expect(kept).not.toContain("config var");
	});

	test("format_summary — the variables set with the starters, a secret by name, and how to change them", () => {
		const text = summary_text({
			linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", state: "created",
			scripts: [
				{ path: "/w/aa_build.sh", created: true, variables: [] },
				{ path: "/w/aa_deploy.sh", created: true, variables: [{ name: "BOARD_USER", secret: false, value: "analog" }, { name: "BOARD_PASSWORD", secret: true }] },
			],
		});
		expect(text).toContain("  aa_deploy.sh:  /w/aa_deploy.sh (created)\n  Variables:     BOARD_USER = analog, BOARD_PASSWORD as a secret (set now)\n");
		expect(text).toMatch(/after the bindings of the Linux tree change\.\n {2}Change a variable with aa config var <NAME> <value>\.$/);
	});

	test("format_summary — a workfile not created yet makes init the first step", () => {
		const text = summary_text({ linux: "/l", devicetree: "/d.dts", overlay: "/w/overlay.dtso", state: "not created yet", indexed: true });
		expect(text).toContain("Workspace configured");
		expect(text).toContain("Overlay:       /w/overlay.dtso (not created yet)");
		expect(text).toContain("1. Create the workfile:\n     aa init");
		expect(text).toContain("3. Add one");
	});
}
