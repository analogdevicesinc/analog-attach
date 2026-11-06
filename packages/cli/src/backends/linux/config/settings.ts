import os from "node:os";
import path from "node:path";

import type { SettingSpec, SettingsView } from "../../../interface/backend-interface";
import type { ErrorType } from "../../../interface/error-types";

// The Linux backend's settings. The front end stores them (JSON, local over global) and
// checks them against these specs; the backend reads them through `session.settings`
// (`read_settings`) and never touches a settings file.

// Mirrors kbuild's dtc_cpp_flags; {linux} is the configured Linux tree.
export const DEFAULT_PREPROCESS_COMMAND = "cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}";

export const OVERLAY_SYNTAXES = ["fragment", "label"] as const;
export type OverlaySyntax = typeof OVERLAY_SYNTAXES[number];

/** What `build` makes of the workfile: a `.dtbo`, or the base with the overlay applied (a `.dts` and its `.dtb`). */
export const OUTPUTS = ["overlay", "full"] as const;
export type Output = typeof OUTPUTS[number];

/** The name hints use when no session is at hand (the specs' static hints): the front end's binary. */
export const DEFAULT_PROGRAM = "analog-attach";

/** The settings, as `session.settings` has them, defaults applied. Paths are absolute. */
export interface Settings {
    linux?: string;
    devicetree?: string;
    workfile?: string;
    overlay_syntax: OverlaySyntax;
    preprocess_command: string;
    deploy_ip?: string;
    deploy_user?: string;
    deploy_password?: string;
    /** Whether `add` and a child's create ask on a terminal (`interview`). */
    interview: boolean;
    /** What `build` makes and `deploy` copies (`output`). */
    output: Output;
    /** Replaces `build`'s dtc step (`build-command`). */
    build_command?: string;
    /** Replaces `deploy`'s copy and reboot (`deploy-command`). */
    deploy_command?: string;
    /** The folder `build` writes its output to and `deploy` takes it from, absolute. */
    build_dir: string;
}

export type SettingKey =
    | "linux" | "devicetree" | "workfile" | "overlay-syntax" | "preprocess-command" | "interview"
    | "output" | "build-command" | "build-dir" | "deploy-command" | "deploy-ip" | "deploy-user" | "deploy-password";

/** The `Settings` field of each key. */
export const SETTING_FIELDS: Readonly<Record<SettingKey, keyof Settings>> = {
    "linux": "linux",
    "devicetree": "devicetree",
    "workfile": "workfile",
    "overlay-syntax": "overlay_syntax",
    "preprocess-command": "preprocess_command",
    "interview": "interview",
    "output": "output",
    "build-command": "build_command",
    "build-dir": "build_dir",
    "deploy-command": "deploy_command",
    "deploy-ip": "deploy_ip",
    "deploy-user": "deploy_user",
    "deploy-password": "deploy_password",
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
        case "deploy-ip": { return `Run '${program} config deploy-ip <address>'.`; }
        case "deploy-user": { return `Run '${program} config deploy-user <user>'.`; }
        case "deploy-password": { return `Run '${program} config deploy-password <password>'.`; }
        default: { return undefined; }
    }
}

/** The hint of a setting that is missing: the setup hint for the workfile, otherwise `setting_hint`. */
export function missing_hint(key: SettingKey, program: string = DEFAULT_PROGRAM): string | undefined {
    return key === "workfile" ? setup_hint(["workfile"], program) : setting_hint(key, program);
}

const WORKSPACE = "Workspace";
const BUILD = "Build";
const DEPLOY = "Deploy";

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
            description: "Output syntax for the overlay file: fragment (default) or label (&spi0 { … })",
        },
        {
            key: "preprocess-command",
            category: WORKSPACE,
            type: "string",
            required: false,
            default: DEFAULT_PREPROCESS_COMMAND,
            description: "C preprocessor command to resolve macros in the base devicetree; {input}/{output}/{linux} are substituted",
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
            description: "What 'build' makes and 'deploy' copies: overlay (default, a .dtbo) or full (the base with the overlay applied, a .dts and its .dtb)",
        },
        {
            key: "build-command",
            category: BUILD,
            type: "string",
            required: false,
            description: "Override the 'build' step with this command, run at the base of the project; {workfile}/{output} are substituted (unset: compile with the bundled dtc)",
        },
        {
            key: "build-dir",
            category: BUILD,
            type: "string",
            required: false,
            default: DEFAULT_BUILD_DIR,
            description: "Folder 'build' writes its output to and 'deploy' takes it from, relative to the project unless absolute",
        },
        {
            key: "deploy-command",
            category: DEPLOY,
            type: "string",
            required: false,
            description: "Override the 'deploy' step with this command, run at the base of the project; {dtbo} is substituted (unset: copy over SSH and reboot)",
        },
        {
            key: "deploy-ip",
            category: DEPLOY,
            type: "string",
            required: false,
            description: "IP address or hostname of the remote device to deploy to",
        },
        {
            key: "deploy-user",
            category: DEPLOY,
            type: "string",
            required: false,
            description: "SSH username on the remote device",
        },
        {
            key: "deploy-password",
            category: DEPLOY,
            type: "string",
            required: false,
            description: "SSH password on the remote device (stored plaintext in the settings file)",
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

/** The settings as the session has them. The front end has checked their types and options and made paths absolute. */
export function read_settings(view: Pick<SettingsView, "get">): Settings {
    const settings: Settings = {
        overlay_syntax: (view.get("overlay-syntax") ?? "fragment") as OverlaySyntax,
        preprocess_command: view.get("preprocess-command") ?? DEFAULT_PREPROCESS_COMMAND,
        interview: view.get("interview") !== "false",
        output: (view.get("output") ?? "overlay") as Output,
        build_dir: view.get("build-dir") ?? DEFAULT_BUILD_DIR,
    };
    const values = settings as unknown as Record<string, string | undefined>;
    for (const key of ["linux", "devicetree", "workfile", "build-command", "deploy-command", "deploy-ip", "deploy-user", "deploy-password"] as const) {
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

    test("missing_hint — the deploy settings say their config command; the other optional ones have none", () => {
        expect(missing_hint("deploy-ip", "aa")).toBe("Run 'aa config deploy-ip <address>'.");
        expect(missing_hint("deploy-user", "aa")).toBe("Run 'aa config deploy-user <user>'.");
        expect(missing_hint("deploy-password", "aa")).toBe("Run 'aa config deploy-password <password>'.");
        expect(missing_hint("overlay-syntax", "aa")).toBeUndefined();
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
