import { Attach, Result } from "attach-lib";
import type { LocalContext } from "../../context";
import { load_workspace } from "../../config/workspace";
import { find_binding, get_compat_index } from "../../utilities";
import { respond } from "../../protocol/output";
import { describe_device } from "../../protocol/binding-to-description";
import type { DeviceDescriptionResponse, ListNamesResponse } from "../../protocol/descriptions";

export async function list_device(context_: LocalContext, arguments_: string[]): Promise<void> {
    const filter = arguments_[0];

    const workspace = load_workspace(context_, ["bindings"]);
    if (workspace === undefined) { return; }
    const { linux, dt_schema: dtSchema } = workspace.bindings;

    const index = get_compat_index(workspace.bindings);

    const entries = Object.keys(index.entries);

    if (filter !== undefined) {
        const exact = entries.find(entry => entry === filter);
        if (exact !== undefined) {
            const binding_path = await find_binding(linux, dtSchema, exact);
            if (binding_path !== undefined) {
                const binding = await Attach.parse(binding_path, { linux, dt_schema: dtSchema });
                if (Result.is_ok(binding)) {
                    const device = describe_device(binding.value.parsed_binding, exact, binding_path);
                    if (context_.json) {
                        const response: DeviceDescriptionResponse = {
                            ok: true,
                            message: `Device ${exact}`,
                            severity: "info",
                            device,
                        };
                        respond(response);
                    } else {
                        console.log(`${device.compatible}`);
                        if (device.title !== undefined) { console.log(`  ${device.title}`); }
                        if (device.description !== undefined) { console.log(`  ${device.description}`); }
                        console.log(`  binding: ${device.binding}`);
                        console.log(`  ${device.properties.length} properties, ${device.children.length} child node patterns`);
                    }
                    return;
                }
            }
        }
    }

    const matching = filter === undefined
        ? entries
        : entries.filter(entry => entry.includes(filter));

    if (context_.json) {
        const response: ListNamesResponse = {
            ok: true,
            message: `Found ${matching.length} devices`,
            severity: "info",
            names: matching,
        };
        respond(response);
    } else {
        for (const entry of matching) {
            console.log(entry);
        }
    }
}
