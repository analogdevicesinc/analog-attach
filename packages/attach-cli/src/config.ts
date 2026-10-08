import * as fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { DeviceTree, type BoardDescription } from "attach-lib";

import { load_board } from "./board";
import { getBundledDtSchemaPath } from "./commands/skill/utilities";

export const DEFAULT_BUILD_COMMAND = "dtc -@ -I dts -O dtb -o {output} {input}";
// Mirrors kbuild's dtc_cpp_flags; {linux} is the configured Linux tree.
export const DEFAULT_PREPROCESS_COMMAND = "cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}";

export interface AttachConfig {
    linux?: string;
    dtSchema?: string;
    context?: string;
    overlay?: string;
    board?: string;
    validationJson?: string;
    buildCommand?: string;
    preprocessCommand?: string;
    overlayCompiled?: string;
    deployIp?: string;
    deployUser?: string;
    deployPassword?: string;
}

// Single source of truth for every config field. load_config/save_config,
// config-set (settable fields + on-set validation) and config-get (display
// metadata) all derive from this — adding a field means editing this array.
export interface FieldSpec {
    /** kebab-case key as written in config.toml and accepted by config-set. */
    toml: string;
    /** camelCase property on AttachConfig. */
    key: keyof AttachConfig;
    description: string;
    /** "path" fields are existence-checked by check_config; "string" fields are presence-only. */
    type: "path" | "string";
    /** Whether the field is generally required (display metadata for config-get). */
    required: boolean;
    default?: string;
    /** Internal fields are load/save-able but not exposed by config-set or config-get. */
    internal?: boolean;
    /** Environment variable name. When set, the value comes from `process.env` and config.toml is ignored. */
    env?: string;
    /** Fallback function called when `env` is unset (e.g. bundled dt-schema). */
    fallback?: () => string | undefined;
    /** Allowed values — config-set validates against these. */
    options?: readonly string[];
    validate?: (value: string) => string | undefined;
    parse?: (value: string) => unknown | string;
}

export const CONFIG_REGISTRY: readonly FieldSpec[] = [
    {
        toml: "linux",
        key: "linux",
        type: "path",
        required: true,
        env: "ATTACH_LINUX",
        description: "Path to Linux kernel source tree",
        validate: (value) =>
            fs.existsSync(path.join(value, "Documentation", "devicetree", "bindings"))
                ? undefined
                : `no Documentation/devicetree/bindings under ${value}`,
    },
    {
        toml: "dt-schema",
        key: "dtSchema",
        type: "path",
        required: true,
        env: "ATTACH_DT_SCHEMA",
        fallback: () => {
            const bundled = getBundledDtSchemaPath();
            return fs.existsSync(path.join(bundled, "dtschema", "schemas")) ? bundled : undefined;
        },
        description: "Path to dt-schema repository",
        validate: (value) =>
            fs.existsSync(path.join(value, "dtschema", "schemas"))
                ? undefined
                : `no dtschema/schemas under ${value}`,
    },
    {
        toml: "context",
        key: "context",
        type: "path",
        required: true,
        env: "ATTACH_CONTEXT",
        description: "Path to target base DTS file",
        parse: (value) => {
            if (!fs.existsSync(value)) { return `path does not exist: ${value}`; }
            const parsed = DeviceTree.new_from_string(fs.readFileSync(value, "utf8"));
            return typeof parsed === "string" ? `not a valid device tree: ${parsed}` : parsed;
        },
    },
    {
        toml: "overlay",
        key: "overlay",
        type: "path",
        required: false,
        description: "Path to the working DTSO overlay file (workfile)",
    },
    {
        toml: "board",
        key: "board",
        // A bundled board name is not a path, so no existence check; validate resolves both forms.
        type: "string",
        required: false,
        description: "Add-on board description (HAT, …): a path to a board YAML or a bundled board name (e.g. pmd-rpi-intz)",
        parse: (value) => {
            const board = load_board(value);
            return board;
        },
    },
    {
        toml: "validation-json",
        key: "validationJson",
        type: "path",
        required: false,
        internal: true,
        description: "Auto-generated dt-schema validation bundle",
    },
    {
        toml: "build-command",
        key: "buildCommand",
        type: "string",
        required: false,
        default: DEFAULT_BUILD_COMMAND,
        description: "dtc command used to compile the overlay; {input}/{output} are substituted with the .dtso and .dtbo paths",
    },
    {
        toml: "preprocess-command",
        key: "preprocessCommand",
        type: "string",
        required: false,
        default: DEFAULT_PREPROCESS_COMMAND,
        description: "C preprocessor command run on a board's shipped overlay by create-workfile; {input}/{output}/{linux} are substituted",
    },
    {
        toml: "overlay-compiled",
        key: "overlayCompiled",
        type: "path",
        required: false,
        description: "Path to the compiled DTBO artifact (written by the build command, read by deploy)",
    },
    {
        toml: "deploy-ip",
        key: "deployIp",
        type: "string",
        required: false,
        description: "IP address or hostname of the remote device to deploy to",
    },
    {
        toml: "deploy-user",
        key: "deployUser",
        type: "string",
        required: false,
        description: "SSH username on the remote device",
    },
    {
        toml: "deploy-password",
        key: "deployPassword",
        type: "string",
        required: false,
        description: "SSH password on the remote device (stored plaintext in config.toml)",
    },
];

const SPEC_BY_KEY: Map<keyof AttachConfig, FieldSpec> = new Map(
    CONFIG_REGISTRY.map((spec) => [spec.key, spec]),
);

/** Look up the field spec for a config field. Every key is present (see the totality test). */
export function config_field_spec(key: keyof AttachConfig): FieldSpec {
    const spec = SPEC_BY_KEY.get(key);
    if (spec === undefined) {
        throw new Error(`No config field spec for ${key}`);
    }
    return spec;
}

export interface CompatIndex {
    generated_at: number;
    linux?: string;
    dt_schema?: string;
    entries: Record<string, string>;
}

export function load_compat_index(): CompatIndex | undefined {
    const index_path = path.join(process.cwd(), ".attach-linux", "compat-index.json");

    if (!fs.existsSync(index_path)) {
        return undefined;
    }

    const raw = fs.readFileSync(index_path, "utf8");
    return JSON.parse(raw) as CompatIndex;
}

export function save_compat_index(entries: Record<string, string>, linux?: string, dt_schema?: string): string {
    const directory = path.join(process.cwd(), ".attach-linux");
    fs.mkdirSync(directory, { recursive: true });

    const index_path = path.join(directory, "compat-index.json");
    const index: CompatIndex = { generated_at: Date.now(), linux, dt_schema, entries };
    fs.writeFileSync(index_path, JSON.stringify(index, undefined, 2));

    return index_path;
}

/** Load only the config.toml file, without env var overlay. Used by save_config. */
export function load_config_file(): AttachConfig | undefined {
    const config_path = path.join(process.cwd(), ".attach-linux", "config.toml");

    if (!fs.existsSync(config_path)) {
        return undefined;
    }

    const raw = fs.readFileSync(config_path, "utf8");
    const parsed = parse(raw) as Record<string, unknown>;

    const config: AttachConfig = {};
    for (const spec of CONFIG_REGISTRY) {
        const value = parsed[spec.toml];
        if (typeof value === "string") {
            config[spec.key] = value;
        }
    }
    return config;
}

export interface ConfigFromSources {
    config: AttachConfig;
    ignored: { toml: string; value: string; env: string }[];
}

/** Build the effective config from a TOML record and the process environment. */
export function config_from_sources(
    toml: Record<string, unknown>,
    environment: Record<string, string | undefined>,
): ConfigFromSources {
    const config: AttachConfig = {};
    const ignored: ConfigFromSources["ignored"] = [];

    for (const spec of CONFIG_REGISTRY) {
        if (spec.env === undefined) {
            const value = toml[spec.toml];
            if (typeof value === "string") {
                config[spec.key] = value;
            }
            continue;
        }
        const env_value = environment[spec.env];
        if (env_value !== undefined && env_value !== "") {
            config[spec.key] = path.resolve(env_value);
            const toml_value = toml[spec.toml];
            if (typeof toml_value === "string") {
                ignored.push({ toml: spec.toml, value: toml_value, env: spec.env });
            }
            continue;
        }
        const fallback_value = spec.fallback?.();
        if (fallback_value !== undefined) {
            config[spec.key] = fallback_value;
        }
    }
    return { config, ignored };
}

let legacy_warned = false;

/** Load config from file + env vars. The main entry point for commands. */
export function load_config(): AttachConfig | undefined {
    const config_path = path.join(process.cwd(), ".attach-linux", "config.toml");

    let toml_record: Record<string, unknown> = {};
    if (fs.existsSync(config_path)) {
        toml_record = parse(fs.readFileSync(config_path, "utf8")) as Record<string, unknown>;
    }

    const { config, ignored } = config_from_sources(toml_record, process.env);

    if (!legacy_warned && ignored.length > 0) {
        legacy_warned = true;
        for (const { toml, value, env } of ignored) {
            console.error(`config.toml: ignoring ${toml} = ${JSON.stringify(value)}; it is read from $${env} (export ${env}=${JSON.stringify(value)})`);
        }
    }

    const has_any = Object.values(config).some(v => v !== undefined);
    if (!has_any && !fs.existsSync(config_path)) { return undefined; }
    return config;
}

/** Save config fields, skipping env-sourced fields (they disappear from config.toml). */
export function save_config(fields: Partial<AttachConfig>): void {
    const directory = path.join(process.cwd(), ".attach-linux");
    fs.mkdirSync(directory, { recursive: true });

    const config_path = path.join(directory, "config.toml");
    const existing = load_config_file() ?? {};
    const merged = { ...existing, ...fields };

    let content = "";
    for (const spec of CONFIG_REGISTRY) {
        if (spec.env !== undefined) { continue; }
        const value = merged[spec.key];
        if (value !== undefined) {
            content += `${spec.toml} = ${JSON.stringify(value)}\n`;
        }
    }

    fs.writeFileSync(config_path, content);
}

/** A config narrowed so every required field is a definite string. */
export type Checked<K extends keyof AttachConfig> = { [P in K]-?: string };

export type ParsedConfig = {
    context?: DeviceTree;
    board?: BoardDescription;
};

export type ConfigCheck<K extends keyof AttachConfig> =
    | { ok: true; values: Checked<K>; parsed: ParsedConfig }
    | { ok: false; kind: "missing-field"; field: K; toml: string }
    | { ok: false; kind: "missing-path"; field: K; toml: string; path: string }
    | { ok: false; kind: "invalid"; field: K; toml: string; path: string; message: string };

/** The failure shape shared by every ConfigCheck error, for message formatting. */
export type CheckFailure = {
    kind: "missing-field" | "missing-path" | "invalid";
    toml: string;
    path?: string;
    message?: string;
};

/**
 * Verify that every field in `required` is set, that path-typed fields exist on
 * disk, and that any field carrying a `validate` hook still passes it. The
 * validator runs here (read time) exactly as it does in config-set (write
 * time), so a config.toml that has gone stale is caught the same way whether it
 * was just set or edited by hand. Fails on the first problem. Pure — callers
 * decide how to report the failure.
 */
export function check_config<K extends keyof AttachConfig>(
    config: AttachConfig,
    required: readonly K[],
): ConfigCheck<K> {
    const values = {} as Checked<K>;
    const parsed: ParsedConfig = {};
    for (const field of required) {
        const spec = config_field_spec(field);
        const value = config[field];
        if (value === undefined) {
            return { ok: false, kind: "missing-field", field, toml: spec.toml };
        }
        if (spec.type === "path" && !fs.existsSync(value)) {
            return { ok: false, kind: "missing-path", field, toml: spec.toml, path: value };
        }
        if (spec.parse !== undefined) {
            const result = spec.parse(value);
            if (typeof result === "string") {
                return { ok: false, kind: "invalid", field, toml: spec.toml, path: value, message: result };
            }
            (parsed as Record<string, unknown>)[field] = result;
        } else {
            const invalid = spec.validate?.(value);
            if (invalid !== undefined) {
                return { ok: false, kind: "invalid", field, toml: spec.toml, path: value, message: invalid };
            }
        }
        values[field] = value;
    }
    return { ok: true, values, parsed };
}

/**
 * The normalized human and JSON strings for a check failure, so config-set,
 * resolve_config and the human-only commands all report identically.
 */
export function check_failure_message(failure: CheckFailure): { human: string; json: string } {
    const spec = CONFIG_REGISTRY.find(s => s.toml === failure.toml);
    const env_name = spec?.env;
    switch (failure.kind) {
        case "missing-field": {
            if (env_name !== undefined) {
                return {
                    human: `Missing environment variable: ${env_name}`,
                    json: `Missing environment variable: ${env_name}`,
                };
            }
            return { human: `Missing config: ${failure.toml}`, json: `missing config: ${failure.toml}` };
        }
        case "missing-path": {
            if (env_name !== undefined) {
                return {
                    human: `Invalid ${env_name}: ${failure.path} (path does not exist)`,
                    json: `Invalid ${env_name}: ${failure.path} (path does not exist)`,
                };
            }
            return { human: `Missing: ${failure.path}`, json: `Missing: ${failure.path}` };
        }
        case "invalid": {
            if (env_name !== undefined) {
                return {
                    human: `Invalid ${env_name}: ${failure.message}`,
                    json: `Invalid ${env_name}: ${failure.message}`,
                };
            }
            return { human: `Invalid ${failure.toml}: ${failure.message}`, json: `invalid config: ${failure.toml}: ${failure.message}` };
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("CONFIG_REGISTRY covers every AttachConfig key exactly once", () => {
        const keys: (keyof AttachConfig)[] = [
            "linux", "dtSchema", "context", "overlay", "board", "validationJson",
            "buildCommand", "preprocessCommand", "overlayCompiled", "deployIp", "deployUser", "deployPassword",
        ];
        expect(CONFIG_REGISTRY.length).toBe(keys.length);
        expect(SPEC_BY_KEY.size).toBe(keys.length);
        for (const key of keys) {
            expect(SPEC_BY_KEY.has(key)).toBe(true);
        }
    });

    test("check_config - reports the first missing field", () => {
        const result = check_config({ linux: "/x" }, ["dtSchema", "linux"]);
        expect(result.ok).toBe(false);
        if (result.ok) { return; }
        expect(result.kind).toBe("missing-field");
        expect(result.field).toBe("dtSchema");
        expect(result.toml).toBe("dt-schema");
    });

    test("check_config - string fields are presence-only (no existsSync)", () => {
        const result = check_config({ deployIp: "10.0.0.1" }, ["deployIp"]);
        expect(result.ok).toBe(true);
        if (!result.ok) { return; }
        expect(result.values.deployIp).toBe("10.0.0.1");
    });

    test("check_config - path fields must exist on disk", () => {
        const result = check_config({ overlay: "/does/not/exist.dtso" }, ["overlay"]);
        expect(result.ok).toBe(false);
        if (result.ok || result.kind !== "missing-path") { throw new Error("expected missing-path"); }
        expect(result.path).toBe("/does/not/exist.dtso");
    });

    test("check_config - runs the field validator at read time", () => {
        const result = check_config({ linux: process.cwd() }, ["linux"]);
        expect(result.ok).toBe(false);
        if (result.ok || result.kind !== "invalid") { throw new Error("expected invalid"); }
        expect(result.field).toBe("linux");
        expect(result.message).toContain("Documentation/devicetree/bindings");
    });

    test("config_from_sources - env wins over TOML", () => {
        const toml = { linux: "/old" };
        const env = { ATTACH_LINUX: "/new" };
        const { config, ignored } = config_from_sources(toml, env);
        expect(config.linux).toBe("/new");
        expect(ignored).toHaveLength(1);
        expect(ignored[0]!.toml).toBe("linux");
    });

    test("config_from_sources - empty env counts as unset", () => {
        const { config } = config_from_sources({}, { ATTACH_LINUX: "" });
        expect(config.linux).toBeUndefined();
    });

    test("config_from_sources - TOML values are ignored and reported for env fields", () => {
        const { config, ignored } = config_from_sources(
            { linux: "/old", overlay: "/my.dtso" },
            { ATTACH_LINUX: "/new" },
        );
        expect(config.linux).toBe("/new");
        expect(config.overlay).toBe("/my.dtso");
        expect(ignored).toHaveLength(1);
        expect(ignored[0]!.env).toBe("ATTACH_LINUX");
    });

    test("config_from_sources - relative env paths are resolved", () => {
        const { config } = config_from_sources({}, { ATTACH_CONTEXT: "../x.dts" });
        expect(config.context).toBe(path.resolve("../x.dts"));
    });

    test("save_config never writes env keys", () => {
        const original_cwd = process.cwd();
        const tmpdir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "attach-cfg-"));
        try {
            process.chdir(tmpdir);
            fs.mkdirSync(".attach-linux", { recursive: true });
            save_config({ linux: "/ignored", overlay: "/my.dtso" });
            const content = fs.readFileSync(path.join(tmpdir, ".attach-linux", "config.toml"), "utf8");
            expect(content).not.toContain("linux");
            expect(content).toContain("overlay");
        } finally {
            process.chdir(original_cwd);
            fs.rmSync(tmpdir, { recursive: true });
        }
    });

    test("check_failure_message - env fields use env var name", () => {
        const message = check_failure_message({ kind: "missing-field", toml: "linux" });
        expect(message.human).toBe("Missing environment variable: ATTACH_LINUX");
        expect(message.json).toBe("Missing environment variable: ATTACH_LINUX");
    });

    test("check_failure_message - non-env fields use toml name", () => {
        const message = check_failure_message({ kind: "missing-field", toml: "overlay" });
        expect(message.human).toBe("Missing config: overlay");
    });
}
