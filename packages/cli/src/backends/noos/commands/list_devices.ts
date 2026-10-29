import { addable_drivers, list_available_structs, list_eval_boards } from "attach-no-os-lib";
import { answer, command, refuse, type ListDevicesArguments } from "../../../interface/backend-interface";
import { common_ok, type Device, type ListDevicesResponse } from "../protocol/responses";
import { load_context } from "./shared";

/**
 * `list devices`: every schema a node can be created from.
 *
 * "Device" is the protocol's word for "the thing you add". Ours is an eval board, a driver,
 * or a schema, grouped by the module that ships it. `tag` is what carries that distinction,
 * since `key` has to be the exact string `add` takes.
 *
 * The list depends on the workfile: which platform's schemas are available follows from
 * the platform the workfile was created for.
 */
export const list_devices = command<ListDevicesArguments, ListDevicesResponse>({
    docs: {
        brief: "List the devices that can be added: eval boards, drivers, schemas",
        full:
            "Lists every schema available to the current workfile, grouped by kind.\n" +
            "The key of each entry is what 'add <key>' takes. A filter keeps the keys that contain it."
    },
    run({ filter }, _flags, session) {
        const context = load_context(session);
        if (!context.ok) {
            return Promise.resolve(refuse(context.error.message));
        }

        const available = list_available_structs(context.value.workfile);
        if (!available.ok) {
            return Promise.resolve(refuse(available.error.message));
        }

        // Drivers first: `add <driver>` is the one-command way to bring a part in, and
        // bootstrap builds the rest. Then one group per module that ships rulesets, so the
        // tag names the repo a symbol came from (capi, adxl355, ...).
        const drivers = addable_drivers();
        const boards = list_eval_boards();
        const groups: [string, string[]][] = [
            ...(boards.length > 0 ? [["eval boards", boards] as [string, string[]]] : []),
            ...(drivers.ok && drivers.value.length > 0 ? [["drivers", drivers.value] as [string, string[]]] : []),
            ...Object.entries(available.value.by_module),
        ];

        const devices: Device[] = [];
        for (const [tag, keys] of groups) {
            for (const key of keys) {
                if (filter === undefined || key.includes(filter)) {
                    devices.push({ tag, key });
                }
            }
        }

        const message = `${String(devices.length)} schema${devices.length === 1 ? "" : "s"} available`;
        const response: ListDevicesResponse = { ...common_ok(message), devices };
        return Promise.resolve(answer(response, format_devices(devices, session.program, context.value.minimal.platform)));
    }
});

function format_devices(devices: Device[], program: string, platform?: string): string {
    if (devices.length === 0) {
        return "No schemas available.";
    }

    const by_tag = new Map<string, string[]>();
    for (const device of devices) {
        by_tag.set(device.tag, [...by_tag.get(device.tag) ?? [], device.key]);
    }

    let out = "";
    for (const [tag, keys] of by_tag) {
        let label = tag === "platform" && platform !== undefined && platform !== "" ? `platform (${platform})` : tag;
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

    out += `Use: ${program} add <key> [--name <node name>]`;
    return out;
}
