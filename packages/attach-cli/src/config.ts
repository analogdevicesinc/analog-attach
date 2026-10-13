import * as fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { DeviceTree } from "attach-lib";

import { getBundledDtSchemaPath } from "./commands/skill/utilities";

export const DEFAULT_BUILD_COMMAND = "{dtc} -@ -I dts -O dtb -o {output} {input}";
// Mirrors kbuild's dtc_cpp_flags; {linux} is the configured Linux tree.
export const DEFAULT_PREPROCESS_COMMAND = "cpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}";

export interface AttachConfig {
    linux?: string;
    dtSchema?: string;
    devicetree?: string;
    overlay?: string;
    overlaySyntax?: string;
    validationJson?: string;
    buildCommand?: string;
    preprocessCommand?: string;
    preprocessedDevicetree?: string;
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
    /** User-facing hint printed when this field is missing (e.g. how to set it up). */
    hint?: string;
    validate?: (value: string) => string | undefined;
    parse?: (value: string) => unknown | string;
}

const SETUP_HINT = "Run 'attach-linux' to set up a workspace interactively.";

export const CONFIG_REGISTRY: readonly FieldSpec[] = [
    {
        toml: "linux",
        key: "linux",
        type: "path",
        required: true,
        env: "ATTACH_LINUX",
        description: "Path to Linux kernel source tree (set via $ATTACH_LINUX)",
        hint: SETUP_HINT,
        validate: (value) =>
            fs.existsSync(path.join(value, "Documentation", "devicetree", "bindings"))
                ? undefined
                : `no Documentation/devicetree/bindings under ${value}`,
    },
    {
        toml: "dt-schema",
        key: "dtSchema",
        type: "path",
        required: false,
        internal: true,
        fallback: () => getBundledDtSchemaPath(),
        description: "Path to bundled dt-schema (not user-configurable)",
    },
    {
        toml: "devicetree",
        key: "devicetree",
        type: "path",
        required: true,
        env: "ATTACH_DEVICETREE",
        description: "Path to target base DTS file (set via $ATTACH_DEVICETREE)",
        hint: SETUP_HINT,
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
        hint: "Run 'create-workfile' to create one, or 'config-set overlay <path>'.",
    },
    {
        toml: "overlay-syntax",
        key: "overlaySyntax",
        type: "string",
        required: false,
        options: ["fragment", "label"],
        description: "Output syntax for the overlay file: fragment (default) or label (&spi0 { … })",
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
        internal: true,
        default: DEFAULT_BUILD_COMMAND,
        description: "dtc command used to compile the overlay; {dtc}/{input}/{output} are substituted",
    },
    {
        toml: "preprocess-command",
        key: "preprocessCommand",
        type: "string",
        required: false,
        default: DEFAULT_PREPROCESS_COMMAND,
        description: "C preprocessor command to resolve macros in the base devicetree; {input}/{output}/{linux} are substituted",
    },
    {
        toml: "preprocessed-devicetree",
        key: "preprocessedDevicetree",
        type: "path",
        required: false,
        internal: true,
        description: "Auto-generated preprocessed base DTS (regenerated on each use)",
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
            } else {
                const fallback_value = spec.fallback?.();
                if (fallback_value !== undefined) {
                    config[spec.key] = fallback_value;
                }
            }
            continue;
        }
        const environment_value = environment[spec.env];
        if (environment_value !== undefined && environment_value !== "") {
            config[spec.key] = path.resolve(environment_value);
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
    devicetree?: DeviceTree;
};

export type ConfigCheck<K extends keyof AttachConfig> =
    | { ok: true; values: Checked<K>; parsed: ParsedConfig }
    | { ok: false; failures: CheckFailure[] };

export type CheckFailure = {
    kind: "missing-field" | "missing-path" | "invalid";
    field: string;
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
    const failures: CheckFailure[] = [];
    for (const field of required) {
        const spec = config_field_spec(field);
        const value = config[field];
        if (value === undefined) {
            failures.push({ kind: "missing-field", field, toml: spec.toml });
            continue;
        }
        if (spec.type === "path" && !fs.existsSync(value)) {
            failures.push({ kind: "missing-path", field, toml: spec.toml, path: value });
            continue;
        }
        if (spec.parse === undefined) {
            const invalid = spec.validate?.(value);
            if (invalid !== undefined) {
                failures.push({ kind: "invalid", field, toml: spec.toml, path: value, message: invalid });
                continue;
            }
        } else {
            const result = spec.parse(value);
            if (typeof result === "string") {
                failures.push({ kind: "invalid", field, toml: spec.toml, path: value, message: result });
                continue;
            }
            (parsed as Record<string, unknown>)[field] = result;
        }
        values[field] = value;
    }
    if (failures.length > 0) { return { ok: false, failures }; }
    return { ok: true, values, parsed };
}

function format_one_failure(failure: CheckFailure): { label: string; description: string } {
    const spec = CONFIG_REGISTRY.find(s => s.toml === failure.toml);
    const environment_name = spec?.env;
    const description = spec?.description ?? failure.toml;
    switch (failure.kind) {
        case "missing-field": {
            const label = environment_name === undefined ? failure.toml : environment_name;
            return { label, description };
        }
        case "missing-path": {
            const name = environment_name === undefined ? failure.toml : environment_name;
            return { label: `${name}: ${failure.path} (path does not exist)`, description };
        }
        case "invalid": {
            const name = environment_name === undefined ? failure.toml : environment_name;
            return { label: `${name}: ${failure.message}`, description };
        }
    }
}

export function check_failure_message(failures: CheckFailure[]): { human: string; json: string } {
    const hints: string[] = [];
    for (const f of failures) {
        const spec = CONFIG_REGISTRY.find(s => s.toml === f.toml);
        if (spec?.hint !== undefined && !hints.includes(spec.hint)) {
            hints.push(spec.hint);
        }
    }
    const hint_block = hints.length > 0 ? "\n\n" + hints.join("\n") : "";

    if (failures.length === 1) {
        const f = failures[0]!;
        const { label, description } = format_one_failure(f);
        const spec = CONFIG_REGISTRY.find(s => s.toml === f.toml);
        const prefix = f.kind === "missing-field"
            ? (spec?.env === undefined ? "Missing config" : "Missing environment variable")
            : "Invalid";
        const human = `${prefix}: ${label} — ${description}${hint_block}`;
        const json = JSON.stringify({ errors: [{ field: f.toml, kind: f.kind, message: label, description }], hints });
        return { human, json };
    }

    const lines: string[] = ["Missing configuration:\n"];
    const json_errors: { field: string; kind: string; message: string; description: string }[] = [];
    for (const f of failures) {
        const { label, description } = format_one_failure(f);
        const environment_name = CONFIG_REGISTRY.find(s => s.toml === f.toml)?.env;
        const environment_tag = environment_name === undefined ? "" : " (environment variable)";
        lines.push(`  ${label}${environment_tag} — ${description}`);
        json_errors.push({ field: f.toml, kind: f.kind, message: label, description });
    }
    const human = lines.join("\n") + hint_block;
    const json = JSON.stringify({ errors: json_errors, hints });
    return { human, json };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("CONFIG_REGISTRY covers every AttachConfig key exactly once", () => {
        const keys: (keyof AttachConfig)[] = [
            "linux", "dtSchema", "devicetree", "overlay", "overlaySyntax", "validationJson",
            "buildCommand", "preprocessCommand", "preprocessedDevicetree", "overlayCompiled", "deployIp", "deployUser", "deployPassword",
        ];
        expect(CONFIG_REGISTRY.length).toBe(keys.length);
        expect(SPEC_BY_KEY.size).toBe(keys.length);
        for (const key of keys) {
            expect(SPEC_BY_KEY.has(key)).toBe(true);
        }
    });

    test("check_config - collects all missing fields", () => {
        const result = check_config({}, ["linux", "devicetree"]);
        expect(result.ok).toBe(false);
        if (result.ok) { return; }
        expect(result.failures).toHaveLength(2);
        expect(result.failures[0]!.field).toBe("linux");
        expect(result.failures[1]!.field).toBe("devicetree");
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
        if (result.ok) { return; }
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]!.kind).toBe("missing-path");
        expect(result.failures[0]!.path).toBe("/does/not/exist.dtso");
    });

    test("check_config - runs the field validator at read time", () => {
        const result = check_config({ linux: process.cwd() }, ["linux"]);
        expect(result.ok).toBe(false);
        if (result.ok) { return; }
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]!.kind).toBe("invalid");
        expect(result.failures[0]!.field).toBe("linux");
        expect(result.failures[0]!.message).toContain("Documentation/devicetree/bindings");
    });

    test("config_from_sources - env wins over TOML", () => {
        const toml = { linux: "/old" };
        const environment = { ATTACH_LINUX: "/new" };
        const { config, ignored } = config_from_sources(toml, environment);
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
        const { config } = config_from_sources({}, { ATTACH_DEVICETREE: "../x.dts" });
        expect(config.devicetree).toBe(path.resolve("../x.dts"));
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

    test("check_failure_message - single env field includes description and hint", () => {
        const message = check_failure_message([{ kind: "missing-field", field: "linux", toml: "linux" }]);
        expect(message.human).toContain("ATTACH_LINUX");
        expect(message.human).toContain("Linux kernel source tree");
        expect(message.human).toContain("attach-linux");
    });

    test("check_failure_message - single non-env field includes description", () => {
        const message = check_failure_message([{ kind: "missing-field", field: "overlay", toml: "overlay" }]);
        expect(message.human).toContain("overlay");
        expect(message.human).toContain("DTSO overlay file");
        expect(message.human).toContain("create-workfile");
    });

    test("check_failure_message - multiple env fields deduplicate hint", () => {
        const message = check_failure_message([
            { kind: "missing-field", field: "linux", toml: "linux" },
            { kind: "missing-field", field: "devicetree", toml: "devicetree" },
        ]);
        expect(message.human).toContain("ATTACH_LINUX");
        expect(message.human).toContain("ATTACH_DEVICETREE");
        const hint_count = message.human.split("attach-linux").length - 1;
        expect(hint_count).toBe(1);
    });
}
