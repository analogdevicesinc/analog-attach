import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "smol-toml";

export interface AttachConfig {
    linux?: string;
    dtSchema?: string;
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
    };
}
