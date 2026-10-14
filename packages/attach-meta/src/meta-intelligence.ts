import * as fs from "node:fs";
import path from "node:path";

import type { Intelligence, Suggestion } from "./protocol/types";

const RESERVED_KINDS = ["attachable"] as const;

export function metaIntelligences(): Intelligence[] {
    return [{
        kind: "attachable",
        description: "Registered analog attachable tools discoverable on PATH",
        args: [],
    }];
}

export function isMetaKind(kind: string): boolean {
    return (RESERVED_KINDS as readonly string[]).includes(kind);
}

export function metaSuggest(kind: string, _arguments: readonly string[]): Suggestion[] {
    if (kind !== "attachable") {return [];}

    const pathEnvironment = process.env["PATH"] ?? "";
    const directories = pathEnvironment.split(path.delimiter);
    const seen = new Set<string>();
    const suggestions: Suggestion[] = [];

    for (const directory of directories) {
        try {
            const entries = fs.readdirSync(directory);
            for (const entry of entries) {
                if (entry.startsWith("attach-") && !seen.has(entry)) {
                    seen.add(entry);
                    try {
                        fs.accessSync(path.join(directory, entry), fs.constants.X_OK);
                        suggestions.push({ value: entry });
                    } catch { /* not executable */ }
                }
            }
        } catch { /* dir doesn't exist or not readable */ }
    }

    return suggestions;
}

export function mergeIntelligence(meta: Intelligence[], tool: Intelligence[]): Intelligence[] {
    const merged = [...meta];
    for (const t of tool) {
        if (!merged.some(m => m.kind === t.kind)) {
            merged.push(t);
        }
    }
    return merged;
}
