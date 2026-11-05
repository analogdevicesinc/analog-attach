import { creatable_providers } from "attach-lib";
import { answer, command, input_error, refuse, type ListValueArguments, type Outcome, type Session } from "../../../../interface/backend-interface";
import { load_workspace, optional_bindings } from "../../config/workspace";
import type { ListValueResponse } from "../../protocol/types";
import { value_list } from "./data";

export const list_value = command<ListValueArguments, ListValueResponse>({
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
    run({ path: identifier, property, member }, _flags, session) {
        if (member !== undefined) { return Promise.resolve(input_error(`A member is not supported by the linux backend: ${member}`)); }
        return suggest_values(session, identifier, property);
    },
});

/** What `list value <path> <property>` answers, and `update <path> <property> --suggest` too. */
export async function suggest_values(session: Session, identifier: string, property: string): Promise<Outcome<ListValueResponse>> {
    const loaded = load_workspace(session, ["base", "overlay"]);
    if (!loaded.ok) { return loaded.outcome; }
    const { workspace } = loaded;
    // Bindings are optional here: without them the values are just not checked.
    const found = await value_list(identifier, property, workspace.overlay.tree, workspace.base.tree, optional_bindings(workspace));
    if (!found.ok) { return refuse(found.message, { text: found.text ?? found.message }); }
    const { message, suggestions } = found.value;
    // The providers read offers too (READ-036): a node the user can add instead.
    const creatable = creatable_providers(property);
    const lines = suggestions.length === 0 ? [message] : suggestions.map(s => `${s.value}\t${s.display_string}`);
    if (creatable.length > 0) { lines.push(`Or add your own: ${creatable.map(compatible => `${session.program} add ${compatible}`).join(", ")}`); }
    return answer<ListValueResponse>(
        {
            ok: true, message, severity: "info", suggestions,
            ...(creatable.length === 0 ? {} : { can_create: creatable.map(compatible => ({ value: compatible, display_string: `add ${compatible}` })) }),
        },
        () => lines.join("\n"),
    );
}
