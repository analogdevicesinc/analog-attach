import { answer, refuse, type ExtraCommand } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import type { SuggestResponse } from "../../protocol/types";
import { positional_word } from "../../utilities";
import { load_binding, parent_suggestions } from "./data";

/** `list parent <compatible>`: the nodes of the base a device can go under, as `add --parent` takes them. */
export const list_parent: ExtraCommand<Record<never, never>, SuggestResponse> = {
    docs: {
        brief: "List the valid parent buses for a device",
        full: "Each parent is its label (or its path when it has none), ready for 'add <compatible> --parent <parent>', followed by its path.",
        placeholders: { compatible: "compatible" },
        examples: ["list parent adi,ad7124-8"],
    },
    positionals: [
        { name: "compatible", placeholder: "compatible", brief: "The device's compatible string", slot: prior => ({ kind: "extra", command: "list parent", id: "compatible", prior }) },
    ],
    group: "tooling",
    schema: "list-parent.schema.json",
    async run(arguments_, _flags, session) {
        const compatible = positional_word(arguments_, "compatible") ?? "";
        const loaded = load_workspace(session, ["bindings", "base"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { workspace } = loaded;

        const binding = await load_binding(workspace.bindings, compatible);
        if (!binding.ok) {
            if (binding.reason === "parse") { return refuse(binding.message, { text: binding.text }); }
            // No binding: not a refusal, an empty list with a warning (as attach-linux had it).
            return answer<SuggestResponse>({ ok: true, message: binding.message, severity: "warn", suggestions: [] }, binding.text);
        }

        const suggestions = parent_suggestions(workspace.base.tree, binding.binding);
        return answer<SuggestResponse>(
            { ok: true, message: `Found ${suggestions.length} valid parents`, severity: "info", suggestions },
            () => suggestions.map(s => `${s.value}  ${s.display_string ?? ""}`).join("\n"),
        );
    },
};
