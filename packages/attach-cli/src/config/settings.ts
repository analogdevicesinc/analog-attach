import * as fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "smol-toml";

// Mirrors kbuild's dtc_cpp_flags; {linux} is the configured Linux tree.
export const DEFAULT_PREPROCESS_COMMAND = "cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}";

export const OVERLAY_SYNTAXES = ["fragment", "label"] as const;
export type OverlaySyntax = typeof OVERLAY_SYNTAXES[number];

/** The user's settings from config.toml, shape-checked, defaults applied. Paths are absolute. */
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

export type SettingKey = "linux" | "devicetree" | "overlay" | "overlay-syntax" | "preprocess-command" | "deploy-ip" | "deploy-user" | "deploy-password";

export interface SettingSpec {
    /** kebab-case name, as written in config.toml and accepted by `config`. */
    key: SettingKey;
    field: keyof Settings;
    kind: "path" | "string" | { options: readonly string[] };
    description: string;
    /** Display metadata for `config`; what a command needs is decided by `load_workspace`. */
    required: boolean;
    default?: string;
    /** Printed when the setting is missing or invalid. */
    hint?: string;
}

export const SETUP_HINT = "Run 'attach-linux init' on a terminal, or 'attach-linux init --linux <path> --devicetree <path>', to set up a workspace.";

export const SETTINGS: readonly SettingSpec[] = [
    {
        key: "linux",
        field: "linux",
        kind: "path",
        required: true,
        description: "Path to Linux kernel source tree (setting it builds the binding caches)",
        hint: SETUP_HINT,
    },
    {
        key: "devicetree",
        field: "devicetree",
        kind: "path",
        required: true,
        description: "Path to target base DTS file",
        hint: SETUP_HINT,
    },
    {
        key: "overlay",
        field: "overlay",
        kind: "path",
        required: false,
        description: "Path to the working DTSO overlay file (workfile)",
        hint: "Run 'attach-linux init' to create one, or 'config overlay <path>'.",
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

export function setting_spec(key: string): SettingSpec | undefined {
    return SETTINGS.find(spec => spec.key === key);
}

export interface ConfigError {
    /** Setting key (e.g. `linux`, `overlay`) or resource name (e.g. `dt-schema`). */
    field: string;
    kind: "missing" | "invalid" | "unknown";
    message: string;
    description?: string;
    hint?: string;
}

export type ConfigResult<T> = { ok: true; value: T } | { ok: false; errors: ConfigError[] };

export function config_directory(cwd = process.cwd()): string {
    return path.join(cwd, ".attach-linux");
}

function config_path(cwd = process.cwd()): string {
    return path.join(config_directory(cwd), "config.toml");
}

/** An `invalid` error for a setting, carrying its description and hint. */
export function invalid_setting(spec: SettingSpec, problem: string): ConfigError {
    return { field: spec.key, kind: "invalid", message: `${spec.key}: ${problem}`, description: spec.description, hint: spec.hint };
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
 * Parse config.toml text (undefined when there is no file) into `Settings`.
 * Strict: a TOML syntax error, an unknown key, a non-string value, or a value
 * outside a field's options is an error.
 */
export function parse_settings(toml_text?: string, cwd = process.cwd()): ConfigResult<Settings> {
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
                hint: `Remove unknown keys from .attach-linux/config.toml; valid keys are ${SETTINGS.map(s => s.key).join(", ")}.`,
            });
        } else if (typeof raw === "string") {
            const value = parse_setting_value(spec, raw, cwd);
            if (typeof value === "string") { values[spec.field] = value; } else { errors.push(value); }
        } else {
            errors.push(invalid_setting(spec, "must be a string"));
        }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, value: settings };
}

export function read_config_file(cwd = process.cwd()): string | undefined {
    const file = config_path(cwd);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/** Read the settings of the workspace in `cwd` from its config.toml. */
export function read_settings(cwd = process.cwd()): ConfigResult<Settings> {
    return parse_settings(read_config_file(cwd), cwd);
}

/**
 * Write `patch` on top of the current config.toml. Settings are written in
 * registry order; any other key already in the file is kept as is, so it is
 * still reported by the next load rather than dropped silently. Throws when
 * the current file is not valid TOML (callers have read the settings first).
 */
export function save_settings(patch: Partial<Record<SettingKey, string>>, cwd = process.cwd()): void {
    const text = read_config_file(cwd);
    write_config({ ...(text === undefined ? {} : parse(text)), ...patch }, cwd);
}

/**
 * Remove `key` from config.toml, so it is back to its default or unset. The
 * other keys are kept as `save_settings` keeps them. With no file, nothing
 * is written. Throws when the file is not valid TOML.
 */
export function reset_setting(key: SettingKey, cwd = process.cwd()): void {
    const text = read_config_file(cwd);
    if (text === undefined) { return; }
    const table: Record<string, unknown> = parse(text);
    delete table[key];
    write_config(table, cwd);
}

function write_config(merged: Record<string, unknown>, cwd: string): void {
    const ordered: Record<string, unknown> = {};
    for (const spec of SETTINGS) {
        if (merged[spec.key] !== undefined) { ordered[spec.key] = merged[spec.key]; }
    }
    for (const [key, value] of Object.entries(merged)) {
        if (!(key in ordered)) { ordered[key] = value; }
    }

    fs.mkdirSync(config_directory(cwd), { recursive: true });
    fs.writeFileSync(config_path(cwd), stringify(ordered));
}

if (import.meta.vitest) {
    const { test, expect, vi } = import.meta.vitest;
    const os = await import("node:os");

    const errors_of = (result: ConfigResult<Settings>): ConfigError[] => (result.ok ? [] : result.errors);

    test("SETTINGS - keys and fields are unique", () => {
        expect(new Set(SETTINGS.map(s => s.key)).size).toBe(SETTINGS.length);
        expect(new Set(SETTINGS.map(s => s.field)).size).toBe(SETTINGS.length);
    });

    test("parse_settings - defaults apply with no file and no env", () => {
        const result = parse_settings();
        expect(result).toEqual({ ok: true, value: { overlay_syntax: "fragment", preprocess_command: DEFAULT_PREPROCESS_COMMAND } });
    });

    test("parse_settings - paths resolve against cwd", () => {
        const result = parse_settings(`overlay = "o.dtso"\ndevicetree = "../x.dts"`, "/w/s");
        expect(result.ok && result.value.overlay).toBe("/w/s/o.dtso");
        expect(result.ok && result.value.devicetree).toBe("/w/x.dts");
    });

    test("parse_settings - linux and devicetree are read from config.toml, not the environment", () => {
        vi.stubEnv("ATTACH_LINUX", "/from/env");
        try {
            const result = parse_settings(`linux = "/l"\ndevicetree = "d.dts"`, "/w");
            expect(result.ok && result.value.linux).toBe("/l");
            expect(result.ok && result.value.devicetree).toBe("/w/d.dts");
            const unset = parse_settings();
            expect(unset.ok && unset.value.linux).toBeUndefined();
        } finally {
            vi.unstubAllEnvs();
        }
    });

    test("parse_settings - unknown key is an error", () => {
        const errors = errors_of(parse_settings(`validation-json = "/x"`));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.kind).toBe("unknown");
        expect(errors[0]!.field).toBe("validation-json");
    });

    test("parse_settings - value outside the options is an error", () => {
        const errors = errors_of(parse_settings(`overlay-syntax = "bar"`));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toContain("fragment | label");
    });

    test("parse_settings - non-string and empty values are errors", () => {
        const errors = errors_of(parse_settings(`deploy-ip = 10\ndeploy-user = ""`));
        expect(errors.map(error => error.field)).toEqual(["deploy-ip", "deploy-user"]);
    });

    test("parse_settings - TOML syntax error is reported", () => {
        const errors = errors_of(parse_settings(`overlay = `));
        expect(errors).toHaveLength(1);
        expect(errors[0]!.field).toBe("config.toml");
    });

    test("save_settings - merges into the file and round-trips", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-cfg-"));
        try {
            save_settings({ "overlay-syntax": "label" }, directory);
            save_settings({ overlay: "a.dtso" }, directory);
            expect(read_config_file(directory)).toBe(`overlay = "a.dtso"\noverlay-syntax = "label"\n`);
            const result = parse_settings(read_config_file(directory), directory);
            expect(result.ok && result.value.overlay).toBe(path.join(directory, "a.dtso"));
            expect(result.ok && result.value.overlay_syntax).toBe("label");
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });

    test("reset_setting - removes the key and keeps the others, unknown ones included", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attach-cfg-"));
        try {
            reset_setting("overlay", directory);
            expect(read_config_file(directory)).toBeUndefined();
            fs.mkdirSync(config_directory(directory));
            fs.writeFileSync(config_path(directory), `overlay = "a.dtso"\noverlay-syntax = "label"\nbogus = "x"\n`);
            reset_setting("overlay-syntax", directory);
            expect(read_config_file(directory)).toBe(`overlay = "a.dtso"\nbogus = "x"\n`);
            reset_setting("deploy-ip", directory);
            expect(read_config_file(directory)).toBe(`overlay = "a.dtso"\nbogus = "x"\n`);
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
            const errors = errors_of(parse_settings(read_config_file(directory), directory));
            expect(errors.map(error => error.field)).toEqual(["validation-json"]);
        } finally {
            fs.rmSync(directory, { recursive: true });
        }
    });
}
