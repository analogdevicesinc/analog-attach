import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceTree, DeviceTreeOverlay, type PreparedSchemas } from "linux-lib";

import type { Outcome, Session } from "../../../interface/backend-interface";
import type { ErrorType } from "../../../interface/error-types";
import { project_root } from "../../shell";
import type { ConfigRefusal } from "../protocol/types";
import { binding_subset } from "./binding-subset";
import { prepared_schemas } from "./prepared-schemas";
import { cache_warning, load_compat_index, move_flat_validation_cache, recent_sources_mtime, validation_schema_path } from "./cache";
import { preprocess_environment } from "../scripts";
import { run_preprocess } from "../utilities";
import { forget_preprocessed, keep_preprocessed, kept_preprocessed } from "./preprocessed-base";
import {
	invalid_setting,
	missing_hint,
	read_settings,
	setting_spec,
	SETTING_FIELDS,
	type ConfigError,
	type OverlaySyntax,
	type Output,
	type ConfigResult,
	type SettingKey,
	type Settings,
	setup_hint,
	DEFAULT_PREPROCESS_COMMAND,
	EXECUTABLE_NAMES,
	EXECUTABLES,
	executable_default,
} from "./settings";
import { build_folder, SCRIPTS, type ScriptCommand } from "./build-files";
import { find_dt_schema, find_dt_validate, find_dtc, find_preprocessor, mk_schema_command, validate_worker, type DtSchemaInstall, type ToolProblem, type ValidateWorker } from "./tools";

// Parse, don't validate: each resource below is produced only from settings
// that have been checked all the way down (the Linux tree has its bindings and
// headers, the base DTS preprocesses and parses, the overlay parses against
// it). A command asks `load_workspace` for the resources it needs and, once it
// has them, cannot fail because of the configuration.

export interface Bindings {
	linux: string;
	/** The directory holding the installed `dtschema` package (COM-119). */
	dt_schema: string;
	dt_schema_version: string;
	/**
	 * What the binding parser reads of `validation.json` (the `dt-mk-schema -j` output): the binding subset (COM-138),
	 * else validation.json itself. It types the properties a binding leaves untyped, and says which schemas are
	 * `select: true`.
	 */
	processed_schema: string;
	/** `validation.json` itself, what dt-validate gets. */
	validation_schema: string;
	/** The directory with the compat index (`session.state_dir`). */
	state_dir: string;
	/** The prepared schemas saved in `validation-cache/` (COM-139), which the binding parser takes in place of building them. */
	prepared?: PreparedSchemas;
	/** Without `prepared`: saves the ones the first binding parse builds. */
	on_prepared?: (prepared: PreparedSchemas) => void;
	/** The process runs more commands (`Session.long_lived`): a parsed binding is kept for them (`parse_binding_once`). */
	long_lived?: boolean;
}

/** Where a workspace keeps and finds its files, from the session. */
export interface WorkspaceContext {
	/** Derived files and the binding caches (`session.state_dir`). */
	state_dir: string;
	/** The backend's own files (`session.assets_dir`): our parallel `dt-mk-schema.py`. */
	assets_dir: string;
	/** The name hints use (`session.program`). */
	program: string;
	/** `session.long_lived`: what is read may be kept for the next command. Default false. */
	long_lived?: boolean;
	/** Where `AA_PREPROCESS_COMMAND` runs (`session.cwd`). Default: the process's. */
	cwd?: string;
}

export function workspace_context(session: Pick<Session, "state_dir" | "assets_dir" | "program" | "long_lived" | "cwd">): WorkspaceContext {
	return { state_dir: session.state_dir, assets_dir: session.assets_dir, program: session.program, long_lived: session.long_lived, cwd: session.cwd };
}

/** The tools on PATH (COM-118, COM-119). */
export interface Tools {
	dtc: string;
	/** The command and its first arguments (`mk_schema_command`). */
	dt_mk_schema: readonly string[];
	dt_validate: string;
	/** The long-lived dt-validate, when the backend ships its script. */
	dt_validate_worker?: ValidateWorker;
}

export interface BaseTree {
	/** The configured DTS file. */
	source: string;
	/** The preprocessed copy the tree was parsed from. */
	preprocessed: string;
	tree: DeviceTree;
}

export interface Workfile {
	path: string;
	tree: DeviceTreeOverlay;
	syntax: OverlaySyntax;
	print(): string;
	save(): void;
}

export interface Resources {
	/** The Linux tree, with its bindings and headers (`list context`). */
	linux: string;
	bindings: Bindings;
	tools: Tools;
	base: BaseTree;
	overlay: Workfile;
	/** The configured workfile's path, whether its file exists or not (`init`). */
	overlay_path: string;
	/** The configured workfile's path, its file there, unread (`build` of an overlay, which aa_build.sh compiles). */
	workfile_file: string;
	/** `AA_BUILD`: by default `./aa_build.sh`, then checked to be an executable file at the project root (`build`, COM-150). */
	build_script: string;
	/** `AA_DEPLOY`: by default `./aa_deploy.sh`, checked the same way (`deploy`, COM-150). */
	deploy_script: string;
}

/** The hint that writes a script's starter again (INIT-104), or points the command elsewhere. */
export function restore_hint(command: ScriptCommand, program: string): string {
	return `Run '${program} init --restore ${command}' to write the starter ${SCRIPTS[command]}, or set ${EXECUTABLE_NAMES[command]} to another command ('${program} config var ${EXECUTABLE_NAMES[command]} <command>').`;
}

/**
 * A command's executable variable (`AA_BUILD`, `AA_DEPLOY`). At its default, the script at the
 * project root it runs must be there, a file, and executable; a missing one is never written
 * again here: `init --restore` does that (BUILD-003, DEPLOY-003). Another command is the
 * user's, run as it is.
 */
export function parse_script(command: ScriptCommand, settings: Pick<Settings, "build_command" | "deploy_command">, context: Pick<WorkspaceContext, "state_dir" | "program">): ConfigResult<string> {
	const default_command = executable_default(command);
	const given = command === "build" ? settings.build_command : settings.deploy_command;
	if (given !== undefined && given !== default_command) { return { ok: true, value: given }; }
	const name = SCRIPTS[command];
	const root = project_root(context);
	const file = path.join(root, name);
	const stat = fs.statSync(file, { throwIfNoEntry: false });
	if (stat === undefined) {
		return fail({ field: name, kind: "missing", error_type: "not-generated", message: `${name} not found in ${root}`, hint: restore_hint(command, context.program) });
	}
	if (!stat.isFile()) {
		return fail({ field: name, kind: "invalid", error_type: "tool-missing", message: `${file} is not a file`, hint: `Move it away, then run '${context.program} init --restore ${command}'.` });
	}
	try {
		fs.accessSync(file, fs.constants.X_OK);
	} catch {
		return fail({ field: name, kind: "invalid", error_type: "tool-missing", message: `${file} is not executable`, hint: `Run 'chmod +x ${file}'.` });
	}
	return { ok: true, value: default_command };
}

export { build_folder, derive_build_files, derive_dtbo_path, SCRIPTS, type BuildFiles, type ScriptCommand } from "./build-files";

export type Need = keyof Resources;
export type Workspace<N extends Need> = { settings: Settings; context: WorkspaceContext } & Pick<Resources, N>;

function failures(...results: ConfigResult<unknown>[]): ConfigError[] {
	return results.flatMap(result => (result.ok ? [] : result.errors));
}

function fail(error: ConfigError): { ok: false; errors: ConfigError[] } {
	return { ok: false, errors: [error] };
}

export function require_setting(settings: Settings, key: SettingKey, program: string): ConfigResult<string> {
	const value = settings[SETTING_FIELDS[key]];
	if (typeof value === "string") { return { ok: true, value }; }
	const description = setting_spec(key)?.description;
	const hint = missing_hint(key, program);
	return fail({
		field: key,
		kind: "missing",
		error_type: "missing-setting",
		message: `Missing config field ${key}`,
		...(description === undefined ? {} : { description }),
		...(hint === undefined ? {} : { hint }),
	});
}

function require_path(settings: Settings, key: SettingKey, kind: "file" | "directory", program: string): ConfigResult<string> {
	const value = require_setting(settings, key, program);
	if (!value.ok) { return value; }
	const stat = fs.statSync(value.value, { throwIfNoEntry: false });
	if (stat === undefined) { return fail(invalid_setting(key, `${value.value} does not exist`, program, key === "workfile" ? "workfile-missing" : "invalid-setting")); }
	if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
		return fail(invalid_setting(key, `${value.value} is not a ${kind}`, program));
	}
	return value;
}

/** Why `directory` is not a usable Linux source tree, or undefined when it is. */
export function linux_tree_problem(directory: string): string | undefined {
	for (const expected of [path.join("Documentation", "devicetree", "bindings"), "include"]) {
		if (!fs.existsSync(path.join(directory, expected))) {
			return `no ${expected}/ under ${directory} (not a Linux source tree)`;
		}
	}
	return undefined;
}

export function parse_linux(settings: Settings, program: string): ConfigResult<string> {
	const linux = require_path(settings, "linux", "directory", program);
	if (!linux.ok) { return linux; }
	const problem = linux_tree_problem(linux.value);
	return problem === undefined ? linux : fail(invalid_setting("linux", problem, program, "invalid-source"));
}

/** A tool problem as a configuration error of `field`. */
function tool_error(field: string, { kind, message, hint }: ToolProblem): ConfigError {
	return { field, kind, error_type: "tool-missing", message, hint };
}

/** The installed dt-schema (COM-119): the schemas the parser reads, and what runs dt-mk-schema. */
export function parse_dt_schema(context: Pick<WorkspaceContext, "program">): ConfigResult<DtSchemaInstall> {
	const found = find_dt_schema(context.program);
	return found.ok ? found : fail(tool_error("dt-schema", found.problem));
}

export const reload_hint = (program: string): string => `Run '${program} config --reload' to build the binding caches.`;

/** The caches `config linux <path>` and `config --reload` build; commands only read them, so they must be there. */
function parse_caches(context: Pick<WorkspaceContext, "state_dir" | "program">): ConfigResult<undefined> {
	const missing = (field: string, file: string): ConfigError => ({
		field, kind: "missing", error_type: "cache-missing", message: `${path.basename(file)} not found or unreadable in ${path.dirname(file)}`, hint: reload_hint(context.program),
	});
	const errors: ConfigError[] = [];
	move_flat_validation_cache(context.state_dir);
	if (load_compat_index(context.state_dir)?.entries === undefined) { errors.push(missing("compat-index", path.join(context.state_dir, "compat-index.json"))); }
	if (!fs.existsSync(validation_schema_path(context.state_dir))) { errors.push(missing("validation.json", validation_schema_path(context.state_dir))); }
	return errors.length > 0 ? { ok: false, errors } : { ok: true, value: undefined };
}

export function parse_bindings(
	settings: Settings,
	context: WorkspaceContext,
	linux_tree: () => ConfigResult<string> = () => parse_linux(settings, context.program),
	installed_dt_schema: () => ConfigResult<DtSchemaInstall> = () => parse_dt_schema(context),
): ConfigResult<Bindings> {
	const linux = linux_tree();
	const dt_schema = installed_dt_schema();
	if (!linux.ok || !dt_schema.ok) { return { ok: false, errors: failures(linux, dt_schema) }; }
	const caches = parse_caches(context);
	if (!caches.ok) { return caches; }
	const source = { linux: linux.value, dt_schema: dt_schema.value.root, dt_schema_version: dt_schema.value.version, state_dir: context.state_dir };
	return {
		ok: true,
		value: {
			linux: linux.value, dt_schema: dt_schema.value.root, dt_schema_version: dt_schema.value.version,
			processed_schema: binding_subset(context.state_dir) ?? validation_schema_path(context.state_dir),
			validation_schema: validation_schema_path(context.state_dir), state_dir: context.state_dir,
			...prepared_schemas(source),
			...(context.long_lived === true ? { long_lived: true } : {}),
		},
	};
}

/** dtc, dt-mk-schema and dt-validate, from PATH (COM-118, COM-119). */
export function parse_tools(
	context: Pick<WorkspaceContext, "assets_dir" | "program">,
	installed_dt_schema: () => ConfigResult<DtSchemaInstall> = () => parse_dt_schema(context),
): ConfigResult<Tools> {
	const dtc = find_dtc(context.program);
	const dt_schema = installed_dt_schema();
	const dt_validate = find_dt_validate();
	const errors = [
		...(dtc.ok ? [] : [tool_error("dtc", dtc.problem)]),
		...failures(dt_schema),
		...(dt_validate.ok ? [] : [tool_error("dt-schema", dt_validate.problem)]),
	];
	if (!dtc.ok || !dt_schema.ok || !dt_validate.ok) { return { ok: false, errors }; }
	const worker = validate_worker(dt_schema.value, context.assets_dir);
	return {
		ok: true,
		value: {
			dtc: dtc.value.path,
			dt_mk_schema: mk_schema_command(dt_schema.value, context.assets_dir),
			dt_validate: dt_validate.value,
			...(worker === undefined ? {} : { dt_validate_worker: worker }),
		},
	};
}

/**
 * Preprocess the base DTS with `AA_PREPROCESS_COMMAND` into
 * `preprocessed.dts` of the state directory and parse it, the command run in the
 * session's cwd. With the default command, its output is kept for the next run while
 * the files it read are as they were (`preprocessed-base.ts`); the tree is parsed
 * afresh each run, since a command may change it.
 */
export function parse_base(settings: Settings, linux: () => ConfigResult<string>, context: Pick<WorkspaceContext, "state_dir" | "program" | "cwd">): ConfigResult<BaseTree> {
	const { program } = context;
	const source = require_path(settings, "devicetree", "file", program);
	const command = settings.preprocess_command;
	const linux_result = command.includes("AA_LINUX") ? linux() : undefined;
	if (!source.ok || linux_result?.ok === false) {
		return { ok: false, errors: failures(source, ...(linux_result === undefined ? [] : [linux_result])) };
	}

	const preprocessor = find_preprocessor(command);
	if (!preprocessor.ok) {
		const { message, hint } = preprocessor.problem;
		const description = EXECUTABLES.find(variable => variable.name === EXECUTABLE_NAMES.preprocess)?.description ?? "";
		return fail({ field: EXECUTABLE_NAMES.preprocess, kind: "invalid", error_type: "tool-missing", message: `${EXECUTABLE_NAMES.preprocess}: ${message} (needed to preprocess ${source.value})`, description, hint });
	}

	fs.mkdirSync(context.state_dir, { recursive: true });
	const preprocessed = path.join(context.state_dir, "preprocessed.dts");
	const values = { input: source.value, ...(linux_result === undefined ? {} : { linux: linux_result.value }) };
	const cwd = context.cwd ?? process.cwd();
	// Kept with the default command only, whose includes are the source's and the Linux tree's.
	const keeps = command === DEFAULT_PREPROCESS_COMMAND && linux_result?.ok === true;
	const key = JSON.stringify([values, preprocessed]);
	let text = keeps ? kept_preprocessed(key, preprocessed) : undefined;
	if (text === undefined) {
		// Each run preprocesses into its own file, then renames it into place: two runs at once
		// (the GUI reads several things together) never read each other's half-written copy.
		const own = path.join(context.state_dir, `preprocessed.${String(process.pid)}.dts`);
		const error = run_preprocess(settings, { ...values, output: own }, cwd);
		if (error !== undefined) {
			fs.rmSync(own, { force: true });
			forget_preprocessed(key);
			return fail(invalid_setting("devicetree", `preprocessing ${source.value} failed:\n${error}`, program, "tool-failed"));
		}
		text = fs.readFileSync(own, "utf8");
		fs.renameSync(own, preprocessed);
		if (keeps) { keep_preprocessed(key, text, source.value, linux_result.value); }
	}
	const tree = DeviceTree.new_from_string(text);
	if (typeof tree === "string") {
		return fail(invalid_setting("devicetree", `${source.value} does not parse after preprocessing: ${tree}`, program, "parse-error"));
	}
	return { ok: true, value: { source: source.value, preprocessed, tree } };
}

export function open_workfile(file: string, tree: DeviceTreeOverlay, syntax: OverlaySyntax): Workfile {
	const print = (): string => tree.print({ syntax });
	return { path: file, tree, syntax, print, save: () => { fs.writeFileSync(file, print()); } };
}

/** Parse the configured workfile against an already parsed base tree. */
export function parse_overlay(settings: Settings, base: BaseTree, program: string): ConfigResult<Workfile> {
	const file = require_path(settings, "workfile", "file", program);
	if (!file.ok) { return file; }
	const tree = DeviceTreeOverlay.new_from_string(fs.readFileSync(file.value, "utf8"), base.tree);
	if (typeof tree === "string") {
		return fail(invalid_setting("workfile", `${file.value} does not parse: ${tree}`, program, "parse-error"));
	}
	return { ok: true, value: open_workfile(file.value, tree, settings.overlay_syntax) };
}

/**
 * Build the resources in `needs` (and what they depend on) from `settings`.
 * Errors from independent resources are all collected; a resource whose
 * dependency failed reports only its own setting problems on top.
 */
export function open_workspace<N extends Need>(settings: Settings, needs: readonly N[], context: WorkspaceContext): ConfigResult<Workspace<N>> {
	const { program } = context;
	let linux_result: ConfigResult<string> | undefined;
	let dt_schema_result: ConfigResult<DtSchemaInstall> | undefined;
	let base_result: ConfigResult<BaseTree> | undefined;
	const linux = (): ConfigResult<string> => (linux_result ??= parse_linux(settings, program));
	// Looked up once: it runs a Python, and the bindings and the tools both need it.
	const dt_schema = (): ConfigResult<DtSchemaInstall> => (dt_schema_result ??= parse_dt_schema(context));
	const base = (): ConfigResult<BaseTree> => (base_result ??= parse_base(settings, linux, context));

	const parsers: { [K in Need]: () => ConfigResult<Resources[K]> } = {
		linux,
		bindings: () => parse_bindings(settings, context, linux, dt_schema),
		tools: () => parse_tools(context, dt_schema),
		base,
		overlay: () => {
			const base_value = base();
			if (!base_value.ok) { return { ok: false, errors: [...base_value.errors, ...failures(require_path(settings, "workfile", "file", program))] }; }
			return parse_overlay(settings, base_value.value, program);
		},
		overlay_path: () => require_setting(settings, "workfile", program),
		workfile_file: () => require_path(settings, "workfile", "file", program),
		build_script: () => parse_script("build", settings, context),
		deploy_script: () => parse_script("deploy", settings, context),
	};

	const workspace: Record<string, unknown> = { settings, context };
	const errors: ConfigError[] = [];
	for (const need of needs) {
		const result = parsers[need]();
		if (result.ok) {
			workspace[need] = result.value;
		} else {
			for (const error of result.errors) {
				if (!errors.some(seen => seen.field === error.field && seen.message === error.message)) { errors.push(error); }
			}
		}
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true, value: workspace as Workspace<N> };
}

export function format_config_errors(errors: readonly ConfigError[], program: string): { human: string; response: ConfigRefusal } {
	// The setup hints of several fields become one that names them all.
	const is_setup = (error: ConfigError): boolean => error.hint !== undefined && error.hint === setup_hint([error.field], program);
	const setup_fields = errors.filter(error => is_setup(error)).map(error => error.field);
	const hints = [...new Set(errors.map(error => (is_setup(error) ? setup_hint(setup_fields, program) : error.hint)).filter((hint): hint is string => hint !== undefined))];
	const lines = errors.map(error => (error.description === undefined ? error.message : `${error.message} — ${error.description}`));
	const body = lines.length === 1 ? lines[0]! : ["Configuration errors:", ...lines.map(line => `  ${line}`)].join("\n");
	const human = hints.length > 0 ? `${body}\n\n${hints.join("\n")}` : body;
	const response: ConfigRefusal = {
		ok: false,
		message: errors.map(error => error.message).join("; "),
		severity: "error",
		error_type: config_error_type(errors),
		errors: errors.map(({ field, kind, error_type, message, description }) => ({ field, kind, error_type, message, ...(description === undefined ? {} : { description }) })),
		hints,
	};
	return { human, response };
}

/** The type a refusal over configuration errors carries (GEN-17): the first error's. */
export function config_error_type(errors: readonly ConfigError[]): ErrorType {
	return errors[0]?.error_type ?? "invalid-setting";
}

/**
 * How a command ends on configuration errors: a refusal (COM-071, COM-072), the errors and
 * hints in the response and the merged hint in the text.
 */
export function config_errors_outcome(session: Pick<Session, "program">, errors: readonly ConfigError[]): Outcome<never> {
	const { human, response } = format_config_errors(errors, session.program);
	return { kind: "refused", response, text: () => human };
}

export type Loaded<N extends Need> = { ok: true; workspace: Workspace<N> } | { ok: false; outcome: Outcome<never> };

/**
 * Read the settings and build the resources a command needs. On any problem
 * the outcome to end the command with (`config_errors_outcome`), with the
 * command's own `also` (a secret `deploy` can't get) after the workspace's. A
 * cache that looks out of date is a warning on stderr.
 */
export function load_workspace<N extends Need>(session: Session, needs: readonly N[], also: readonly ConfigError[] = []): Loaded<N> {
	const context = workspace_context(session);
	const settings = read_settings(session.settings);
	const workspace = open_workspace({
		...settings, build_dir: build_folder(settings.build_dir, project_root(session)), preprocess_environment: preprocess_environment(session),
	}, needs, context);
	if (!workspace.ok || also.length > 0) {
		return { ok: false, outcome: config_errors_outcome(session, [...workspace.ok ? [] : workspace.errors, ...also]) };
	}
	if (needs.includes("bindings" as N)) {
		const bindings = (workspace.value as Workspace<"bindings">).bindings;
		// A long-lived process's runs come in bursts (the GUI's): the bindings are walked once for a burst.
		const latest_mtime = context.long_lived === true ? recent_sources_mtime(bindings) : undefined;
		const warning = cache_warning(bindings, context.state_dir, context.program, latest_mtime);
		if (warning !== undefined) { session.warn(`warning: ${warning}`); }
	}
	return { ok: true, workspace: workspace.value };
}

/** The bindings when they are there, for a command that works without them too (`read`, `rename`). */
export function optional_bindings(workspace: Pick<Workspace<never>, "settings" | "context">): ConfigResult<Bindings> {
	return parse_bindings(workspace.settings, workspace.context);
}

if (import.meta.vitest) {
	const { test, expect, beforeAll, afterAll } = import.meta.vitest;
	const { install_hint } = await import("./tools");

	let root: string;
	let linux: string;
	let state_directory: string;

	beforeAll(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-ws-"));
		linux = path.join(root, "linux");
		state_directory = path.join(root, "workspace", ".analog-attach", "linux");
		fs.mkdirSync(path.join(linux, "Documentation", "devicetree", "bindings"), { recursive: true });
		fs.mkdirSync(path.join(linux, "include", "dt-bindings", "gpio"), { recursive: true });
		fs.writeFileSync(path.join(linux, "include", "dt-bindings", "gpio", "gpio.h"), "#define GPIO_ACTIVE_LOW 1\n");
		fs.writeFileSync(path.join(root, "base.dts"), [
			"/dts-v1/;",
			"#include <dt-bindings/gpio/gpio.h>",
			"/ { soc { spi0: spi@7e204000 { flags = <GPIO_ACTIVE_LOW>; }; }; };",
		].join("\n"));
		fs.writeFileSync(path.join(root, "broken.dts"), "#include <dt-bindings/missing.h>\n");
		fs.writeFileSync(path.join(root, "overlay.dtso"), "/dts-v1/;\n/plugin/;\n&spi0 { adc@0 { reg = <0>; }; };\n");
		fs.writeFileSync(path.join(root, "bad.dtso"), "/dts-v1/;\n/plugin/;\n&spi0 { adc@0 { reg = <0> };\n");
	});

	afterAll(() => {
		fs.rmSync(root, { recursive: true });
	});

	/** Settings as the front end hands them: paths made absolute against the test root. */
	const settings_for = (values: Record<string, string>): Settings => read_settings({
		executable: name => values[name],
		get: key => {
			const value = values[key];
			return value !== undefined && ["linux", "devicetree", "workfile"].includes(key) ? path.resolve(root, value) : value;
		},
	});

	const context = (): WorkspaceContext => ({ state_dir: state_directory, assets_dir: path.join(root, "assets"), program: "aa" });

	const open = <N extends Need>(values: Record<string, string>, needs: readonly N[]): ConfigResult<Workspace<N>> =>
		open_workspace(settings_for(values), needs, context());

	const with_linux = (extra: Record<string, string> = {}, devicetree = "base.dts"): Record<string, string> =>
		({ linux, devicetree, ...extra });

	const fields = (result: ConfigResult<unknown>): string[] => (result.ok ? [] : result.errors.map(error => error.field));

	test("open_workspace - preprocesses #include and parses base and overlay", () => {
		const result = open(with_linux({ workfile: "overlay.dtso" }), ["base", "overlay"]);
		expect(result.ok).toBe(true);
		if (!result.ok) { return; }
		expect(result.value.base.preprocessed).toBe(path.join(state_directory, "preprocessed.dts"));
		expect(result.value.base.tree.node_exists("spi0")).toBe(true);
		expect(result.value.overlay.print()).toContain("adc@0");
	});

	test("open_workspace - independent missing settings are all reported", () => {
		const result = open({}, ["base", "overlay"]);
		expect(fields(result)).toEqual(["devicetree", "linux", "workfile"]);
	});

	test("open_workspace - a shared dependency is reported once", () => {
		const result = open({ devicetree: "base.dts" }, ["base", "overlay"]);
		expect(fields(result)).toEqual(["linux", "workfile"]);
	});

	test("open_workspace - linux without include/ is rejected", () => {
		const fake = path.join(root, "not-linux");
		fs.mkdirSync(path.join(fake, "Documentation", "devicetree", "bindings"), { recursive: true });
		const result = open({ linux: fake, devicetree: "base.dts" }, ["base"]);
		expect(result.ok).toBe(false);
		if (result.ok) { return; }
		expect(result.errors[0]!.message).toContain("no include/");
	});

	test("open_workspace - a preprocessing failure is a hard error", () => {
		const result = open(with_linux({}, "broken.dts"), ["base"]);
		expect(result.ok).toBe(false);
		if (result.ok) { return; }
		expect(result.errors[0]!.message).toContain("preprocessing");
	});

	test("open_workspace - a preprocessor not on PATH: cpp with its install hint, another tool with the setting's", () => {
		const original = process.env["PATH"];
		process.env["PATH"] = path.join(root, "no-tools");
		try {
			const result = open(with_linux(), ["base"]);
			expect(result.ok ? [] : result.errors).toEqual([{
				field: "AA_PREPROCESS_COMMAND", kind: "invalid", error_type: "tool-missing",
				message: `AA_PREPROCESS_COMMAND: cpp not found on PATH (needed to preprocess ${path.join(root, "base.dts")})`,
				description: expect.any(String) as string, hint: install_hint("cpp"),
			}]);
			const own = open(with_linux({ AA_PREPROCESS_COMMAND: `mypp "$AA_PREPROCESS_INPUT" "$AA_PREPROCESS_OUTPUT"` }), ["base"]);
			expect(own.ok ? undefined : own.errors[0]?.hint).toBe("Install mypp, or set AA_PREPROCESS_COMMAND to another command ('config var AA_PREPROCESS_COMMAND <command>').");
			// A script the CLI can't look into is run unchecked.
			const script = open(with_linux({ AA_PREPROCESS_COMMAND: `set -e\nmypp "$AA_PREPROCESS_INPUT"` }), ["base"]);
			expect(script.ok ? [] : script.errors.map(error => error.field)).toEqual(["devicetree"]);
		} finally {
			process.env["PATH"] = original;
		}
	});

	test("open_workspace - an overlay that does not parse is a config error", () => {
		const result = open(with_linux({ workfile: "bad.dtso" }), ["overlay"]);
		expect(fields(result)).toEqual(["workfile"]);
	});

	test("open_workspace - a missing overlay file is reported", () => {
		const result = open(with_linux({ workfile: "nope.dtso" }), ["overlay"]);
		expect(result.ok).toBe(false);
		if (result.ok) { return; }
		expect(result.errors[0]!.message).toContain("does not exist");
	});

	test("build_folder - relative to the project root unless absolute, ~ the home directory", () => {
		expect(build_folder("build", "/p")).toBe("/p/build");
		expect(build_folder("/abs/out", "/p")).toBe("/abs/out");
		expect(build_folder("~/out", "/p")).toBe(path.join(os.homedir(), "out"));
	});

	test("open_workspace - a script must be at the project root, a file, and executable", () => {
		const project = path.dirname(path.dirname(state_directory));
		const script = path.join(project, "aa_build.sh");
		fs.mkdirSync(project, { recursive: true });
		fs.rmSync(script, { recursive: true, force: true });
		const missing = open({}, ["build_script"]);
		expect(missing.ok ? [] : missing.errors).toEqual([{
			field: "aa_build.sh", kind: "missing", error_type: "not-generated", message: `aa_build.sh not found in ${project}`,
			hint: "Run 'aa init --restore build' to write the starter aa_build.sh, or set AA_BUILD to another command ('aa config var AA_BUILD <command>').",
		}]);
		fs.writeFileSync(script, "#!/bin/sh\n", { mode: 0o644 });
		const plain = open({}, ["build_script"]);
		expect(plain.ok ? [] : plain.errors).toMatchObject([{ field: "aa_build.sh", error_type: "tool-missing", message: `${script} is not executable`, hint: `Run 'chmod +x ${script}'.` }]);
		fs.chmodSync(script, 0o755);
		const found = open({}, ["build_script"]);
		expect(found.ok ? found.value.build_script : found.errors).toBe("./aa_build.sh");
		fs.rmSync(script);
		fs.mkdirSync(script);
		const folder = open({}, ["build_script"]);
		expect(folder.ok ? [] : folder.errors).toMatchObject([{ field: "aa_build.sh", error_type: "tool-missing", message: `${script} is not a file` }]);
		// Another command is the user's: nothing is checked.
		const own = open({ AA_BUILD: "make overlay" }, ["build_script"]);
		expect(own.ok ? own.value.build_script : own.errors).toBe("make overlay");
		fs.rmSync(script, { recursive: true });
	});

	test("open_workspace - the tools are looked up on PATH, each problem with its install hint", () => {
		const original = process.env["PATH"];
		process.env["PATH"] = path.join(root, "no-tools");
		try {
			const result = open({}, ["tools", "bindings"]);
			if (result.ok) { throw new Error("expected errors"); }
			// dt-schema's problem once, though the bindings and the tools both need it.
			expect(result.errors.map(({ field, kind, error_type, message }) => ({ field, kind, error_type, message }))).toEqual([
				{ field: "dtc", kind: "missing", error_type: "tool-missing", message: "dtc not found on PATH" },
				{ field: "dt-schema", kind: "missing", error_type: "tool-missing", message: "dt-mk-schema not found on PATH" },
				{ field: "dt-schema", kind: "missing", error_type: "tool-missing", message: "dt-validate not found on PATH" },
				{ field: "linux", kind: "missing", error_type: "missing-setting", message: "Missing config field linux" },
			]);
			expect(result.errors[1]!.hint).toMatch(/^Install dt-schema 2026\.9: 'pipx install dtschema==2026\.9'/);
		} finally {
			process.env["PATH"] = original;
		}
	});

	const installed: DtSchemaInstall = { root: "/dt-schema", version: "2026.9", python: "/venv/bin/python", dt_mk_schema: "/venv/bin/dt-mk-schema" };
	const bindings = (): ConfigResult<Bindings> =>
		parse_bindings(settings_for(with_linux()), context(), undefined, () => ({ ok: true, value: installed }));

	/** The two caches, validation.json where an earlier version kept it (`flat`) or in validation-cache/. */
	const caches = (flat = false): void => {
		fs.rmSync(state_directory, { recursive: true, force: true });
		fs.mkdirSync(path.join(state_directory, "validation-cache"), { recursive: true });
		fs.writeFileSync(path.join(state_directory, "compat-index.json"), JSON.stringify({ generated_at: 1, entries: {} }));
		fs.writeFileSync(flat ? path.join(state_directory, "validation.json") : validation_schema_path(state_directory), "{}");
	};
	const found = (): ConfigResult<Bindings> => ({
		ok: true,
		value: {
			linux, dt_schema: "/dt-schema", dt_schema_version: "2026.9",
			processed_schema: expect.stringMatching(/validation-cache\/binding-subset-[\da-f]{32}\.json$/) as unknown as string,
			validation_schema: path.join(state_directory, "validation-cache", "validation.json"), state_dir: state_directory,
			on_prepared: expect.any(Function) as unknown as Bindings["on_prepared"],
		},
	});

	test("open_workspace - bindings need the compat index and validation.json, with a reload hint", () => {
		fs.rmSync(state_directory, { recursive: true, force: true });
		const result = bindings();
		expect(fields(result)).toEqual(["compat-index", "validation.json"]);
		if (result.ok) { return; }
		expect(format_config_errors(result.errors, "aa").human).toContain("aa config --reload");
	});

	test("open_workspace - bindings are there once both caches exist, the binding parser reading the binding subset", () => {
		caches();
		expect(bindings()).toEqual(found());
	});

	test("open_workspace - the prepared schemas a parse saved are what the next command's bindings give, until validation.json is rebuilt", () => {
		caches();
		const prepared: PreparedSchemas = {
			property_types: { names: new Map([["reg", "address"]]), patterns: [] },
			selected: { properties: new Map(), patterns: new Map() },
		};
		const first = bindings();
		if (!first.ok) { throw new Error("expected bindings"); }
		first.value.on_prepared?.(prepared);

		const expected = found();
		if (!expected.ok) { throw new Error("expected bindings"); }
		// toEqual: no on_prepared, as undefined
		expect(bindings()).toEqual({ ok: true, value: { ...expected.value, on_prepared: undefined, prepared } });

		fs.writeFileSync(validation_schema_path(state_directory), "{ }");
		expect(bindings()).toEqual(found());
	});

	test("open_workspace - validation.json where an earlier version kept it is moved into validation-cache", () => {
		caches(true);
		expect(bindings()).toEqual(found());
		expect(fs.existsSync(path.join(state_directory, "validation.json"))).toBe(false);
	});

	test("open_workspace - an unreadable compat index counts as missing", () => {
		caches();
		fs.writeFileSync(path.join(state_directory, "compat-index.json"), "{ not json");
		expect(fields(bindings())).toEqual(["compat-index"]);
	});

	test("format_config_errors - single error includes description and hint", () => {
		const result = open({}, ["base"]);
		if (result.ok) { throw new Error("expected errors"); }
		const message = format_config_errors(result.errors.slice(0, 1), "aa");
		expect(message.human).toContain("devicetree");
		expect(message.human).toContain("base DTS file");
		expect(message.human).toContain("'aa config devicetree <path>'");
	});

	test("format_config_errors - shared hints are printed once", () => {
		const result = open({}, ["base"]);
		if (result.ok) { throw new Error("expected errors"); }
		const message = format_config_errors(result.errors, "aa");
		expect(message.human).toContain("Missing config field linux");
		expect(message.human).toContain("Missing config field devicetree");
		expect(message.human.split("Run 'aa' on a terminal").length - 1).toBe(1);
		expect(message.human).toContain("'aa config linux <path>' and 'config devicetree <path>', to set up");
		expect(message.response.errors).toHaveLength(2);
	});

	test("format_config_errors - the setup hint names only the fields that are missing", () => {
		const result = open({ linux }, ["base", "overlay_path"]);
		if (result.ok) { throw new Error("expected errors"); }
		const message = format_config_errors(result.errors, "aa");
		expect(message.response.hints).toEqual([setup_hint(["devicetree", "workfile"], "aa")]);
		expect(message.human).not.toContain("config linux");
	});

	test("config_errors_outcome - a refusal naming each problem, with the hints", () => {
		const errors: ConfigError[] = [
			{ field: "linux", kind: "missing", error_type: "missing-setting", message: "Missing config field linux", hint: "Run 'aa config linux <path>'." },
			{ field: "BOARD_PASSWORD", kind: "missing", error_type: "missing-setting", message: "Secret variable BOARD_PASSWORD is not in the environment" },
		];
		const outcome = config_errors_outcome({ program: "aa" }, errors);
		if (outcome.kind !== "refused") { throw new Error(`expected a refusal, got ${outcome.kind}`); }
		expect(outcome.response).toEqual({
			ok: false,
			message: "Missing config field linux; Secret variable BOARD_PASSWORD is not in the environment",
			severity: "error",
			error_type: "missing-setting",
			errors: [
				{ field: "linux", kind: "missing", error_type: "missing-setting", message: "Missing config field linux" },
				{ field: "BOARD_PASSWORD", kind: "missing", error_type: "missing-setting", message: "Secret variable BOARD_PASSWORD is not in the environment" },
			],
			hints: ["Run 'aa config linux <path>'."],
		});
	});
}
