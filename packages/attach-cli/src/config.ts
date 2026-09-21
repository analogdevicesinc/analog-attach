import * as fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";
import { DeviceTree } from "attach-lib";

export const DEFAULT_BUILD_COMMAND = "dtc -@ -I dts -O dtb -o {output} {input}";

export interface AttachConfig {
    linux?: string;
    dtSchema?: string;
    context?: string;
    overlay?: string;
    validationJson?: string;
    buildCommand?: string;
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
    /**
     * Optional structural validation, returning an error message or undefined.
     * Run both when the field is set (config-set) and when it is read
     * (check_config): config.toml is a plain file that can be edited or grow
     * stale out from under the tool, so a value that was valid at write time
     * must be re-checked at read time.
     */
    validate?: (value: string) => string | undefined;
}

export const CONFIG_REGISTRY: readonly FieldSpec[] = [
    {
        toml: "linux",
        key: "linux",
        type: "path",
        required: true,
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
        description: "Path to target base DTS file",
        validate: (value) => {
            if (!fs.existsSync(value)) { return `path does not exist: ${value}`; }
            const parsed = DeviceTree.new_from_string(fs.readFileSync(value, "utf8"));
            return typeof parsed === "string" ? `not a valid device tree: ${parsed}` : undefined;
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

export function save_compat_index(entries: Record<string, string>): string {
    const directory = path.join(process.cwd(), ".attach-linux");
    fs.mkdirSync(directory, { recursive: true });

    const index_path = path.join(directory, "compat-index.json");
    const index: CompatIndex = { generated_at: Date.now(), entries };
    fs.writeFileSync(index_path, JSON.stringify(index, undefined, 2));

    return index_path;
}

export function load_config(): AttachConfig | undefined {
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

export function save_config(fields: Partial<AttachConfig>): void {
    const directory = path.join(process.cwd(), ".attach-linux");
    fs.mkdirSync(directory, { recursive: true });

    const config_path = path.join(directory, "config.toml");
    const existing = load_config() ?? {};
    const merged = { ...existing, ...fields };

    let content = "";
    for (const spec of CONFIG_REGISTRY) {
        const value = merged[spec.key];
        if (value !== undefined) {
            content += `${spec.toml} = ${JSON.stringify(value)}\n`;
        }
    }

    fs.writeFileSync(config_path, content);
}

/** A config narrowed so every required field is a definite string. */
export type Checked<K extends keyof AttachConfig> = { [P in K]-?: string };

export type ConfigCheck<K extends keyof AttachConfig> =
    | { ok: true; values: Checked<K> }
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
    for (const field of required) {
        const spec = config_field_spec(field);
        const value = config[field];
        if (value === undefined) {
            return { ok: false, kind: "missing-field", field, toml: spec.toml };
        }
        if (spec.type === "path" && !fs.existsSync(value)) {
            return { ok: false, kind: "missing-path", field, toml: spec.toml, path: value };
        }
        const invalid = spec.validate?.(value);
        if (invalid !== undefined) {
            return { ok: false, kind: "invalid", field, toml: spec.toml, path: value, message: invalid };
        }
        values[field] = value;
    }
    return { ok: true, values };
}

/**
 * The normalized human and JSON strings for a check failure, so config-set,
 * resolve_config and the human-only commands all report identically.
 */
export function check_failure_message(failure: CheckFailure): { human: string; json: string } {
    switch (failure.kind) {
        case "missing-field": {
            return { human: `Missing config: ${failure.toml}`, json: `missing config: ${failure.toml}` };
        }
        case "missing-path": {
            return { human: `Missing: ${failure.path}`, json: `Missing: ${failure.path}` };
        }
        case "invalid": {
            return { human: `Invalid ${failure.toml}: ${failure.message}`, json: `invalid config: ${failure.toml}: ${failure.message}` };
        }
    }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("CONFIG_REGISTRY covers every AttachConfig key exactly once", () => {
        const keys: (keyof AttachConfig)[] = [
            "linux", "dtSchema", "context", "overlay", "validationJson",
            "buildCommand", "overlayCompiled", "deployIp", "deployUser", "deployPassword",
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
        // cwd exists but is not a kernel tree, so linux's validator rejects it —
        // the same check config-set runs, now applied when the value is read.
        const result = check_config({ linux: process.cwd() }, ["linux"]);
        expect(result.ok).toBe(false);
        if (result.ok || result.kind !== "invalid") { throw new Error("expected invalid"); }
        expect(result.field).toBe("linux");
        expect(result.message).toContain("Documentation/devicetree/bindings");
    });
}
