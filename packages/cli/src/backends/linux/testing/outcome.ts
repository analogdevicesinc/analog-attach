// What an Outcome prints, for the Linux backend's tests: the text without colours, or the
// JSON response forced (and round-tripped, as the front end prints it).

import type { Outcome } from "../../../interface/backend-interface";
import { big_int_replacer } from "../../../front/output";
import { create_style } from "../../../front/session";

/** The text the front end prints for the outcome (stdout for an answer or a refusal, the message otherwise). */
export function outcome_text(outcome: Outcome<unknown>): string {
    switch (outcome.kind) {
        case "answer":
        case "refused": { return outcome.text(create_style(false)); }
        case "input-error":
        case "cancelled": { return outcome.message; }
    }
}

/** The JSON response of an answer or a refusal, as printed under `--json`. */
export async function outcome_json(outcome: Outcome<unknown>): Promise<unknown> {
    if (outcome.kind === "input-error" || outcome.kind === "cancelled") { throw new Error(`no response: ${outcome.kind} ${outcome.message}`); }
    const response = outcome.kind === "answer"
        ? (typeof outcome.response === "function" ? await (outcome.response as () => unknown)() : outcome.response)
        : outcome.response;
    return JSON.parse(JSON.stringify(response, big_int_replacer)) as unknown;
}
