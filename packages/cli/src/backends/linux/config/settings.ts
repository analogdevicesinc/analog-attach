import os from "node:os";
import path from "node:path";

import type { ExecutableVariable, SettingSpec, SettingsView } from "../../../interface/backend-interface";
import type { ErrorType } from "../../../interface/error-types";
import { SCRIPTS } from "./build-files";

// The Linux backend's settings. The front end stores them (JSON, local over global) and
// checks them against these specs; the backend reads them through `session.settings`
// (`read_settings`) and never touches a settings file.

// Mirrors kbuild's dtc_cpp_flags. It runs with the file to preprocess in $AA_PREPROCESS_INPUT,
// the file to write in $AA_PREPROCESS_OUTPUT and the Linux tree in $AA_LINUX (COM-090).
export const DEFAULT_PREPROCESS_COMMAND = `cpp -nostdinc -undef -x assembler-with-cpp -P -I "$AA_LINUX/include" -o "$AA_PREPROCESS_OUTPUT" "$AA_PREPROCESS_INPUT"`;

/** The executable variables (COM-158), by what runs each: a command the CLI runs with `sh -c`. */
export const EXECUTABLE_NAMES = { build: "AA_BUILD", deploy: "AA_DEPLOY", preprocess: "AA_PREPROCESS_COMMAND" } as const;
export type ExecutableStep = keyof typeof EXECUTABLE_NAMES;

/**
 * The executable variables: project variables with a default, stored only when changed
 * (`config var AA_BUILD <command>`, `--reset` to go back). `build` and `deploy` run the
 * project's scripts unless told otherwise; the preprocessor runs on every devicetree read.
 */
export const EXECUTABLES: readonly ExecutableVariable[] = [
	{ name: EXECUTABLE_NAMES.build, runs: "build", default: `./${SCRIPTS.build}`, description: "The command build runs, in the project root: by default the project's aa_build.sh" },
	{ name: EXECUTABLE_NAMES.deploy, runs: "deploy", default: `./${SCRIPTS.deploy}`, description: "The command deploy runs, in the project root: by default the project's aa_deploy.sh" },
	{
		name: EXECUTABLE_NAMES.preprocess, runs: "preprocess", default: DEFAULT_PREPROCESS_COMMAND,
		description: "The C preprocessor command run on each devicetree read: it preprocesses $AA_PREPROCESS_INPUT into $AA_PREPROCESS_OUTPUT",
	},
];

/** An executable variable's default. */
export function executable_default(step: ExecutableStep): string {
	return EXECUTABLES.find(variable => variable.runs === step)?.default ?? "";
}

export const OVERLAY_SYNTAXES = ["fragment", "reference"] as const;
export type OverlaySyntax = typeof OVERLAY_SYNTAXES[number];

/** What `build` makes of the workfile: a `.dtbo`, or the base with the overlay applied (a `.dts` and its `.dtb`). */
export const OUTPUTS = ["overlay", "devicetree"] as const;
export type Output = typeof OUTPUTS[number];

/** The name hints use when no session is at hand (the specs' static hints): the front end's binary. */
export const DEFAULT_PROGRAM = "analog-attach";

/** The settings, as `session.settings` has them, defaults applied. Paths are absolute. */
export interface Settings {
	linux?: string;
	devicetree?: string;
	workfile?: string;
	overlay_syntax: OverlaySyntax;
	/** `AA_PREPROCESS_COMMAND`, its default when the project hasn't changed it. */
	preprocess_command: string;
	/**
	 * The environment `preprocess_command` runs in, without the files it gets (COM-152):
	 * `load_workspace` sets it from the session. Unset: the process's.
	 */
	preprocess_environment?: Readonly<Record<string, string>>;
	/** `AA_BUILD` and `AA_DEPLOY`, as the project has them; unset: their defaults. */
	build_command?: string;
	deploy_command?: string;
	/** Whether `add` and a child's create ask on a terminal (`interview`). */
	interview: boolean;
	/** What `build` makes and `deploy` copies (`output`, `$AA_OUTPUT`). */
	output: Output;
	/** The folder `build` writes its output to and `deploy` takes it from (`$AA_BUILD_DIR`), relative to the project unless absolute. */
	build_dir: string;
}

export type SettingKey =
	| "linux" | "devicetree" | "workfile" | "overlay-syntax" | "interview"
	| "output" | "build-dir";

/** The `Settings` field of each key. */
export const SETTING_FIELDS: Readonly<Record<SettingKey, keyof Settings>> = {
	linux: "linux",
	devicetree: "devicetree",
	workfile: "workfile",
	"overlay-syntax": "overlay_syntax",
	interview: "interview",
	output: "output",
	"build-dir": "build_dir",
};

/** The fields the setup run sets, with the `config` command that sets each. */
const SETUP_COMMANDS: readonly (readonly [SettingKey, string])[] = [
	["linux", "config linux <path>"],
	["devicetree", "config devicetree <path>"],
	["workfile", "config workfile <name>"],
];

/**
 * How to set the `fields` (some of linux, devicetree and workfile): the setup
 * run, or their `config` commands, then `init` when the workfile is among them.
 * `format_config_errors` merges the hints of several fields into one.
 */
export function setup_hint(fields: readonly string[], program: string = DEFAULT_PROGRAM): string {
	const commands = SETUP_COMMANDS.filter(([key]) => fields.includes(key)).map(([, command], index) => `'${index === 0 ? `${program} ` : ""}${command}'`);
	const listed = commands.length > 1 ? `${commands.slice(0, -1).join(", ")} and ${commands.at(-1) ?? ""}` : commands[0] ?? "";
	const init = fields.includes("workfile") ? `, then '${program} init'` : "";
	return `Run '${program}' on a terminal, or ${listed}${init}, to set up a workspace.`;
}

/** The hint of a setting that is set but unusable. */
export function setting_hint(key: SettingKey, program: string = DEFAULT_PROGRAM): string | undefined {
	switch (key) {
		case "linux":
		case "devicetree": { return setup_hint([key], program); }
		case "workfile": { return `Run '${program} init' to create it, or '${program} config workfile <name>' to use another.`; }
		default: { return undefined; }
	}
}

/** The hint of a setting that is missing: the setup hint for the workfile, otherwise `setting_hint`. */
export function missing_hint(key: SettingKey, program: string = DEFAULT_PROGRAM): string | undefined {
	return key === "workfile" ? setup_hint(["workfile"], program) : setting_hint(key, program);
}

const WORKSPACE = "Workspace";
const BUILD = "Build";

/** Where `build` writes its output when `build-dir` is unset, relative to the project root (as the noos backend builds). */
export const DEFAULT_BUILD_DIR = "build";

/** The specs the front end stores, lists and checks. Their hints name `program`. */
export function linux_settings(program: string = DEFAULT_PROGRAM): SettingSpec[] {
	const hint = (key: SettingKey): { hint?: string } => {
		const text = setting_hint(key, program);
		return text === undefined ? {} : { hint: text };
	};
	return [
		{
			key: "linux",
			category: WORKSPACE,
			type: "path",
			required: true,
			must_exist: true,
			description: "Path to Linux kernel source tree (setting it builds the binding caches)",
			...hint("linux"),
		},
		{
			key: "devicetree",
			category: WORKSPACE,
			type: "path",
			required: true,
			must_exist: true,
			description: "Path to target base DTS file",
			...hint("devicetree"),
		},
		{
			key: "workfile",
			category: WORKSPACE,
			type: "path",
			required: false,
			// A new file is fine when its directory exists: `init` creates it (the `check` hook sees to the directory).
			must_exist: false,
			description: "Path to the working DTSO overlay file (workfile)",
			...hint("workfile"),
		},
		{
			key: "overlay-syntax",
			category: WORKSPACE,
			type: "string",
			options: OVERLAY_SYNTAXES,
			required: false,
			default: "fragment",
			description: "fragment: fragment@0 { target = <&spi0>; __overlay__ { … }; };  reference: &spi0 { … };",
		},
		{
			key: "interview",
			category: WORKSPACE,
			type: "bool",
			options: ["true", "false"],
			required: false,
			default: "true",
			description: "On a terminal, ask for the parent of 'add' and for the required properties a new node lacks (true/false)",
		},
		{
			key: "output",
			category: BUILD,
			type: "string",
			options: OUTPUTS,
			required: false,
			default: "overlay",
			description: "What 'build' makes and 'deploy' copies: overlay (default, a .dtbo) or devicetree (the base with the overlay applied, a .dts and its .dtb); the scripts get it as $AA_OUTPUT",
		},
		{
			key: "build-dir",
			category: BUILD,
			type: "string",
			required: false,
			default: DEFAULT_BUILD_DIR,
			description: "Folder aa_build.sh writes its output to and aa_deploy.sh takes it from, relative to the project unless absolute; the scripts get it as $AA_BUILD_DIR",
		},
	];
}

export const SETTINGS: readonly SettingSpec[] = linux_settings();

export function setting_spec(key: string): SettingSpec | undefined {
	return SETTINGS.find(spec => spec.key === key);
}

export interface ConfigError {
	/** Setting key (e.g. `linux`, `workfile`) or resource name (e.g. `dt-schema`). */
	field: string;
	kind: "missing" | "invalid" | "unknown";
	/** Which kind of error it is (GEN-17). */
	error_type: ErrorType;
	message: string;
	description?: string;
	hint?: string;
}

export type ConfigResult<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };

/** An `invalid` error for a setting, carrying its description and hint; `type` says which kind (GEN-17). */
export function invalid_setting(key: SettingKey, problem: string, program: string = DEFAULT_PROGRAM, type: ErrorType = "invalid-setting"): ConfigError {
	const description = setting_spec(key)?.description;
	const hint = setting_hint(key, program);
	return {
		field: key,
		kind: "invalid",
		error_type: type,
		message: `${key}: ${problem}`,
		...(description === undefined ? {} : { description }),
		...(hint === undefined ? {} : { hint }),
	};
}

/** The build and deploy commands the view has, when it has them (a test's view may not). */
function commands(view: Partial<Pick<SettingsView, "executable">>): Pick<Settings, "build_command" | "deploy_command"> {
	const build = view.executable?.(EXECUTABLE_NAMES.build);
	const deploy = view.executable?.(EXECUTABLE_NAMES.deploy);
	return { ...(build === undefined ? {} : { build_command: build }), ...(deploy === undefined ? {} : { deploy_command: deploy }) };
}

/** The settings as the session has them. The front end has checked their types and options and made paths absolute. */
export function read_settings(view: Pick<SettingsView, "get"> & Partial<Pick<SettingsView, "executable">>): Settings {
	const settings: Settings = {
		overlay_syntax: (view.get("overlay-syntax") ?? "fragment") as OverlaySyntax,
		preprocess_command: view.executable?.(EXECUTABLE_NAMES.preprocess) ?? DEFAULT_PREPROCESS_COMMAND,
		...commands(view),
		interview: view.get("interview") !== "false",
		output: (view.get("output") ?? "overlay") as Output,
		build_dir: view.get("build-dir") ?? DEFAULT_BUILD_DIR,
	};
	const values = settings as unknown as Record<string, string | undefined>;
	for (const key of ["linux", "devicetree", "workfile"] as const) {
		const value = view.get(key);
		if (value !== undefined) { values[SETTING_FIELDS[key]] = value; }
	}
	return settings;
}

/** A path as the front end may hand it to a hook: absolute, or starting with `~` (a global setting). */
export function expand_home(file: string): string {
	if (file === "~") { return os.homedir(); }
	return file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file;
}

if (import.meta.vitest) {
	const { test, expect } = import.meta.vitest;

	test("setup_hint — names the config commands of the fields given, and init after the workfile", () => {
		expect(setup_hint(["linux"], "aa")).toBe("Run 'aa' on a terminal, or 'aa config linux <path>', to set up a workspace.");
		expect(setup_hint(["workfile", "linux"], "aa")).toBe("Run 'aa' on a terminal, or 'aa config linux <path>' and 'config workfile <name>', then 'aa init', to set up a workspace.");
		expect(setup_hint(["linux", "devicetree", "workfile"])).toContain("'analog-attach config linux <path>', 'config devicetree <path>' and 'config workfile <name>', then");
	});

	test("missing_hint — the workfile's is the setup hint; the optional ones have none", () => {
		expect(missing_hint("workfile", "aa")).toBe(setup_hint(["workfile"], "aa"));
		expect(missing_hint("overlay-syntax", "aa")).toBeUndefined();
		expect(missing_hint("build-dir", "aa")).toBeUndefined();
	});

	test("SETTINGS - keys are unique and each has a field; path settings say whether they must exist", () => {
		expect(new Set(SETTINGS.map(s => s.key)).size).toBe(SETTINGS.length);
		expect(SETTINGS.map(s => s.key)).toEqual(Object.keys(SETTING_FIELDS));
		expect(SETTINGS.filter(s => s.type === "path").map(s => [s.key, s.must_exist])).toEqual([["linux", true], ["devicetree", true], ["workfile", false]]);
		expect(linux_settings("aa").find(s => s.key === "workfile")?.hint).toBe("Run 'aa init' to create it, or 'aa config workfile <name>' to use another.");
	});

	test("read_settings - the view's values, the defaults when it has none", () => {
		const values: Record<string, string> = { linux: "/l", workfile: "/w/o.dtso" };
		expect(read_settings({ get: key => values[key] })).toEqual({
			linux: "/l", workfile: "/w/o.dtso", overlay_syntax: "fragment", preprocess_command: DEFAULT_PREPROCESS_COMMAND,
			interview: true, output: "overlay", build_dir: DEFAULT_BUILD_DIR,
		});
		expect(read_settings({ get: key => values[key], executable: name => (name === "AA_PREPROCESS_COMMAND" ? "mypp" : undefined) }).preprocess_command).toBe("mypp");
	});

	test("EXECUTABLES - one per step, named AA_, the scripts' defaults", () => {
		expect(EXECUTABLES.map(variable => [variable.name, variable.runs, variable.default])).toEqual([
			["AA_BUILD", "build", "./aa_build.sh"], ["AA_DEPLOY", "deploy", "./aa_deploy.sh"], ["AA_PREPROCESS_COMMAND", "preprocess", DEFAULT_PREPROCESS_COMMAND],
		]);
		expect(executable_default("deploy")).toBe("./aa_deploy.sh");
	});

	test("invalid_setting - the key, the problem, the description and the hint", () => {
		expect(invalid_setting("workfile", "x does not parse", "aa")).toEqual({
			field: "workfile", kind: "invalid", error_type: "invalid-setting", message: "workfile: x does not parse",
			description: "Path to the working DTSO overlay file (workfile)",
			hint: "Run 'aa init' to create it, or 'aa config workfile <name>' to use another.",
		});
	});

	test("expand_home - a leading ~ is the home directory", () => {
		expect(expand_home("~/x")).toBe(path.join(os.homedir(), "x"));
		expect(expand_home("/x")).toBe("/x");
	});
}
