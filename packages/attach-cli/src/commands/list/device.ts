import { Attach } from "attach-lib";
import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { find_binding, get_or_build_compat_index } from "../../utilities";
import { respond, input_error } from "../../protocol/output";
import { describe_device } from "../../protocol/binding-to-description";
import type { DeviceDescriptionResponse, ListNamesResponse } from "../../protocol/descriptions";

export async function list_device(context_: LocalContext, arguments_: string[]): Promise<void> {
    const filter = arguments_[0];

    const config = load_config() ?? {};

    const index = await get_or_build_compat_index(config.linux, config.dtSchema);
    if (index === undefined) {
        if (context_.json) { input_error("No compat-index.json found and linux/dt-schema not configured."); return; }
        console.log("No compat-index.json found and linux/dt-schema not configured.");
        return;
    }

    const entries = Object.keys(index.entries);

    if (filter !== undefined) {
        const exact = entries.find(entry => entry === filter);
        if (exact !== undefined && config.linux !== undefined && config.dtSchema !== undefined) {
            const binding_path = await find_binding(config.linux, config.dtSchema, exact, context_.json);
            if (binding_path !== undefined) {
                const binding = await Attach.new().parse_binding(binding_path, config.linux, config.dtSchema);
                if (binding !== undefined) {
                    const device = describe_device(binding.parsed_binding, exact, binding_path);
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
