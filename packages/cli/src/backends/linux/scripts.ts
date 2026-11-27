// The project's scripts: the executable variables (`EXECUTABLES`, spec 02-common.md §8.6).
// `build` runs `AA_BUILD` (`./aa_build.sh` by default), `deploy` `AA_DEPLOY` (`./aa_deploy.sh`), both
// with `sh -c` in the project root, and every devicetree read goes through
// `AA_PREPROCESS_COMMAND`. What they get is their environment: the CLI's own, the system
// variables the backend computes (`AA_…`, `system_variables`), the project's variables
// (`config var`), and for `deploy` its secrets, whose values never touch a file (from the
// environment the CLI runs in, or typed on a terminal).

import path from "node:path";

import type { Environment, ProjectVariable, ScriptVariables, Session, SystemVariable } from "../../interface/backend-interface";
import { project_root, run_shell, type CommandResult } from "../shell";
import { build_folder, derive_build_files, type ScriptCommand } from "./config/build-files";
import { EXECUTABLE_NAMES, EXECUTABLES, read_settings, type ConfigError, type ExecutableStep, type Output, type Settings } from "./config/settings";
import { find_dtc } from "./config/tools";

/** The prefix of the system variables, which a project variable's name can't have. */
export const RESERVED_PREFIX = "AA_";

/** The scripts a secret goes to. */
export const SECRET_SCRIPTS: readonly ExecutableStep[] = ["deploy"];

/** The scratch file of the state directory the full devicetree is preprocessed into: `$AA_DTS`, what aa_build.sh compiles. */
export const PREPROCESSED = "build.preprocessed.dts";

/** What the system variables are computed from. */
export interface ScriptSources {
	/** The project root. */
	root: string;
	/** `.analog-attach/linux/`. */
	state_dir: string;
	/** `build_dir` absolute. */
	settings: Settings;
	/** The dtc on PATH (`find_dtc`), when there is one. */
	dtc?: string;
}

const EVERY: readonly ExecutableStep[] = ["build", "deploy", "preprocess"];
const BOTH: readonly ExecutableStep[] = ["build", "deploy"];
const BUILD: readonly ExecutableStep[] = ["build"];
const PREPROCESS: readonly ExecutableStep[] = ["preprocess"];

/** The variables of the preprocessor's input and output, set for each file it preprocesses. */
export const PREPROCESS_INPUT = "AA_PREPROCESS_INPUT";
export const PREPROCESS_OUTPUT = "AA_PREPROCESS_OUTPUT";

/**
 * The system variables (COM-153): each with the scripts that get it, and its value as the
 * settings stand, undefined when it has none (a setting it follows is unset, or it is for the
 * other `output`). A script gets only those that have a value.
 */
export function system_variables(sources: ScriptSources): SystemVariable[] {
	const { settings, root, state_dir } = sources;
	const { output, workfile, build_dir } = settings;
	const files = workfile === undefined ? undefined : derive_build_files(workfile, output, build_dir);
	const only = (wanted: Output, value: string | undefined): string | undefined => (output === wanted ? value : undefined);
	const variable = (name: string, description: string, scripts: readonly ExecutableStep[], value: string | undefined): SystemVariable => ({
		name: `${RESERVED_PREFIX}${name}`, description, scripts, ...(value === undefined ? {} : { value }),
	});
	return [
		variable("PROJECT", "The project root, the folder that holds .analog-attach/, where build and deploy run", EVERY, root),
		variable("OUTPUT", "The output setting: overlay or devicetree", BOTH, output),
		variable("BUILD_DIR", "The build-dir setting, absolute: where build writes and deploy takes from", BOTH, build_dir),
		variable("DTSO", "The workfile, absolute: the overlay as it is on disk", BOTH, workfile),
		variable("DTBO", "Output overlay: the compiled overlay, the workfile's name with .dtbo in the build folder", BOTH, only("overlay", files?.binary)),
		variable("DTS", "Output devicetree: the full devicetree, preprocessed, that AA_BUILD compiles (build writes it first)", BUILD, only("devicetree", path.join(state_dir, PREPROCESSED))),
		variable("DTB", "Output devicetree: the compiled devicetree, the workfile's name with .dtb in the build folder", BOTH, only("devicetree", files?.binary)),
		variable("DTC", "The dtc on PATH (1.6.0 or later), absolute; unset when there is none", BUILD, sources.dtc),
		variable("LINUX", "The linux setting: the Linux tree, absolute", EVERY, settings.linux),
		variable("PREPROCESS_INPUT", "The file AA_PREPROCESS_COMMAND preprocesses: the base devicetree, or another source read; set for each", PREPROCESS, undefined),
		variable("PREPROCESS_OUTPUT", "The file AA_PREPROCESS_COMMAND writes, in .analog-attach/linux/; set for each", PREPROCESS, undefined),
	];
}

/** The sources of a session: its settings, `build-dir` resolved, and the dtc on PATH. */
export function session_sources(session: Session): ScriptSources {
	const root = project_root(session);
	const settings = read_settings(session.settings);
	const dtc = find_dtc(session.program);
	return {
		root,
		state_dir: session.state_dir,
		settings: { ...settings, build_dir: build_folder(settings.build_dir, root) },
		...(dtc.ok ? { dtc: dtc.value.path } : {}),
	};
}

/** The backend's `variables`: what `config` lists and `config var` checks names against. */
export const linux_variables: ScriptVariables = {
	scripts: EVERY,
	executables: EXECUTABLES,
	secret_scripts: SECRET_SCRIPTS,
	reserved_prefix: RESERVED_PREFIX,
	system: session => system_variables(session_sources(session)),
};

/** The secrets of the project. */
export function secrets_of(variables: readonly ProjectVariable[]): string[] {
	return variables.filter(variable => variable.secret).map(variable => variable.name);
}

/** A secret's value from the environment the CLI runs in; an empty one is none. */
export function secret_from(environment: Environment, name: string): string | undefined {
	const value = environment[name];
	return value === undefined || value === "" ? undefined : value;
}

/** The problem of a secret `deploy` can't get: off a terminal, with no value in the environment (DEPLOY-042). */
export function missing_secret(name: string, program: string): ConfigError {
	return {
		field: name,
		kind: "missing",
		error_type: "missing-setting",
		message: `Secret variable ${name} is not in the environment`,
		hint: `Set it in the environment deploy runs in (${name}=… ${program} deploy), or run deploy on a terminal, which asks for it.`,
	};
}

/**
 * A script's environment (COM-152): the CLI's, without what it inherited of the reserved
 * prefix (and for a script that gets no secrets, without the secrets' names), then the system
 * variables that have a value, then the project's, then the secrets (`secrets`, `deploy` only).
 * The preprocessor's input and output are `run_preprocess`'s to add, for each file.
 */
export function script_environment(
	command: ExecutableStep,
	inherited: Environment,
	system: readonly SystemVariable[],
	variables: readonly ProjectVariable[],
	secrets: Readonly<Record<string, string>> = {},
): Record<string, string> {
	const secret_names = new Set(secrets_of(variables));
	const environment: Record<string, string> = {};
	for (const [name, value] of Object.entries(inherited)) {
		if (value === undefined || name.startsWith(RESERVED_PREFIX)) { continue; }
		if (!SECRET_SCRIPTS.includes(command) && secret_names.has(name)) { continue; }
		environment[name] = value;
	}
	for (const variable of system) {
		if (variable.value !== undefined && variable.scripts.includes(command)) { environment[variable.name] = variable.value; }
	}
	for (const variable of variables) {
		if (!variable.secret) { environment[variable.name] = variable.value; }
	}
	if (SECRET_SCRIPTS.includes(command)) {
		for (const [name, value] of Object.entries(secrets)) { environment[name] = value; }
	}
	return environment;
}

/** What a script run gave: its exit status, why it didn't start, and its standard error (for the refusal). */
export interface ScriptRun extends CommandResult {
	stderr: string;
}

/** The environment `AA_PREPROCESS_COMMAND` runs in, the files aside (`Settings.preprocess_environment`). */
export function preprocess_environment(session: Session): Record<string, string> {
	return script_environment("preprocess", session.environment, system_variables(session_sources(session)), session.settings.variables());
}

/**
 * Run `command` (an executable variable's) with `sh -c` in the project root with
 * `environment`, its lines (both streams) through `session.progress` under `label`. Its
 * standard error is kept too, for a refusal's message.
 */
export async function run_script(session: Session, command: string, label: string, environment: Record<string, string>): Promise<ScriptRun> {
	const progress = session.progress(label);
	const stderr: string[] = [];
	const result = await run_shell(command, project_root(session), {
		line: (text, stream) => {
			if (stream === "stderr") { stderr.push(text); }
			progress.line(text);
		},
		signal: session.signal,
	}, environment);
	progress.done();
	return { ...result, stderr: stderr.join("\n") };
}

/** The refusal's message of a script that failed: `Build failed: AA_BUILD exited with status 2`. */
export function script_failure(command: ScriptCommand, result: ScriptRun): string {
	const what = command === "build" ? "Build" : "Deploy";
	const name = EXECUTABLE_NAMES[command];
	return result.error === undefined
		? `${what} failed: ${name} exited with status ${String(result.exit_code)}`
		: `${what} failed: ${name} did not run: ${result.error}`;
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	const settings: Settings = { overlay_syntax: "fragment", preprocess_command: "cpp", interview: true, output: "overlay", build_dir: "/p/build", workfile: "/p/ad.dtso" };
	const { run_shell: shell } = await import("../shell");

	test("system_variables - every name, the values of the output, the scripts of each", () => {
		const overlay = system_variables({ root: "/p", state_dir: "/p/.analog-attach/linux", settings, dtc: "/usr/bin/dtc" });
		expect(overlay.map(variable => [variable.name, variable.value, variable.scripts.join(",")])).toEqual([
			["AA_PROJECT", "/p", "build,deploy,preprocess"],
			["AA_OUTPUT", "overlay", "build,deploy"],
			["AA_BUILD_DIR", "/p/build", "build,deploy"],
			["AA_DTSO", "/p/ad.dtso", "build,deploy"],
			["AA_DTBO", "/p/build/ad.dtbo", "build,deploy"],
			["AA_DTS", undefined, "build"],
			["AA_DTB", undefined, "build,deploy"],
			["AA_DTC", "/usr/bin/dtc", "build"],
			["AA_LINUX", undefined, "build,deploy,preprocess"],
			["AA_PREPROCESS_INPUT", undefined, "preprocess"],
			["AA_PREPROCESS_OUTPUT", undefined, "preprocess"],
		]);
		const full = system_variables({ root: "/p", state_dir: "/p/.analog-attach/linux", settings: { ...settings, output: "devicetree", linux: "/l" } });
		const values = Object.fromEntries(full.map(variable => [variable.name, variable.value]));
		expect(values).toMatchObject({ AA_DTBO: undefined, AA_DTS: "/p/.analog-attach/linux/build.preprocessed.dts", AA_DTB: "/p/build/ad.dtb", AA_DTC: undefined, AA_LINUX: "/l" });
	});

	test("script_environment - inherited AA_ dropped, system then project variables, secrets for deploy only", () => {
		const system = system_variables({ root: "/p", state_dir: "/s", settings, dtc: "/d" });
		const variables: ProjectVariable[] = [{ name: "BOARD_IP", secret: false, value: "10.0.0.5" }, { name: "PASS", secret: true }];
		const inherited = { PATH: "/bin", AA_DTBO: "/elsewhere", PASS: "from-env", BOARD_IP: "old", UNSET: undefined };
		const build = script_environment("build", inherited, system, variables, { PASS: "typed" });
		expect(build).toMatchObject({ PATH: "/bin", AA_DTBO: "/p/build/ad.dtbo", AA_DTC: "/d", BOARD_IP: "10.0.0.5" });
		expect(build).not.toHaveProperty("PASS");
		expect(build).not.toHaveProperty("UNSET");
		const deploy = script_environment("deploy", inherited, system, variables, { PASS: "typed" });
		expect(deploy).toMatchObject({ PASS: "typed", AA_DTBO: "/p/build/ad.dtbo" });
		expect(deploy).not.toHaveProperty("AA_DTC");
		expect(deploy).not.toHaveProperty("AA_DTS");
		const preprocess = script_environment("preprocess", inherited, system, variables, { PASS: "typed" });
		expect(preprocess).toMatchObject({ PATH: "/bin", AA_PROJECT: "/p", BOARD_IP: "10.0.0.5" });
		expect(preprocess).not.toHaveProperty("PASS");
		expect(preprocess).not.toHaveProperty("AA_DTBO");
	});

	test("an executable variable runs as a shell command: several lines, the environment's variables", async () => {
		const lines: string[] = [];
		const result = await shell("set -e\necho \"$BOARD\"\nfalse\necho never", ".", { line: text => { lines.push(text); } }, { PATH: process.env["PATH"] ?? "", BOARD: "pi" });
		expect(result.exit_code).toBe(1);
		expect(lines).toEqual(["pi"]);
		expect(script_failure("build", { ...result, stderr: "" })).toBe("Build failed: AA_BUILD exited with status 1");
	});

	test("secret_from - an empty value is none", () => {
		expect(secret_from({ A: "x", B: "" }, "A")).toBe("x");
		expect(secret_from({ A: "x", B: "" }, "B")).toBeUndefined();
		expect(secret_from({}, "C")).toBeUndefined();
	});
}
