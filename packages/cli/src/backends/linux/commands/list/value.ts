import { answer, command, input_error, refuse, type ListValueArguments } from "../../../../interface/backend-interface";
import { load_workspace, optional_bindings } from "../../config/workspace";
import type { SuggestResponse } from "../../protocol/types";
import { value_list } from "./data";

export const list_value = command<ListValueArguments, SuggestResponse>({
    docs: {
        brief: "Suggest values for a property",
        full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Each value is ready to pass to 'update <path> <property> <value>'. Without the
bindings the values are listed unchecked.`,
        examples: [
            "list value spi0/adi,ad7124-8@0 reg              Values for a property",
            "list value spi0/adi,ad7124-8@0 refin1-supply    Regulators to name",
        ],
    },
    async run({ path: identifier, property, member }, _flags, session) {
        if (member !== undefined) { return input_error(`A member is not supported by the linux backend: ${member}`); }

        const loaded = load_workspace(session, ["base", "overlay"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { workspace } = loaded;
        // Bindings are optional here: without them the values are just not checked.
        const found = await value_list(identifier, property, workspace.overlay.tree, workspace.base.tree, optional_bindings(workspace));
        if (!found.ok) { return refuse(found.message, { text: found.text ?? found.message }); }
        const { message, suggestions } = found.value;
        return answer<SuggestResponse>(
            { ok: true, message, severity: "info", suggestions },
            () => (suggestions.length === 0 ? message : suggestions.map(s => `${s.value}\t${s.display_string}`).join("\n")),
        );
    },
});
