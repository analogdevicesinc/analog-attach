// The no-OS backend's settings. The front end stores them (JSON, local over global) and
// checks them against these specs; attach-no-os-lib reads them through the session's
// `SettingsView`, installed by `install` before every call into it, and never touches a
// settings file.

import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";
import {
    SETTINGS_DEFAULTS,
    SETTING_CATEGORIES,
    TARGET_SETTING,
    list_targets,
    list_template_sets,
    resolve_target,
    resolve_template_set,
    use_settings,
    use_templates_root,
    type Setting,
    type SettingsFile,
} from "attach-no-os-lib";

import type { Session, SettingSpec, SettingsHooks } from "../../interface/backend-interface";

/** The name hints use when no session is at hand (the specs' static hints): the front end's binary. */
export const DEFAULT_PROGRAM = "analog-attach";

/** `config` lists the settings under these, in this order (the lib's categories). */
const CATEGORY_TITLES: Readonly<Record<Setting["category"], string>> = {
    sources: "Sources",
    target: "Target",
    workfile: "Workfile",
    project: "Project",
    build: "Build",
};

/** Settings a `config` write checks against what exists on disk. */
const MUST_EXIST = new Set<string>(["capi-path", "module-paths"]);

/** The hint printed when a required setting is missing. */
const HINTS: Readonly<Partial<Record<keyof SettingsFile, string>>> = {
    "capi-path": `Run '${DEFAULT_PROGRAM} config capi-path <path>', or '${DEFAULT_PROGRAM}' on a terminal for the guided setup.`,
    "target": `Run '${DEFAULT_PROGRAM} config target <board or chip>' ('${DEFAULT_PROGRAM} list context' lists them).`,
};

function spec_of(key: keyof SettingsFile, setting: Setting): SettingSpec {
    // A template set is a bundled name or the path of your own folder, so its options
    // can't be a closed list: the `check` hook resolves it instead.
    const dynamic = setting.enum_of !== undefined && setting.enum_of !== "template";
    const hint = HINTS[key];
    return {
        key,
        category: CATEGORY_TITLES[setting.category],
        description: setting.description,
        type: setting.type,
        required: setting.required,
        ...(setting.options === undefined ? {} : { options: setting.options }),
        ...(dynamic ? { options: "dynamic" as const } : {}),
        ...(setting.default === undefined ? {} : { default: setting.default }),
        ...(MUST_EXIST.has(key) ? { must_exist: true } : {}),
        ...(hint === undefined ? {} : { hint }),
    };
}

/**
 * Every setting of `SETTINGS_DEFAULTS`, as the front end stores it: by category in the lib's
 * order (`SETTING_CATEGORIES`), since `config` lists the categories as their settings come,
 * then in `SETTINGS_DEFAULTS`' order within one.
 */
export const SETTINGS: readonly SettingSpec[] = (Object.entries(SETTINGS_DEFAULTS) as [keyof SettingsFile, Setting][])
    .toSorted(([, first], [, second]) => SETTING_CATEGORIES.indexOf(first.category) - SETTING_CATEGORIES.indexOf(second.category))
    .map(([key, setting]) => spec_of(key, setting));

/** The bundled codegen templates: `<assets>/templates` (the build copies them there). */
export function templates_directory(assets_directory: string): string {
    return path.join(assets_directory, "templates");
}

/**
 * Point attach-no-os-lib at this session: its settings, and the bundled templates. Every
 * command and hook calls it first, since the lib reads both through module state.
 */
export function install(session: Pick<Session, "settings" | "assets_dir">): void {
    use_settings(session.settings);
    const templates = templates_directory(session.assets_dir);
    // Run from the sources (tests), the lib's own templates are used.
    use_templates_root(fs.existsSync(templates) ? templates : undefined);
}

// =====================================================================================
// Hooks
// =====================================================================================

/** Whether `directory` is a capi checkout: its module.yml names it capi. What the setup looks for. */
export function looks_like_capi(directory: string): boolean {
    return read_module(directory)?.name === "capi";
}

/**
 * Whether `directory` can be the `capi-path`: a module checkout (it has a module.yml). Looser
 * than `looks_like_capi`, so a fork or a stand-in under another name is accepted.
 */
export function is_module_checkout(directory: string): boolean {
    return read_module(directory) !== undefined;
}

export function read_module(directory: string): { name?: string; type?: string } | undefined {
    try {
        const parsed: unknown = YAML.parse(fs.readFileSync(path.join(directory, "module.yml"), "utf8"));
        if (typeof parsed !== "object" || parsed === null) { return undefined; }
        const { name, type } = parsed as Record<string, unknown>;
        return {
            ...(typeof name === "string" ? { name } : {}),
            ...(typeof type === "string" ? { type } : {}),
        };
    } catch {
        return undefined;
    }
}

function check(key: string, value: string, session: Session): Promise<{ ok: true } | { ok: false; message: string }> {
    if (key === TARGET_SETTING) {
        install(session);
        const resolved = resolve_target(value);
        if (!resolved.ok) { return Promise.resolve({ ok: false, message: resolved.error.message }); }
    }
    if (key === "capi-path" && !is_module_checkout(value)) {
        return Promise.resolve({ ok: false, message: `capi-path: ${value} is not a capi checkout (it has no module.yml)` });
    }
    if (key === "project-template") {
        install(session);
        const resolved = resolve_template_set(value);
        if (!resolved.ok) { return Promise.resolve({ ok: false, message: `project-template: ${resolved.error.message}` }); }
    }
    return Promise.resolve({ ok: true });
}

/** The options of the scanned settings: for target, every board, then every chip. */
function options(key: string, session: Session): Promise<string[]> {
    install(session);
    if (key === TARGET_SETTING) { return Promise.resolve(list_targets()); }
    if (key === "project-template") { return Promise.resolve(list_template_sets()); }
    return Promise.resolve([]);
}

export const noos_settings_hooks: SettingsHooks = { check, options };

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("SETTINGS - every key of the lib, flat, by category, module-paths a path_list, target scanned", () => {
        expect(SETTINGS.map(spec => spec.key).toSorted()).toEqual(Object.keys(SETTINGS_DEFAULTS).toSorted());
        const titles = [...new Set(SETTINGS.map(spec => spec.category))];
        expect(titles).toEqual(SETTING_CATEGORIES.map(category => CATEGORY_TITLES[category]));
        const by_key = new Map(SETTINGS.map(spec => [spec.key, spec]));
        expect(by_key.get("module-paths")).toMatchObject({ type: "path_list", category: "Sources", must_exist: true });
        expect(by_key.get("target")).toMatchObject({ options: "dynamic", required: true, category: "Target" });
        expect(by_key.has("board")).toBe(false);
        expect(by_key.has("platform")).toBe(false);
        expect(by_key.get("project-template")).toMatchObject({ default: "capi" });
        expect(by_key.get("project-template")?.options).toBeUndefined();
        expect(by_key.get("probe")).toMatchObject({ options: ["openocd", "jlink"], default: "openocd" });
        expect(by_key.get("workfile")).toMatchObject({ type: "path", default: "workfile.json" });
    });
}
