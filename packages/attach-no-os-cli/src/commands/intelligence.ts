import { buildCommand } from "@stricli/core";
import {
    filter_completions,
    get_board_names,
    get_config_keys,
    get_config_value_suggestions,
    get_node_names,
    get_platform_names,
    get_property_names,
    get_schema_paths,
    get_union_value_suggestions,
    get_value_suggestions
} from "../completion/completion";
import { SUGGEST_KINDS } from "../protocol/manifest";
import {
    common_ok,
    type Intelligence,
    type ListIntelligenceResponse,
    type Suggestion,
    type SuggestResponse
} from "../protocol/responses";
import { output, output_error } from "./shared";

/**
 * What each suggestion kind can be given, in order.
 *
 * These are the arguments *after* the kind: `aa suggest path <node>` completes that node's
 * properties. attach-meta walks this list to decide what to complete at each position, and
 * `kind` is what lets it recurse — a `value`'s first argument is itself a `path`, so tabbing
 * through `update <node> <property> --with <tab>` works one segment at a time.
 *
 * Nothing here is required: every kind answers a bare `suggest <kind>` with the widest
 * sensible list, which is what a completion request with an empty line asks for.
 */
const INTELLIGENCE: Intelligence[] = [
    {
        kind: SUGGEST_KINDS.path,
        args: [
            { name: "node", description: "Node whose properties to list; omit for the node names", required: false, kind: SUGGEST_KINDS.path }
        ]
    },
    {
        kind: SUGGEST_KINDS.value,
        args: [
            { name: "node", description: "Node the property belongs to", required: false, kind: SUGGEST_KINDS.path },
            { name: "property", description: "Property being set", required: false, kind: SUGGEST_KINDS.path },
            { name: "member", description: "Union member being set, for a tuple value", required: false }
        ]
    },
    {
        kind: SUGGEST_KINDS.device,
        args: []
    },
    {
        kind: SUGGEST_KINDS.config_field,
        args: [
            { name: "field", description: "Setting whose values to list; omit for the field names", required: false, kind: SUGGEST_KINDS.config_field }
        ]
    },
    { kind: SUGGEST_KINDS.board, args: [] },
    { kind: SUGGEST_KINDS.platform, args: [] }
];

/** `aa list-intelligence` — the suggestion kinds this tool can answer. */
export const listIntelligenceCommand = buildCommand<{ json?: boolean }, []>({
    docs: {
        brief: "List the suggestion kinds 'aa suggest' answers",
        fullDescription: "Describes each kind and the arguments it takes, for completion drivers."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const message = `${INTELLIGENCE.length} suggestion kinds`;
        const response: ListIntelligenceResponse = { ...common_ok(message), intelligence: INTELLIGENCE };

        output(flags, format_intelligence(), response);
    }
});

/**
 * `aa suggest <kind> [args...]` — candidate values for one argument.
 *
 * The token being typed is deliberately *not* an argument: attach-meta filters what comes
 * back by prefix itself, so this returns the whole candidate list for the position and
 * nothing here has to know what has been typed so far.
 */
export const suggestCommand = buildCommand<{ json?: boolean }, string[]>({
    docs: {
        brief: "List candidate values for an argument",
        fullDescription:
            "Answers one suggestion kind (see 'aa list-intelligence'), given the arguments\n" +
            "before the one being completed. The partial token itself is not passed."
    },
    parameters: {
        positional: {
            kind: "array",
            parameter: {
                placeholder: "kind_and_args",
                brief: "Suggestion kind, then the arguments preceding the one being completed",
                parse: String,
                proposeCompletions(partial: string) {
                    return filter_completions(INTELLIGENCE.map(entry => entry.kind), partial);
                }
            }
        },
        flags: {
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags, ...input: string[]) => {
        const [kind, ...args] = input;

        if (!kind) {
            output_error(flags, `No kind given. Available: ${INTELLIGENCE.map(entry => entry.kind).join(", ")}`);
            return;
        }

        const values = suggest(kind, args);
        if (values === undefined) {
            output_error(flags, `Unknown suggestion kind '${kind}'. Available: ${INTELLIGENCE.map(entry => entry.kind).join(", ")}`);
            return;
        }

        const suggestions: Suggestion[] = values.map(value => ({ value }));
        const response: SuggestResponse = {
            ...common_ok(`${suggestions.length} suggestion${suggestions.length === 1 ? "" : "s"}`),
            suggestions
        };

        output(flags, values.join("\n"), response);
    }
});

/**
 * Candidates for one kind, or undefined if the kind is not one of ours.
 *
 * A kind is position-agnostic on purpose: how many arguments came with it is what decides
 * which list to return, because attach-meta looks up a single kind per command and uses it
 * for every positional slot.
 */
function suggest(kind: string, args: string[]): string[] | undefined {
    switch (kind) {
        case SUGGEST_KINDS.path: {
            const [node] = args;
            return node === undefined ? get_node_names() : get_property_names(node);
        }

        case SUGGEST_KINDS.value: {
            const [node, property, member] = args;
            if (node === undefined || property === undefined) {
                return [];
            }

            // A union's value is a tuple, so its second half is completed against the
            // member named in the first.
            return member === undefined
                ? get_value_suggestions(node, property)
                : get_union_value_suggestions(node, property, member);
        }

        case SUGGEST_KINDS.device: {
            return get_schema_paths();
        }

        case SUGGEST_KINDS.config_field: {
            const [field] = args;
            return field === undefined ? get_config_keys() : get_config_value_suggestions(field);
        }

        case SUGGEST_KINDS.board: {
            return get_board_names();
        }

        case SUGGEST_KINDS.platform: {
            return get_platform_names();
        }

        default: {
            return undefined;
        }
    }
}

// ------- FORMATTERS --------

function format_intelligence(): string {
    let out = "";

    for (const entry of INTELLIGENCE) {
        out += `  ${entry.kind}\n`;
        for (const arg of entry.args) {
            out += `      ${arg.name.padEnd(12)}${arg.description}\n`;
        }
    }

    return `${out}\nUse: aa suggest <kind> [args...]`;
}
