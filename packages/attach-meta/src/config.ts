import * as TOML from "smol-toml";
import * as fs from "node:fs";
import path from "node:path";

export interface MetaConfig {
    default_tool?: string;
}

export interface ToolConfig {
    name: string;
    binary?: string;
    manifest_path?: string;
    manifest_sha256?: string;
    settings: Record<string, string>;
}

export interface AppConfig {
    meta: MetaConfig;
    tools: ToolConfig[];
}

function defaultConfig(): AppConfig {
    return { meta: {}, tools: [] };
}

function findProjectConfig(): string | undefined {
    let directory = process.cwd();
    for (;;) {
        const candidate = path.join(directory, ".analog-attach.toml");
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {break;}
        directory = parent;
    }
    return undefined;
}

function defaultProjectConfigPath(): string {
    return path.join(process.cwd(), ".analog-attach.toml");
}

export function loadConfig(): [AppConfig, string] {
    const configPath = findProjectConfig() ?? defaultProjectConfigPath();

    if (!fs.existsSync(configPath)) {
        return [defaultConfig(), configPath];
    }

    const contents = fs.readFileSync(configPath, "utf8");
    const parsed = TOML.parse(contents) as Record<string, unknown>;

    const meta = (parsed["meta"] ?? {}) as MetaConfig;
    const rawTools = (parsed["tools"] ?? []) as Record<string, unknown>[];
    const tools: ToolConfig[] = rawTools.map(t => ({
        name: t["name"] as string,
        binary: t["binary"] as string | undefined,
        manifest_path: t["manifest_path"] as string | undefined,
        manifest_sha256: t["manifest_sha256"] as string | undefined,
        settings: (t["settings"] ?? {}) as Record<string, string>,
    }));

    return [{ meta, tools }, configPath];
}

export function saveConfig(config: AppConfig, configPath: string): void {
    const content = TOML.stringify(config as unknown as Record<string, unknown>);
    const directory = path.dirname(configPath);
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(configPath, content, "utf8");
}

export function findTool(config: AppConfig, name: string): ToolConfig | undefined {
    return config.tools.find(t => t.name === name);
}
