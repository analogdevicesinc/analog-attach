import * as fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "smol-toml";

// Mirrors kbuild's dtc_cpp_flags; {linux} is the configured Linux tree.
export const DEFAULT_PREPROCESS_COMMAND = "cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}";

export const OVERLAY_SYNTAXES = ["fragment", "label"] as const;
export type OverlaySyntax = typeof OVERLAY_SYNTAXES[number];

/** The user's settings: env vars and config.toml, shape-checked, defaults applied. Paths are absolute. */
export interface Settings {
    linux?: string;
    devicetree?: string;
    overlay?: string;
    overlay_syntax: OverlaySyntax;
    preprocess_command: string;
    deploy_ip?: string;
    deploy_user?: string;
    deploy_password?: string;
}

export type EnvironmentKey = "linux" | "devicetree";
export type TomlKey = "overlay" | "overlay-syntax" | "preprocess-command" | "deploy-ip" | "deploy-user" | "deploy-password";
export type SettingKey = EnvironmentKey | TomlKey;

export interface SettingSpec {
    /** kebab-case name, as written in config.toml and accepted by config-set / config-get. */
    key: SettingKey;
    field: keyof Settings;
    /** Environment variable the value is read from; config.toml must not carry it. */
    env?: string;
    kind: "path" | "string" | { options: readonly string[] };
    description: string;
    /** Display metadata for config-get; what a command needs is decided by `load_workspace`. */
    required: boolean;
    default?: string;
    /** Printed when the setting is missing or invalid. */
    hint?: string;
}

export const SETUP_HINT = "Run 'attach-linux' to set up a workspace interactively.";

export const SETTINGS: readonly SettingSpec[] = [
    {
        key: "linux",
        field: "linux",
        env: "ATTACH_LINUX",
        kind: "path",
        required: true,
        description: "Path to Linux kernel source tree (set via $ATTACH_LINUX)",
        hint: SETUP_HINT,
    },
    {
        key: "devicetree",
        field: "devicetree",
        env: "ATTACH_DEVICETREE",
        kind: "path",
        required: true,
        description: "Path to target base DTS file (set via $ATTACH_DEVICETREE)",
        hint: SETUP_HINT,
    },
    {
        key: "overlay",
        field: "overlay",
        kind: "path",
        required: false,
        description: "Path to the working DTSO overlay file (workfile)",
        hint: "Run 'create-workfile' to create one, or 'config-set overlay <path>'.",
    },
    {
        key: "overlay-syntax",
        field: "overlay_syntax",
        kind: { options: OVERLAY_SYNTAXES },
        required: false,
        default: "fragment",
        description: "Output syntax for the overlay file: fragment (default) or label (&spi0 { … })",
    },
    {
        key: "preprocess-command",
        field: "preprocess_command",
        kind: "string",
        required: false,
        default: DEFAULT_PREPROCESS_COMMAND,
        description: "C preprocessor command to resolve macros in the base devicetree; {input}/{output}/{linux} are substituted",
    },
    {
        key: "deploy-ip",
        field: "deploy_ip",
        kind: "string",
        required: false,
        description: "IP address or hostname of the remote device to deploy to",
    },
    {
        key: "deploy-user",
        field: "deploy_user",
        kind: "string",
        required: false,
        description: "SSH username on the remote device",
    },
    {
        key: "deploy-password",
        field: "deploy_password",
        kind: "string",
        required: false,
        description: "SSH password on the remote device (stored plaintext in config.toml)",
    },
];

/** Settings stored in config.toml (everything not read from the environment). */
export const TOML_SETTINGS: readonly SettingSpec[] = SETTINGS.filter(spec => spec.env === undefined);

export function setting_spec(key: string): SettingSpec | undefined {
    return SETTINGS.find(spec => spec.key === key);
}

/** How a setting is named in messages: its env var, or its config.toml key. */
export function setting_label(spec: SettingSpec): string {
    return spec.env ?? spec.key;
}

export interface ConfigError {
    /** Setting key (e.g. `linux`, `overlay`) or resource name (e.g. `dt-schema`). */
    field: string;
    kind: "missing" | "invalid" | "unknown";
    message: string;
    description?: string;
    hint?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };

export function config_directory(cwd = process.cwd()): string {
    return path.join(cwd, ".attach-linux");
}

function config_path(cwd = process.cwd()): string {
    return path.join(config_directory(cwd), "config.toml");
}

/** An `invalid` error for a setting, carrying its description and hint. */
export function invalid_setting(spec: SettingSpec, problem: string): ConfigError {
    return { field: spec.key, kind: "invalid", message: `${setting_label(spec)}: ${problem}`, description: spec.description, hint: spec.hint };
}

function parse_setting_value(spec: SettingSpec, raw: string, cwd: string): string | ConfigError {
    if (raw === "") { return invalid_setting(spec, "must not be empty"); }
    if (spec.kind === "path") { return path.resolve(cwd, raw); }
    if (spec.kind === "string") { return raw; }
    if (!spec.kind.options.includes(raw)) {
        return invalid_setting(spec, `${JSON.stringify(raw)} is not one of ${spec.kind.options.join(" | ")}`);
    }
    return raw;
}

/**
 * Parse config.toml text (undefined when there is no file) and the environment
 * into `Settings`. Strict: a TOML syntax error, an unknown key, a non-string
 * value, an env-sourced key written in TOML, or a value outside a field's
 * options is an error. An empty env var counts as unset.
 */
export function parse_settings(
    toml_text: string | undefined,
    environment: Record<string, string | undefined>,
    cwd = process.cwd(),
): Result<Settings> {
    let table: Record<string, unknown> = {};
    if (toml_text !== undefined) {
        try {
            table = parse(toml_text);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, errors: [{ field: "config.toml", kind: "invalid", message: `.attach-linux/config.toml: ${message}` }] };
        }
    }

    const errors: ConfigError[] = [];
    const settings: Settings = { overlay_syntax: "fragment", preprocess_command: DEFAULT_PREPROCESS_COMMAND };
    const values = settings as unknown as Record<string, string | undefined>;

    for (const [key, raw] of Object.entries(table)) {
        const spec = setting_spec(key);
        if (spec === undefined) {
            errors.push({
                field: key,
                kind: "unknown",
                message: `.attach-linux/config.toml: unknown key ${key}`,
                hint: `Remove unknown keys from .attach-linux/config.toml; valid keys are ${TOML_SETTINGS.map(s => s.key).join(", ")}.`,
            });
        } else if (spec.env !== undefined) {
            errors.push({
                field: key,
                kind: "invalid",
                message: `.attach-linux/config.toml: ${key} is read from $${spec.env}, not config.toml`,
                hint: `Remove it from config.toml and export ${spec.env}=${JSON.stringify(raw)}`,
            });
        } else if (typeof raw === "string") {
            const value = parse_setting_value(spec, raw, cwd);
            if (typeof value === "string") { values[spec.field] = value; } else { errors.push(value); }
        } else {
            errors.push(invalid_setting(spec, "must be a string"));
        }
    }

    for (const spec of SETTINGS) {
        if (spec.env === undefined) { continue; }
        const raw = environment[spec.env];
        if (raw === undefined || raw === "") { continue; }
        const value = parse_setting_value(spec, raw, cwd);
        if (typeof value === "string") { values[spec.field] = value; } else { errors.push(value); }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: settings };
}

export function read_config_file(cwd = process.cwd()): string | undefined {
    const file = config_path(cwd);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/** Read the settings of the workspace in `cwd` from config.toml and `process.env`. */
export function read_settings(cwd = process.cwd()): Result<Settings> {
    return parse_settings(read_config_file(cwd), process.env, cwd);
}

/**
 * Write `patch` on top of the current config.toml. Settings are written in
 * registry order; any other key already in the file is kept as is, so it is
 * still reported by the next load rather than dropped silently. Throws when
 * the current file is not valid TOML (callers have read the settings first).
 */
export function save_settings(patch: Partial<Record<TomlKey, string>>, cwd = process.cwd()): void {
    const text = read_config_file(cwd);
    const merged: Record<string, unknown> = { ...(text === undefined ? {} : parse(text)), ...patch };

    const ordered: Record<string, unknown> = {};
    for (const spec of TOML_SETTINGS) {
        if (merged[spec.key] !== undefined) { ordered[spec.key] = merged[spec.key]; }
    }
    for (const [key, value] of Object.entries(merged)) {
        if (!(key in ordered)) { ordered[key] = value; }
    }

    fs.mkdirSync(config_directory(cwd), { recursive: true });
    fs.writeFileSync(config_path(cwd), stringify(ordered));
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    const errors_of = (result: Result<Settings>): ConfigError[] => (result.ok ? [] : result.errors);

    test("SETTINGS - keys and fields are unique", () => {
        expect(new Set(SETTINGS.map(s => s.key)).size).toBe(SETTINGS.length);
        expect(new Set(SETTINGS.map(s => s.field)).size).toBe(SETTINGS.length);
    });

    test("parse_settings - defaults apply with no file and no env", () => {
        const result = parse_settings(undefined, {});
        expect(result).toEqual({ ok: true, value: { overlay_syntax: "fragment", preprocess_command: DEFAULT_PREPROCESS_COMMAND } });
    });

    test("parse_settings - paths resolve against cwd", () => {
        const result = parse_settings(`overlay = "o.dtso"`, { ATTACH_DEVICETREE: "../x.dts" }, "/w/s");
        expect(result.ok && result.value.overlay).toBe("/w/s/o.dtso");
        expect(result.ok && result.value.devicetree).toBe("/w/x.dts");
    });

    test("parse_settings - empty env counts as unset", () => {
        const result = parse_settings(undefined, { ATTACH_LINUX: "" });
        expect(result.ok && result.value.linux).toBeUndefined();
    });

    test("parse_settings - unknown key is an error", () => {
        const errors = errors_of(parse_settings(`validation-json = "/x"`, {}));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.kind).toBe("unknown");
        expect(errors[0]!.field).toBe("validation-json");
    });

    test("parse_settings - env key in TOML is an error with an export hint", () => {
        const errors = errors_of(parse_settings(`linux = "/old"`, { ATTACH_LINUX: "/new" }));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.hint).toContain(`export ATTACH_LINUX="/old"`);
    });

    test("parse_settings - value outside the options is an error", () => {
        const errors = errors_of(parse_settings(`overlay-syntax = "bar"`, {}));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toContain("fragment | label");
    });

    test("parse_settings - non-string and empty values are errors", () => {
        const errors = errors_of(parse_settings(`deploy-ip = 10\ndeploy-user = ""`, {}));
        expect(errors.map(error => error.field)).toEqual(["deploy-ip", "deploy-user"]);
    });

    test("parse_settings - TOML syntax error is reported", () => {
        const errors = errors_of(parse_settings(`overlay = `, {}));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.field).toBe("config.toml");
    });

    test("save_settings - merges into the file and round-trips", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-cfg-"));
        try {
            save_settings({ "overlay-syntax": "label" }, directory);
            save_settings({ overlay: "a.dtso" }, directory);
            expect(read_config_file(directory)).toBe(`overlay = "a.dtso"\noverlay-syntax = "label"\n`);
            const result = parse_settings(read_config_file(directory), {}, directory);
            expect(result.ok && result.value.overlay).toBe(path.join(directory, "a.dtso"));
            expect(result.ok && result.value.overlay_syntax).toBe("label");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("save_settings - keeps unknown keys so the next load still reports them", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-cfg-"));
        try {
            fs.mkdirSync(config_directory(directory));
            fs.writeFileSync(config_path(directory), `validation-json = "/x"\n`);
            save_settings({ overlay: "a.dtso" }, directory);
            const errors = errors_of(parse_settings(read_config_file(directory), {}, directory));
            expect(errors.map(error => error.field)).toEqual(["validation-json"]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
