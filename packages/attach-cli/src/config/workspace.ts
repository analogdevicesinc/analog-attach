import * as fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { DeviceTree, DeviceTreeOverlay } from "attach-lib";

import type { LocalContext } from "../context";
import { getBundledDtSchemaPath, getBundledToolsPath } from "../commands/skill/utilities";
import { input_error } from "../protocol/output";
import { is_tool_available, substitute_command } from "../utilities";
import {
    config_directory,
    invalid_setting,
    read_settings,
    setting_spec,
    type ConfigError,
    type OverlaySyntax,
    type Result,
    type SettingKey,
    type SettingSpec,
    type Settings,
} from "./settings";

// Parse, don't validate: each resource below is produced only from settings
// that have been checked all the way down (the Linux tree has its bindings and
// headers, the base DTS preprocesses and parses, the overlay parses against
// it). A command asks `load_workspace` for the resources it needs and, once it
// has them, cannot fail because of the configuration.

export interface Bindings {
    linux: string;
    dt_schema: string;
}

export interface Tools {
    dtc: string;
    dt_mk_schema: string;
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
    /** Compiled overlay, derived from the overlay path. */
    dtbo: string;
}

export interface Resources {
    bindings: Bindings;
    tools: Tools;
    base: BaseTree;
    overlay: Workfile;
    deploy: DeployTarget;
}

export type Need = keyof Resources;
export type Workspace<N extends Need> = { settings: Settings } & Pick<Resources, N>;

const BUNDLE_HINT = "The attach-linux installation is incomplete; rebuild it (scripts/bundle-dt-schema.sh).";

/** Derive the compiled artifact path from the overlay source path. */
export function derive_dtbo_path(overlay: string): string {
    return overlay.endsWith(".dtso") ? `${overlay.slice(0, -".dtso".length)}.dtbo` : `${overlay}.dtbo`;
}

function spec_of(key: SettingKey): SettingSpec {
    const spec = setting_spec(key);
    if (spec === undefined) { throw new Error(`No setting spec for ${key}`); }
    return spec;
}

function failures(...results: Result<unknown>[]): ConfigError[] {
    return results.flatMap(result => (result.ok ? [] : result.errors));
}

function fail(error: ConfigError): { ok: false; errors: ConfigError[] } {
    return { ok: false, errors: [error] };
}

function require_setting(settings: Settings, key: SettingKey): Result<string> {
    const spec = spec_of(key);
    const value = settings[spec.field];
    if (value !== undefined) { return { ok: true, value }; }
    const message = spec.env === undefined ? `Missing config field ${spec.key}` : `Missing environment variable ${spec.env}`;
    return fail({ field: spec.key, kind: "missing", message, description: spec.description, hint: spec.hint });
}

function require_path(settings: Settings, key: SettingKey, kind: "file" | "directory"): Result<string> {
    const value = require_setting(settings, key);
    if (!value.ok) { return value; }
    const stat = fs.statSync(value.value, { throwIfNoEntry: false });
    if (stat === undefined) { return fail(invalid_setting(spec_of(key), `${value.value} does not exist`)); }
    if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
        return fail(invalid_setting(spec_of(key), `${value.value} is not a ${kind}`));
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

export function parse_linux(settings: Settings): Result<string> {
    const linux = require_path(settings, "linux", "directory");
    if (!linux.ok) { return linux; }
    const problem = linux_tree_problem(linux.value);
    return problem === undefined ? linux : fail(invalid_setting(spec_of("linux"), problem));
}

export function parse_dt_schema(): Result<string> {
    const root = getBundledDtSchemaPath();
    const complete = ["schemas", "meta-schemas"].every(directory => fs.existsSync(path.join(root, "dtschema", directory)));
    if (!complete) {
        return fail({ field: "dt-schema", kind: "missing", message: `Bundled dt-schema not found at ${root}`, hint: BUNDLE_HINT });
    }
    return { ok: true, value: root };
}

export function parse_bindings(settings: Settings, linux_tree: () => Result<string> = () => parse_linux(settings)): Result<Bindings> {
    const linux = linux_tree();
    const dt_schema = parse_dt_schema();
    if (!linux.ok || !dt_schema.ok) { return { ok: false, errors: failures(linux, dt_schema) }; }
    return { ok: true, value: { linux: linux.value, dt_schema: dt_schema.value } };
}

export function parse_tools(): Result<Tools> {
    const directory = getBundledToolsPath();
    const tools: Tools = {
        dtc: path.join(directory, "dtc"),
        dt_mk_schema: path.join(directory, "dt-mk-schema"),
        dt_validate: path.join(directory, "dt-validate"),
    };
    const missing = Object.values(tools).filter(tool => !fs.existsSync(tool));
    if (missing.length > 0) {
        return fail({ field: "tools", kind: "missing", message: `Bundled tools not found: ${missing.join(", ")}`, hint: BUNDLE_HINT });
    }
    return { ok: true, value: tools };
}

/**
 * Preprocess the base DTS with `preprocess-command` into
 * `.attach-linux/preprocessed.dts` and parse it. Cheap enough to run on every
 * invocation, which avoids staleness problems.
 */
export function parse_base(settings: Settings, linux: () => Result<string>, cwd = process.cwd()): Result<BaseTree> {
    const source = require_path(settings, "devicetree", "file");
    const command = settings.preprocess_command;
    const linux_result = command.includes("{linux}") ? linux() : undefined;
    if (!source.ok || linux_result?.ok === false) {
        return { ok: false, errors: failures(source, ...(linux_result === undefined ? [] : [linux_result])) };
    }

    const tool = command.trim().split(/\s+/)[0] ?? "";
    if (!is_tool_available(`${tool} --version`)) {
        return fail(invalid_setting(spec_of("preprocess-command"), `${tool} not found on PATH (needed to preprocess ${source.value})`));
    }

    fs.mkdirSync(config_directory(cwd), { recursive: true });
    const preprocessed = path.join(config_directory(cwd), "preprocessed.dts");
    try {
        execSync(
            substitute_command(command, {
                input: source.value,
                output: preprocessed,
                ...(linux_result === undefined ? {} : { linux: linux_result.value }),
            }),
            { stdio: "pipe" },
        );
    } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim() ?? String(error);
        return fail(invalid_setting(spec_of("devicetree"), `preprocessing ${source.value} failed:\n${stderr}`));
    }

    const tree = DeviceTree.new_from_string(fs.readFileSync(preprocessed, "utf8"));
    if (typeof tree === "string") {
        return fail(invalid_setting(spec_of("devicetree"), `${source.value} does not parse after preprocessing: ${tree}`));
    }
    return { ok: true, value: { source: source.value, preprocessed, tree } };
}

export function open_workfile(file: string, tree: DeviceTreeOverlay, syntax: OverlaySyntax): Workfile {
    const print = (): string => tree.print({ syntax });
    return { path: file, tree, syntax, print, save: () => { fs.writeFileSync(file, print()); } };
}

/** Parse the configured overlay against an already parsed base tree. */
export function parse_overlay(settings: Settings, base: BaseTree): Result<Workfile> {
    const file = require_path(settings, "overlay", "file");
    if (!file.ok) { return file; }
    const tree = DeviceTreeOverlay.new_from_string(fs.readFileSync(file.value, "utf8"), base.tree);
    if (typeof tree === "string") {
        return fail(invalid_setting(spec_of("overlay"), `${file.value} does not parse: ${tree}`));
    }
    return { ok: true, value: open_workfile(file.value, tree, settings.overlay_syntax) };
}

function parse_deploy(settings: Settings): Result<DeployTarget> {
    const host = require_setting(settings, "deploy-ip");
    const user = require_setting(settings, "deploy-user");
    const password = require_setting(settings, "deploy-password");
    const overlay = require_setting(settings, "overlay");
    if (!host.ok || !user.ok || !password.ok || !overlay.ok) {
        return { ok: false, errors: failures(host, user, password, overlay) };
    }

    const dtbo = derive_dtbo_path(overlay.value);
    if (!fs.existsSync(dtbo)) {
        return fail({ field: "overlay", kind: "missing", message: `Compiled overlay ${dtbo} not found`, hint: "Run 'build' first." });
    }

    const missing = ["scp", "sshpass"].filter(tool => !is_tool_available(`which ${tool}`));
    if (missing.length > 0) {
        return fail({ field: "deploy", kind: "missing", message: `${missing.join(", ")} not found on PATH (needed to deploy)` });
    }

    return { ok: true, value: { host: host.value, user: user.value, password: password.value, dtbo } };
}

/**
 * Build the resources in `needs` (and what they depend on) from `settings`.
 * Errors from independent resources are all collected; a resource whose
 * dependency failed reports only its own setting problems on top.
 */
export function open_workspace<N extends Need>(settings: Settings, needs: readonly N[], cwd = process.cwd()): Result<Workspace<N>> {
    let linux_result: Result<string> | undefined;
    let base_result: Result<BaseTree> | undefined;
    const linux = (): Result<string> => (linux_result ??= parse_linux(settings));
    const base = (): Result<BaseTree> => (base_result ??= parse_base(settings, linux, cwd));

    const parsers: { [K in Need]: () => Result<Resources[K]> } = {
        bindings: () => parse_bindings(settings, linux),
        tools: parse_tools,
        base,
        overlay: () => {
            const base_value = base();
            if (!base_value.ok) { return { ok: false, errors: [...base_value.errors, ...failures(require_path(settings, "overlay", "file"))] }; }
            return parse_overlay(settings, base_value.value);
        },
        deploy: () => parse_deploy(settings),
    };

    const workspace: Record<string, unknown> = { settings };
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

export function format_config_errors(errors: readonly ConfigError[]): { human: string; json: string } {
    const hints = [...new Set(errors.map(error => error.hint).filter((hint): hint is string => hint !== undefined))];
    const lines = errors.map(error => (error.description === undefined ? error.message : `${error.message} — ${error.description}`));
    const body = lines.length === 1 ? lines[0]! : ["Configuration errors:", ...lines.map(line => `  ${line}`)].join("\n");
    const human = hints.length > 0 ? `${body}\n\n${hints.join("\n")}` : body;
    const json = JSON.stringify({
        errors: errors.map(({ field, kind, message, description }) => ({ field, kind, message, description })),
        hints,
    });
    return { human, json };
}

export function report_config_errors(context: LocalContext, errors: readonly ConfigError[]): void {
    const message = format_config_errors(errors);
    if (context.json) { input_error(message.json); } else { console.log(message.human); }
}

/**
 * Read the settings and build the resources a command needs. On any problem
 * the errors are reported (exit code 2 in JSON mode) and undefined is returned.
 */
export function load_workspace<N extends Need>(context: LocalContext, needs: readonly N[]): Workspace<N> | undefined {
    const settings = read_settings();
    const workspace = settings.ok ? open_workspace(settings.value, needs) : settings;
    if (!workspace.ok) {
        report_config_errors(context, workspace.errors);
        return undefined;
    }
    return workspace.value;
}

if (import.meta.vitest) {
    const { test, expect, beforeAll, afterAll } = import.meta.vitest;
    const os = await import("node:os");
    const { parse_settings } = await import("./settings");

    let root: string;
    let linux: string;
    let workspace_directory: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "attach-ws-"));
        linux = path.join(root, "linux");
        workspace_directory = path.join(root, "workspace");
        fs.mkdirSync(path.join(linux, "Documentation", "devicetree", "bindings"), { recursive: true });
        fs.mkdirSync(path.join(linux, "include", "dt-bindings", "gpio"), { recursive: true });
        fs.writeFileSync(path.join(linux, "include", "dt-bindings", "gpio", "gpio.h"), "#define GPIO_ACTIVE_LOW 1\n");
        fs.mkdirSync(workspace_directory);
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

    const settings_for = (toml: string, environment: Record<string, string>): Settings => {
        const result = parse_settings(toml, environment, root);
        if (!result.ok) { throw new Error(JSON.stringify(result.errors)); }
        return result.value;
    };

    const open = <N extends Need>(toml: string, environment: Record<string, string>, needs: readonly N[]): Result<Workspace<N>> =>
        open_workspace(settings_for(toml, environment), needs, workspace_directory);

    const fields = (result: Result<unknown>): string[] => (result.ok ? [] : result.errors.map(error => error.field));

    test("open_workspace - preprocesses #include and parses base and overlay", () => {
        const result = open(`overlay = "overlay.dtso"`, { ATTACH_LINUX: linux, ATTACH_DEVICETREE: "base.dts" }, ["base", "overlay"]);
        expect(result.ok).toBe(true);
        if (!result.ok) { return; }
        expect(result.value.base.preprocessed).toBe(path.join(workspace_directory, ".attach-linux", "preprocessed.dts"));
        expect(result.value.base.tree.node_exists("spi0")).toBe(true);
        expect(result.value.overlay.print()).toContain("adc@0");
    });

    test("open_workspace - independent missing settings are all reported", () => {
        const result = open("", {}, ["base", "overlay"]);
        expect(fields(result)).toEqual(["devicetree", "linux", "overlay"]);
    });

    test("open_workspace - a shared dependency is reported once", () => {
        const result = open("", { ATTACH_DEVICETREE: "base.dts" }, ["base", "overlay"]);
        expect(fields(result)).toEqual(["linux", "overlay"]);
    });

    test("open_workspace - linux without include/ is rejected", () => {
        const fake = path.join(root, "not-linux");
        fs.mkdirSync(path.join(fake, "Documentation", "devicetree", "bindings"), { recursive: true });
        const result = open("", { ATTACH_LINUX: fake, ATTACH_DEVICETREE: "base.dts" }, ["base"]);
        expect(result.ok).toBe(false);
        if (result.ok) { return; }
        expect(result.errors[0]!.message).toContain("no include/");
    });

    test("open_workspace - a preprocessing failure is a hard error", () => {
        const result = open("", { ATTACH_LINUX: linux, ATTACH_DEVICETREE: "broken.dts" }, ["base"]);
        expect(result.ok).toBe(false);
        if (result.ok) { return; }
        expect(result.errors[0]!.message).toContain("preprocessing");
    });

    test("open_workspace - an overlay that does not parse is a config error", () => {
        const result = open(`overlay = "bad.dtso"`, { ATTACH_LINUX: linux, ATTACH_DEVICETREE: "base.dts" }, ["overlay"]);
        expect(fields(result)).toEqual(["overlay"]);
    });

    test("open_workspace - a missing overlay file is reported", () => {
        const result = open(`overlay = "nope.dtso"`, { ATTACH_LINUX: linux, ATTACH_DEVICETREE: "base.dts" }, ["overlay"]);
        expect(result.ok).toBe(false);
        if (result.ok) { return; }
        expect(result.errors[0]!.message).toContain("does not exist");
    });

    test("open_workspace - deploy needs every deploy field", () => {
        const result = open(`deploy-ip = "10.0.0.1"`, {}, ["deploy"]);
        expect(fields(result)).toEqual(["deploy-user", "deploy-password", "overlay"]);
    });

    test("format_config_errors - single error includes description and hint", () => {
        const result = open("", {}, ["base"]);
        if (result.ok) { throw new Error("expected errors"); }
        const message = format_config_errors(result.errors.slice(0, 1));
        expect(message.human).toContain("ATTACH_DEVICETREE");
        expect(message.human).toContain("base DTS file");
        expect(message.human).toContain("attach-linux");
    });

    test("format_config_errors - shared hints are printed once", () => {
        const result = open("", {}, ["base"]);
        if (result.ok) { throw new Error("expected errors"); }
        const message = format_config_errors(result.errors);
        expect(message.human).toContain("ATTACH_LINUX");
        expect(message.human).toContain("ATTACH_DEVICETREE");
        expect(message.human.split("Run 'attach-linux'").length - 1).toBe(1);
        expect(JSON.parse(message.json).errors).toHaveLength(2);
    });
}
