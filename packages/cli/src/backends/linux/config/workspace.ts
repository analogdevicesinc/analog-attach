import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceTree, DeviceTreeOverlay } from "attach-lib";

import type { Outcome, Session } from "../../../interface/backend-interface";
import type { ErrorType } from "../../../interface/error-types";
import { project_root } from "../../shell";
import type { ConfigRefusal } from "../protocol/types";
import { cache_warning, load_compat_index, validation_schema_path } from "./cache";
import { is_tool_available, run_preprocess } from "../utilities";
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
} from "./settings";
import { find_dt_schema, find_dt_validate, find_dtc, find_preprocessor, mk_schema_command, type DtSchemaInstall, type ToolProblem } from "./tools";

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
    /** `validation.json`, the `dt-mk-schema -j` output: it types the properties a binding leaves untyped. */
    processed_schema: string;
    /** The directory with the compat index (`session.state_dir`). */
    state_dir: string;
}

/** Where a workspace keeps and finds its files, from the session. */
export interface WorkspaceContext {
    /** Derived files and the binding caches (`session.state_dir`). */
    state_dir: string;
    /** The backend's own files (`session.assets_dir`): our parallel `dt-mk-schema.py`. */
    assets_dir: string;
    /** The name hints use (`session.program`). */
    program: string;
}

export function workspace_context(session: Pick<Session, "state_dir" | "assets_dir" | "program">): WorkspaceContext {
    return { state_dir: session.state_dir, assets_dir: session.assets_dir, program: session.program };
}

/** The tools on PATH (COM-118, COM-119). */
export interface Tools {
    dtc: string;
    /** The command and its first arguments (`mk_schema_command`). */
    dt_mk_schema: readonly string[];
    dt_validate: string;
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

export interface DeployTarget {
    host: string;
    user: string;
    password: string;
    output: Output;
    /** What `build` compiled from the workfile (`derive_build_files`): the `.dtbo`, or the `.dtb`. */
    binary: string;
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
    deploy: DeployTarget;
}

export type Need = keyof Resources;
export type Workspace<N extends Need> = { settings: Settings; context: WorkspaceContext } & Pick<Resources, N>;

/** Where `build` writes the overlay's `.dtbo`: in `build_directory`, the file named after the overlay (`overlay.dtso` → `overlay.dtbo`). */
export function derive_dtbo_path(overlay: string, build_directory: string): string {
    const name = path.basename(overlay);
    return path.join(build_directory, name.endsWith(".dtso") ? `${name.slice(0, -".dtso".length)}.dtbo` : `${name}.dtbo`);
}

/** The files `build` writes from the workfile: the full devicetree source (output `full`), and the compiled one. */
export interface BuildFiles {
    source?: string;
    binary: string;
}

/**
 * The files `build` writes in `build_directory`, named after the overlay: `overlay.dtso` gives `overlay.dtbo`, or with
 * output `full` `overlay.dts` and `overlay.dtb`; another name gets the extensions appended, so a `.dts` workfile is
 * never written over.
 */
export function derive_build_files(overlay: string, output: Output, build_directory: string): BuildFiles {
    if (output === "overlay") { return { binary: derive_dtbo_path(overlay, build_directory) }; }
    const name = path.basename(overlay);
    const stem = path.join(build_directory, name.endsWith(".dtso") ? name.slice(0, -".dtso".length) : name);
    return { source: `${stem}.dts`, binary: `${stem}.dtb` };
}

/** The `build-dir` setting as a folder: relative to the project root unless absolute, `~` the home directory. */
export function build_folder(setting: string, root: string): string {
    const expanded = setting === "~" || setting.startsWith("~/") ? path.join(os.homedir(), setting.slice(1)) : setting;
    return path.resolve(root, expanded);
}

function failures(...results: ConfigResult<unknown>[]): ConfigError[] {
    return results.flatMap(result => (result.ok ? [] : result.errors));
}

function fail(error: ConfigError): { ok: false; errors: ConfigError[] } {
    return { ok: false, errors: [error] };
}

function require_setting(settings: Settings, key: SettingKey, program: string): ConfigResult<string> {
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
        field, kind: "missing", error_type: "cache-missing", message: `${file} not found or unreadable in ${context.state_dir}`, hint: reload_hint(context.program),
    });
    const errors: ConfigError[] = [];
    if (load_compat_index(context.state_dir)?.entries === undefined) { errors.push(missing("compat-index", "compat-index.json")); }
    if (!fs.existsSync(validation_schema_path(context.state_dir))) { errors.push(missing("validation.json", "validation.json")); }
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
    return {
        ok: true,
        value: {
            linux: linux.value, dt_schema: dt_schema.value.root, dt_schema_version: dt_schema.value.version,
            processed_schema: validation_schema_path(context.state_dir), state_dir: context.state_dir,
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
    return { ok: true, value: { dtc: dtc.value.path, dt_mk_schema: mk_schema_command(dt_schema.value, context.assets_dir), dt_validate: dt_validate.value } };
}

/**
 * Preprocess the base DTS with `preprocess-command` into
 * `preprocessed.dts` of the state directory and parse it. Cheap enough to run
 * on every invocation, which avoids staleness problems.
 */
export function parse_base(settings: Settings, linux: () => ConfigResult<string>, context: Pick<WorkspaceContext, "state_dir" | "program">): ConfigResult<BaseTree> {
    const { program } = context;
    const source = require_path(settings, "devicetree", "file", program);
    const command = settings.preprocess_command;
    const linux_result = command.includes("{linux}") ? linux() : undefined;
    if (!source.ok || linux_result?.ok === false) {
        return { ok: false, errors: failures(source, ...(linux_result === undefined ? [] : [linux_result])) };
    }

    const preprocessor = find_preprocessor(command);
    if (!preprocessor.ok) {
        const { message, hint } = preprocessor.problem;
        return fail({ ...invalid_setting("preprocess-command", `${message} (needed to preprocess ${source.value})`, program, "tool-missing"), hint });
    }

    fs.mkdirSync(context.state_dir, { recursive: true });
    const preprocessed = path.join(context.state_dir, "preprocessed.dts");
    const error = run_preprocess(command, {
        input: source.value,
        output: preprocessed,
        ...(linux_result === undefined ? {} : { linux: linux_result.value }),
    });
    if (error !== undefined) {
        return fail(invalid_setting("devicetree", `preprocessing ${source.value} failed:\n${error}`, program, "tool-failed"));
    }

    const tree = DeviceTree.new_from_string(fs.readFileSync(preprocessed, "utf8"));
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

function parse_deploy(settings: Settings, program: string): ConfigResult<DeployTarget> {
    const host = require_setting(settings, "deploy-ip", program);
    const user = require_setting(settings, "deploy-user", program);
    const password = require_setting(settings, "deploy-password", program);
    const overlay = require_setting(settings, "workfile", program);
    if (!host.ok || !user.ok || !password.ok || !overlay.ok) {
        return { ok: false, errors: failures(host, user, password, overlay) };
    }

    const { binary } = derive_build_files(overlay.value, settings.output, settings.build_dir);
    if (!fs.existsSync(binary)) {
        const what = settings.output === "full" ? "devicetree" : "overlay";
        return fail({ field: "workfile", kind: "missing", error_type: "not-generated", message: `Compiled ${what} ${binary} not found`, hint: "Run 'build' first." });
    }

    const missing = ["scp", "sshpass"].filter(tool => !is_tool_available(`which ${tool}`));
    if (missing.length > 0) {
        return fail({ field: "deploy", kind: "missing", error_type: "tool-missing", message: `${missing.join(", ")} not found on PATH (needed to deploy)` });
    }

    return { ok: true, value: { host: host.value, user: user.value, password: password.value, output: settings.output, binary } };
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
        deploy: () => parse_deploy(settings, program),
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
 * the outcome to end the command with (`config_errors_outcome`). A cache that
 * looks out of date is a warning on stderr.
 */
export function load_workspace<N extends Need>(session: Session, needs: readonly N[]): Loaded<N> {
    const context = workspace_context(session);
    const settings = read_settings(session.settings);
    const workspace = open_workspace({ ...settings, build_dir: build_folder(settings.build_dir, project_root(session)) }, needs, context);
    if (!workspace.ok) { return { ok: false, outcome: config_errors_outcome(session, workspace.errors) }; }
    if (needs.includes("bindings" as N)) {
        const bindings = (workspace.value as Workspace<"bindings">).bindings;
        const warning = cache_warning(bindings, context.state_dir, context.program);
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
                field: "preprocess-command", kind: "invalid", error_type: "tool-missing",
                message: `preprocess-command: cpp not found on PATH (needed to preprocess ${path.join(root, "base.dts")})`,
                description: expect.any(String) as string, hint: install_hint("cpp"),
            }]);
            const own = open(with_linux({ "preprocess-command": "mypp {input} {output}" }), ["base"]);
            expect(own.ok ? undefined : own.errors[0]?.hint).toBe("Install mypp, or set preprocess-command to another command.");
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

    test("open_workspace - deploy needs every deploy field", () => {
        const result = open({ "deploy-ip": "10.0.0.1" }, ["deploy"]);
        expect(fields(result)).toEqual(["deploy-user", "deploy-password", "workfile"]);
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

    const caches = (): void => {
        fs.mkdirSync(state_directory, { recursive: true });
        fs.writeFileSync(path.join(state_directory, "compat-index.json"), JSON.stringify({ generated_at: 1, entries: {} }));
        fs.writeFileSync(path.join(state_directory, "validation.json"), "{}");
    };

    test("open_workspace - bindings need the compat index and validation.json, with a reload hint", () => {
        fs.rmSync(state_directory, { recursive: true, force: true });
        const result = bindings();
        expect(fields(result)).toEqual(["compat-index", "validation.json"]);
        if (result.ok) { return; }
        expect(format_config_errors(result.errors, "aa").human).toContain("aa config --reload");
    });

    test("open_workspace - bindings are there once both caches exist", () => {
        caches();
        expect(bindings()).toEqual({
            ok: true,
            value: { linux, dt_schema: "/dt-schema", dt_schema_version: "2026.9", processed_schema: path.join(state_directory, "validation.json"), state_dir: state_directory },
        });
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
            { field: "deploy-ip", kind: "missing", error_type: "missing-setting", message: "Missing config field deploy-ip" },
        ];
        const outcome = config_errors_outcome({ program: "aa" }, errors);
        if (outcome.kind !== "refused") { throw new Error(`expected a refusal, got ${outcome.kind}`); }
        expect(outcome.response).toEqual({
            ok: false,
            message: "Missing config field linux; Missing config field deploy-ip",
            severity: "error",
            error_type: "missing-setting",
            errors: [
                { field: "linux", kind: "missing", error_type: "missing-setting", message: "Missing config field linux" },
                { field: "deploy-ip", kind: "missing", error_type: "missing-setting", message: "Missing config field deploy-ip" },
            ],
            hints: ["Run 'aa config linux <path>'."],
        });
    });
}
