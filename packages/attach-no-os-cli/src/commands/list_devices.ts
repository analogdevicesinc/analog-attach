import { buildCommand } from "@stricli/core";
import { addable_drivers, list_available_structs, list_eval_boards } from "attach-no-os-lib";
import { common_ok, type Device, type ListDevicesResponse } from "../protocol/responses";
import { load_context, output, output_error } from "./shared";

/**
 * `attach-noos list-devices` — every schema a node can be created from.
 *
 * "Device" is attach-meta's word for "the thing you add". Ours is an eval board, a driver,
 * or a schema, grouped by the module that ships it. `tag` is what carries that distinction,
 * since `key` has to be the exact string `add --key` takes.
 *
 * The list depends on the workfile: which platform's schemas are available follows from
 * the platform the workfile was created for.
 */
export const listDevicesCommand = buildCommand<{ json?: boolean; filter?: string }, []>({
    docs: {
        brief: "List the schemas a node can be created from",
        fullDescription:
            "Lists every schema available to the current workfile, grouped by kind.\n" +
            "The key of each entry is what 'attach-noos add --key <key>' takes."
    },
    parameters: {
        positional: { kind: "tuple", parameters: [] },
        flags: {
            filter: { kind: "parsed", brief: "Only list schemas whose key contains this", optional: true, parse: String },
            json: { kind: "boolean", brief: "Output as JSON", optional: true }
        }
    },
    func: async (flags) => {
        const context = load_context();
        if (!context.ok) {
            output_error(flags, context.error.message);
            return;
        }

        const available = list_available_structs(context.value.workfile);
        if (!available.ok) {
            output_error(flags, available.error.message);
            return;
        }

        // Drivers first: `add <driver>` is the one-command way to bring a part in, and
        // bootstrap builds the rest. Then one group per module that ships rulesets, so the
        // tag names the repo a symbol came from (capi, adxl355, ...).
        const drivers = addable_drivers();
        const groups: [string, string[]][] = [
            ...(list_eval_boards().length > 0 ? [["eval boards", list_eval_boards()] as [string, string[]]] : []),
            ...(drivers.ok && drivers.value.length > 0 ? [["drivers", drivers.value] as [string, string[]]] : []),
            ...Object.entries(available.value.by_module),
        ];

        const devices: Device[] = [];
        for (const [tag, keys] of groups) {
            for (const key of keys) {
                if (flags.filter === undefined || key.includes(flags.filter)) {
                    devices.push({ tag, key });
                }
            }
        }

        const message = `${devices.length} schema${devices.length === 1 ? "" : "s"} available`;
        const response: ListDevicesResponse = { ...common_ok(message), devices };

        output(flags, format_devices(devices, context.value.minimal.platform), response);
    }
});

function format_devices(devices: Device[], platform?: string): string {
    if (devices.length === 0) {
        return "No schemas available.";
    }

    const by_tag = new Map<string, string[]>();
    for (const device of devices) {
        by_tag.set(device.tag, [...by_tag.get(device.tag) ?? [], device.key]);
    }

    let out = "";
    for (const [tag, keys] of by_tag) {
        let label = tag === "platform" && platform ? `platform (${platform})` : tag;
        if (tag === "eval boards") {
            label = "eval boards (the part on it, wired: add by name)";
        } else if (tag === "drivers") {
            label = "drivers (a bare part, wired by hand: add by name)";
        }
        out += `  ${label}:\n`;
        for (const key of keys) {
            out += `    ${key}\n`;
        }
        out += "\n";
    }

    out += "Use: attach-noos add --key <key> --name <node name>";
    return out;
}
