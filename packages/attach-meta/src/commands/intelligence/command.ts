import type { CommandName, Manifest } from "../../protocol/manifest";
import { getCommand } from "../../protocol/manifest";
import type { Intelligence, ListIntelligenceResponse } from "../../protocol/types";
import { invoke } from "../../transport";
import { AnalogAttachError } from "../../error";
import { buildExtraArguments } from "../dispatch";
import { metaIntelligences, isMetaKind, metaSuggest, mergeIntelligence } from "../../meta-intelligence";

export function runIntelligence(
    cmd: CommandName,
    positionals: readonly string[],
    flags: Record<string, unknown>,
    manifest: Manifest | undefined,
): Record<string, unknown> {
    if (cmd === "list-intelligence") {
        return runListIntelligence(manifest);
    }
    return runSuggest(positionals, flags, manifest);
}

function runListIntelligence(
    manifest: Manifest | undefined,
): Record<string, unknown> {
    const meta = metaIntelligences();

    let toolIntelligence: Intelligence[] = [];
    const liMapping = manifest ? getCommand(manifest, "list-intelligence") : undefined;
    if (liMapping) {
        try {
            const liRaw = invoke(liMapping, []);
            const liResponse = liRaw as unknown as ListIntelligenceResponse;
            if (liResponse.ok !== false) {
                toolIntelligence = liResponse.intelligence ?? [];
            }
        } catch {
            // tool doesn't support list-intelligence
        }
    }

    const merged = mergeIntelligence(meta, toolIntelligence);

    return {
        ok: true,
        message: "intelligence",
        severity: "info",
        intelligence: merged,
    };
}

function runSuggest(
    positionals: readonly string[],
    flags: Record<string, unknown>,
    manifest: Manifest | undefined,
): Record<string, unknown> {
    const kind = positionals[0];
    if (!kind) {
        throw new AnalogAttachError("input", "suggest requires a kind argument");
    }

    if (isMetaKind(kind)) {
        const suggestions = metaSuggest(kind, positionals.slice(1));
        return {
            ok: true,
            message: "suggestions",
            severity: "info",
            suggestions,
        };
    }

    if (!manifest) {
        throw new AnalogAttachError("input", `suggest kind '${kind}' is not available — no tool configured`);
    }

    const suggestMapping = getCommand(manifest, "suggest");
    if (!suggestMapping) {
        throw new AnalogAttachError("manifest", "command 'suggest' not in manifest");
    }

    const extraArguments = buildExtraArguments(positionals, flags);
    return invoke(suggestMapping, extraArguments);
}
