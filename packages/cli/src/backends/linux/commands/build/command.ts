import fs from "node:fs";
import path from "node:path";

import { answer, command, refuse, warned, type Outcome, type Session } from "../../../../interface/backend-interface";
import { EXECUTABLE_NAMES } from "../../config/settings";
import { derive_build_files, derive_dtbo_path, load_workspace } from "../../config/workspace";
import { write_full_devicetree } from "../../full-devicetree";
import { PREPROCESSED, run_script, script_environment, script_failure, session_sources, system_variables } from "../../scripts";
import type { BuildResponse } from "../../protocol/types";

/**
 * `build`: run `AA_BUILD` in the project root, `./aa_build.sh` unless the project changed it
 * (BUILD-030). With output `devicetree`, the full devicetree is written and preprocessed first
 * (BUILD-010 to BUILD-017), and the command compiles that (`$AA_DTS`).
 */
async function run_build(session: Session): Promise<Outcome<BuildResponse>> {
	// The full devicetree is written from the base and the overlay; an overlay is the command's to
	// read, so only its file is checked.
	const full = session.settings.get("output") === "devicetree";
	type Needed = "overlay_path" | "workfile_file" | "build_script" | "base" | "overlay";
	const needs: Needed[] = full ? ["overlay_path", "build_script", "base", "overlay"] : ["overlay_path", "workfile_file", "build_script"];
	const loaded = load_workspace(session, needs);
	if (!loaded.ok) { return loaded.outcome; }
	const { workspace } = loaded;
	const { overlay_path: workfile, build_script: script, settings } = workspace;
	const files = derive_build_files(workfile, settings.output, settings.build_dir);

	if (files.source !== undefined) {
		const problem = write_full_devicetree(workspace, files.source, path.join(session.state_dir, PREPROCESSED));
		if (problem !== undefined) { return refuse(`Build failed: ${problem.message}`, { type: problem.type }); }
	}

	const sources = session_sources(session);
	const environment = script_environment("build", session.environment, system_variables(sources), session.settings.variables());
	const result = await run_script(session, script, `Building ${workfile} with ${EXECUTABLE_NAMES.build}`, environment);
	if (result.exit_code !== 0 || result.error !== undefined) {
		const message = script_failure("build", result);
		// Its standard error is already on the terminal, line by line; the response has it too.
		return refuse(result.stderr === "" ? message : `${message}\n${result.stderr}`, { type: "tool-failed", text: message });
	}

	const built = fs.existsSync(files.binary);
	const listed = [...files.source === undefined ? [] : [files.source], ...built ? [files.binary] : []];
	if (!built) {
		const message = `${EXECUTABLE_NAMES.build} succeeded, but ${files.binary} is not there`;
		session.warn(`warning: ${message}`);
		return answer<BuildResponse>(
			{ ok: true, message, ...warned("output-missing"), ...files.source === undefined ? {} : { source: files.source } },
			["Build completed successfully", ...listed.length === 0 ? [] : ["", ...listed.map(file => `  ${file}`)]].join("\n"),
		);
	}
	return answer<BuildResponse>(
		{ ok: true, message: `Built ${workfile} with ${EXECUTABLE_NAMES.build}`, severity: "info", path: files.binary, ...files.source === undefined ? {} : { source: files.source } },
		["Build completed successfully", "", ...listed.map(file => `  ${file}`)].join("\n"),
	);
}

export const build = command<Record<never, never>, BuildResponse>({
	docs: {
		brief: "Run AA_BUILD (aa_build.sh): compile the overlay into a .dtbo, or a full .dtb",
		full: `Runs the AA_BUILD variable's command with sh at the base of the project (the
folder that holds .analog-attach/), its output shown as it comes. It is ./aa_build.sh
unless the project changes it ('analog-attach config var AA_BUILD <command>';
--reset goes back). 'analog-attach init' writes a starter aa_build.sh that compiles the
overlay file with dtc into a .dtbo in the build-dir folder ('build' unless set),
named after the overlay (overlay.dtso -> overlay.dtbo). Edit it as you need;
'analog-attach init --restore build' writes the starter again.

The command gets the AA_ variables (AA_DTSO the overlay, AA_DTBO the .dtbo, AA_DTC
the dtc on PATH, ...) and the project's variables in its environment:
'analog-attach config' lists them, 'analog-attach config var <NAME> <value>' sets one.

With 'config output devicetree', for boards that boot a full devicetree, build first
writes the base devicetree with the overlay applied (build/overlay.dts: an #include
of the base, then the overlay's nodes) and preprocesses it with AA_PREPROCESS_COMMAND;
AA_BUILD then compiles that (AA_DTS) into build/overlay.dtb (AA_DTB).`,
		examples: ["build", "--json build", "init --restore build", "config var AA_BUILD \"make overlay\""],
	},
	run: (_arguments, _flags, session) => run_build(session),
});

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	test("derive_dtbo_path - in the build folder, .dtso swapped for .dtbo", () => {
		expect(derive_dtbo_path("/x/overlay.dtso", "/p/build")).toBe("/p/build/overlay.dtbo");
	});

	test("derive_dtbo_path - .dtbo appended when the overlay is not a .dtso", () => {
		expect(derive_dtbo_path("/x/overlay", "/p/build")).toBe("/p/build/overlay.dtbo");
	});

	test("derive_build_files - the .dtbo, or with output devicetree the .dts and .dtb, in the build folder", () => {
		expect(derive_build_files("/x/overlay.dtso", "overlay", "/p/build")).toEqual({ binary: "/p/build/overlay.dtbo" });
		expect(derive_build_files("/x/overlay.dtso", "devicetree", "/p/build")).toEqual({ source: "/p/build/overlay.dts", binary: "/p/build/overlay.dtb" });
		// A .dts workfile in the build folder itself is never written over.
		expect(derive_build_files("/p/my.dts", "devicetree", "/p")).toEqual({ source: "/p/my.dts.dts", binary: "/p/my.dts.dtb" });
	});
}
