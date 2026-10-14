import * as crypto from "node:crypto";
import * as fs from "node:fs";

import type { AppConfig, ToolConfig } from "./config.js";
import { saveConfig } from "./config.js";
import { AnalogAttachError } from "./error.js";
import type { Manifest } from "./protocol/manifest.js";
import { parseManifest } from "./protocol/manifest.js";
import { checkMajorMatch } from "./protocol/version.js";
import { validateManifest } from "./schema.js";

export interface VerifiedManifest {
    manifest: Manifest;
}

export function sha256Hex(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
}

export function loadVerified(
    tool: ToolConfig,
    config: AppConfig,
    configPath: string,
): VerifiedManifest {
    const manifestPath = tool.manifest_path;
    if (!manifestPath) {
        throw new AnalogAttachError("manifest", "tool has no manifest_path — run 'init' first");
    }

    let content: string;
    try {
        content = fs.readFileSync(manifestPath, "utf8");
    } catch (error) {
        throw new AnalogAttachError(
            "manifest",
            `failed to read manifest at '${manifestPath}': ${(error as Error).message}`,
        );
    }

    const newHash = sha256Hex(content);
    const storedHash = tool.manifest_sha256;
    const hashChanged = storedHash !== newHash;

    let manifestJson: Record<string, unknown>;
    try {
        manifestJson = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
        throw new AnalogAttachError(
            "manifest",
            `manifest is not valid JSON: ${(error as Error).message}`,
        );
    }

    const manifest = parseManifest(content);

    if (hashChanged) {
        validateManifest(manifestJson);

        const binary = tool.binary ?? "<unknown>";
        checkMajorMatch(manifest.protocol_version, binary);

        const toolEntry = config.tools.find(t => t.name === tool.name);
        if (toolEntry) {
            toolEntry.manifest_sha256 = newHash;
            try {
                saveConfig(config, configPath);
            } catch (error) {
                process.stderr.write(
                    `analog-attach: warning: failed to persist updated hash: ${(error as Error).message}\n`,
                );
            }
        }
    }

    return { manifest };
}
