import * as fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { AppConfig, ToolConfig } from "../../config";
import { saveConfig } from "../../config";
import { AnalogAttachError } from "../../error";
import { sha256Hex } from "../../manifest-store";
import { parseManifest, getCommand } from "../../protocol/manifest";
import { checkMajorMatch } from "../../protocol/version";
import { validateManifest } from "../../schema";
import { invoke } from "../../transport";
import type { Prompter } from "../../prompt";
import { formatConfigPrompt } from "../../prompt";
import type { ToolConfigResponse, Config } from "../../protocol/types";
import type { Manifest } from "../../protocol/manifest";

export function runInit(
    binary: string,
    noInteractive: boolean,
    prompter: Prompter,
    config: AppConfig,
    configPath: string,
): Record<string, unknown> {
    const result = spawnSync(binary, ["attach-manifest"], {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
    });

    if (result.error) {
        throw new AnalogAttachError("transport", `failed to run '${binary} attach-manifest': ${result.error.message}`);
    }

    if (result.status !== 0) {
        const stderr = (result.stderr ?? "").trim();
        throw new AnalogAttachError("transport", `'${binary} attach-manifest' exited with ${result.status}: ${stderr}`);
    }

    const manifestPathString = (result.stdout ?? "").trim();
    if (!manifestPathString) {
        throw new AnalogAttachError("transport", "attach-manifest produced empty stdout — expected a file path");
    }

    if (!fs.existsSync(manifestPathString)) {
        throw new AnalogAttachError("transport", `manifest path '${manifestPathString}' does not exist`);
    }

    const content = fs.readFileSync(manifestPathString, "utf8");
    let manifestJson: Record<string, unknown>;
    try {
        manifestJson = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
        throw new AnalogAttachError("manifest", `manifest is not valid JSON: ${(error as Error).message}`);
    }

    validateManifest(manifestJson);

    const manifest = parseManifest(content);
    checkMajorMatch(manifest.protocol_version, binary);

    const hash = sha256Hex(content);

    const toolName = path.basename(binary);
    const existing = config.tools.find(t => t.name === toolName);
    if (existing) {
        existing.binary = binary;
        existing.manifest_path = manifestPathString;
        existing.manifest_sha256 = hash;
    } else {
        const newTool: ToolConfig = {
            name: toolName,
            binary,
            manifest_path: manifestPathString,
            manifest_sha256: hash,
            settings: {},
        };
        config.tools.push(newTool);
    }

    if (!config.meta.default_tool) {
        config.meta.default_tool = toolName;
    }

    saveConfig(config, configPath);

    let missingFields: string[] = [];
    const tcgMapping = getCommand(manifest, "tool-config-get");
    if (tcgMapping) {
        try {
            const resp = invoke(tcgMapping, []);
            const tcr = resp as unknown as ToolConfigResponse;
            if (tcr.configs) {
                for (const cfg of tcr.configs) {
                    if (cfg.required && (cfg.value === null || cfg.value === undefined)) {
                        missingFields.push(cfg.field_name);
                    }
                }

                if (!noInteractive) {
                    missingFields = runInteractiveConfig(tcr.configs, manifest, prompter, missingFields);
                }
            }
        } catch {
            // tool-config-get failed — config not complete
        }
    }

    const configComplete = missingFields.length === 0;

    return {
        ok: true,
        message: `Initialized tool '${toolName}' successfully.`,
        severity: "info",
        config_complete: configComplete,
        missing_fields: missingFields,
    };
}

function runInteractiveConfig(
    configs: Config[],
    manifest: Manifest,
    prompter: Prompter,
    missingFields: string[],
): string[] {
    const tcsMapping = getCommand(manifest, "tool-config-set");
    if (!tcsMapping) {return missingFields;}

    const remaining = [...missingFields];

    for (const cfg of configs.filter(c => c.required)) {
        process.stderr.write(formatConfigPrompt(cfg) + "\n");

        let value: string | undefined;
        if (cfg.default !== null && cfg.default !== undefined) {
            value = prompter.confirm(`  Use default '${cfg.default}'?`, true) ? String(cfg.default).replaceAll(/^"|"$/g, "") : prompter.promptLine("  Enter value: ");
        } else {
            value = prompter.promptLine("  Enter value: ");
        }

        if (value === undefined) {continue;}

        try {
            invoke(tcsMapping, [cfg.field_name, value]);
            const index = remaining.indexOf(cfg.field_name);
            if (index !== -1) {remaining.splice(index, 1);}
        } catch {
            // config-set failed
        }
    }

    const optional = configs.filter(c => !c.required);
    if (optional.length > 0 && prompter.confirm("Configure optional fields?", false)) {
        for (const cfg of optional) {
            process.stderr.write(formatConfigPrompt(cfg) + "\n");
            const value = prompter.promptLine("  Enter value (or empty to skip): ");
            if (value === undefined) {continue;}
            try {
                invoke(tcsMapping, [cfg.field_name, value]);
            } catch {
                // config-set failed
            }
        }
    }

    return remaining;
}
