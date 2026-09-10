import * as fs from "node:fs";
import path from "node:path";
import { parse } from "smol-toml";

export interface AttachConfig {
    linux?: string;
    dtSchema?: string;
    context?: string;
    overlay?: string;
    validationJson?: string;
}

export interface CompatIndex {
    generated_at: number;
    entries: Record<string, string>;
}

export function load_compat_index(): CompatIndex | undefined {
    const index_path = path.join(process.cwd(), ".analog-attach", "compat-index.json");

    if (!fs.existsSync(index_path)) {
        return undefined;
    }

    const raw = fs.readFileSync(index_path, "utf8");
    return JSON.parse(raw) as CompatIndex;
}

export function save_compat_index(entries: Record<string, string>): string {
    const directory = path.join(process.cwd(), ".analog-attach");
    fs.mkdirSync(directory, { recursive: true });

    const index_path = path.join(directory, "compat-index.json");
    const index: CompatIndex = { generated_at: Date.now(), entries };
    fs.writeFileSync(index_path, JSON.stringify(index, undefined, 2));

    return index_path;
}

export function load_config(): AttachConfig {
    const config_path = path.join(process.cwd(), ".analog-attach", "config.toml");

    if (!fs.existsSync(config_path)) {
        return {};
    }

    const raw = fs.readFileSync(config_path, "utf8");
    const parsed = parse(raw) as Record<string, unknown>;

    return {
        linux: typeof parsed["linux"] === "string" ? parsed["linux"] : undefined,
        dtSchema: typeof parsed["dt-schema"] === "string" ? parsed["dt-schema"] : undefined,
        context: typeof parsed["context"] === "string" ? parsed["context"] : undefined,
        overlay: typeof parsed["overlay"] === "string" ? parsed["overlay"] : undefined,
        validationJson: typeof parsed["validation-json"] === "string" ? parsed["validation-json"] : undefined,
    };
}

export function save_config(fields: Partial<AttachConfig>): void {
    const directory = path.join(process.cwd(), ".analog-attach");
    fs.mkdirSync(directory, { recursive: true });

    const config_path = path.join(directory, "config.toml");
    const existing = load_config();
    const merged = { ...existing, ...fields };

    const field_map: Record<string, string> = {
        linux: "linux",
        dtSchema: "dt-schema",
        context: "context",
        overlay: "overlay",
        validationJson: "validation-json",
    };

    let content = "";
    for (const [key, toml_key] of Object.entries(field_map)) {
        const value = merged[key as keyof AttachConfig];
        if (value !== undefined) {
            content += `${toml_key} = ${JSON.stringify(value)}\n`;
        }
    }

    fs.writeFileSync(config_path, content);
}
