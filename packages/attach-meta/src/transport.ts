import { spawnSync } from "node:child_process";

import type { CommandMapping } from "./protocol/manifest.js";
import { AnalogAttachError } from "./error.js";

export function invoke(
    mapping: CommandMapping,
    extraArguments: readonly string[],
): Record<string, unknown> {
    const argv = mapping.argv;
    if (argv.length === 0) {
        throw new AnalogAttachError("manifest", "command argv is empty");
    }

    const binary = argv[0]!;
    const result = spawnSync(binary, [...argv.slice(1), ...extraArguments], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: mapping.timeout_ms,
        encoding: "utf8",
    });

    if (result.error) {
        if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
            throw new AnalogAttachError(
                "transport",
                `'${binary}' timed out after ${mapping.timeout_ms}ms`,
            );
        }
        throw new AnalogAttachError(
            "transport",
            `could not run '${binary}': ${result.error.message} — is it installed and on your PATH?`,
        );
    }

    const stderr = (result.stderr ?? "").trim();
    const stderrHint = stderr ? `\n  stderr: ${stderr}` : "";

    if (result.status !== 0) {
        throw new AnalogAttachError(
            "transport",
            `'${binary}' exited with code ${result.status ?? -1}${stderrHint}`,
        );
    }

    const stdout = (result.stdout ?? "").trim();
    if (!stdout) {
        throw new AnalogAttachError(
            "transport",
            `'${binary}' returned no output — verify '${binary}' handles this command and produces JSON on stdout${stderrHint}`,
        );
    }

    try {
        return JSON.parse(stdout) as Record<string, unknown>;
    } catch (error) {
        throw new AnalogAttachError(
            "transport",
            `'${binary}' returned invalid JSON: ${(error as Error).message}${stderrHint}`,
        );
    }
}
