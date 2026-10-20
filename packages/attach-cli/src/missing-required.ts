import type { DeviceTree } from "attach-lib";

import type { Bindings, Workfile } from "./config/workspace";
import type { MissingProperty } from "./protocol/types";
import { resolve_target_binding } from "./commands/list/suggest";
import { format_details, format_missing } from "./commands/read/command";
import { apply_update } from "./commands/update/command";
import { node_missing_required, property_details } from "./node-state";
import { run_interview, type InterviewSteps } from "./commands/add/interview";

// The required properties a new node still lacks, after `add` or after
// `update <path> <child>`: asked for on a terminal, listed otherwise, and
// described for an AI under --json.

/** The node to complete: `identifier` is how commands name it (a label, `adc/channel@0`), `path` its absolute path. */
export interface NewNode {
    workfile: Workfile;
    base: DeviceTree;
    bindings: Bindings;
    identifier: string;
    path: string;
}

/** The required properties the node still lacks, in the order to set them. */
export async function missing_required_of(node: NewNode): Promise<string[]> {
    const { binding } = await resolve_target_binding(node.identifier, node.workfile.tree, node.base, { ok: true, value: node.bindings });
    return "error" in binding ? [] : node_missing_required(binding, node.workfile.tree, node.path);
}

/** The missing properties with what the binding says about them, for an AI to ask itself. */
export async function describe_missing(node: NewNode, missing: string[]): Promise<MissingProperty[]> {
    const { workfile, base, bindings, identifier } = node;
    const target = await resolve_target_binding(identifier, workfile.tree, base, { ok: true, value: bindings });
    return missing.map(property => {
        const { info, suggestions, others } = property_details(target, workfile.tree, base, identifier, property);
        return {
            property,
            ...(info?.description === undefined ? {} : { description: info.description }),
            suggestions: [...suggestions, ...others],
        };
    });
}

/** The questions are rebuilt each time, so an answer (interrupt-parent) shapes the next one (interrupts). */
function interview_steps({ workfile, base, bindings, identifier }: NewNode): InterviewSteps {
    return {
        ask: async (property) => {
            const target = await resolve_target_binding(identifier, workfile.tree, base, { ok: true, value: bindings });
            const { info, suggestions, others } = property_details(target, workfile.tree, base, identifier, property);
            // Enter takes the first suggestion, never one of the other candidates.
            return { property, details: format_details(info, [...suggestions, ...others], { with_type: true }), suggestions };
        },
        apply: async (property, tokens) => {
            const outcome = await apply_update(workfile, base, bindings, identifier, property, tokens);
            switch (outcome.kind) {
                case "set": { return { ok: true, lines: outcome.detail === undefined ? [outcome.message] : [outcome.message, outcome.detail] }; }
                case "error": { return { ok: false, lines: [outcome.message] }; }
                case "read": { return { ok: false, lines: [`${property} needs a value`] }; }
            }
        },
    };
}

export function missing_lines(identifier: string, missing: string[]): string[] {
    if (missing.length === 0) { return []; }
    return [...format_missing(missing), `Set them with: update ${identifier} <property> <value>`];
}

/**
 * Ask for the `missing` required properties on a terminal (unless `interview`
 * is off), or list them. Human output only; --json uses `describe_missing`.
 */
export async function ask_for_missing(node: NewNode, missing: string[], { interview }: { interview: boolean }): Promise<void> {
    const interactive = interview && process.stdin.isTTY && process.stdout.isTTY;
    if (!interactive || missing.length === 0) {
        for (const line of missing_lines(node.identifier, missing)) { console.log(line); }
        return;
    }

    console.log("");
    await run_interview(missing, interview_steps(node), { input: process.stdin, output: process.stdout, terminal: true });
    console.log("");
    const left = await missing_required_of(node);
    const done = left.length === 0 ? ["All required properties are set."] : missing_lines(node.identifier, left);
    for (const line of done) { console.log(line); }
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("missing_lines — the missing list with how to set them, nothing when complete", () => {
        expect(missing_lines("ad7124_8", ["interrupt-parent", "interrupts"])).toEqual([
            "Missing required: interrupt-parent, interrupts",
            "Set them with: update ad7124_8 <property> <value>",
        ]);
        expect(missing_lines("adc/channel@0", ["diff-channels"])).toEqual([
            "Missing required: diff-channels",
            "Set them with: update adc/channel@0 <property> <value>",
        ]);
        expect(missing_lines("ad7124_8", [])).toEqual([]);
    });
}
