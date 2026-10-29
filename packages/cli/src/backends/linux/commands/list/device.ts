import { answer, command, type ListDevicesArguments } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import { describe_device } from "../../protocol/binding-to-description";
import type { DeviceDescription, ListDevicesResponse } from "../../protocol/descriptions";
import { device_keys, load_binding } from "./data";

/** The description of a device, as `list devices <compatible>` prints it. */
export function device_lines(device: DeviceDescription): string[] {
    return [
        device.compatible,
        ...(device.title === undefined ? [] : [`  ${device.title}`]),
        ...(device.description === undefined ? [] : [`  ${device.description}`]),
        `  binding: ${device.binding}`,
        `  ${device.properties.length} properties, ${device.children.length} child node patterns`,
    ];
}

/** The compatible the filter names: itself when it is one of the matches, else the only match. */
export function named_device(filter: string | undefined, keys: readonly string[]): string | undefined {
    if (filter === undefined) { return undefined; }
    if (keys.includes(filter)) { return filter; }
    return keys.length === 1 ? keys[0] : undefined;
}

/**
 * `list devices [filter]`: the compatibles that contain the filter. The one
 * device the filter names is described too: the filter is a compatible, or
 * only one compatible contains it (and its binding parses).
 */
export const list_devices = command<ListDevicesArguments, ListDevicesResponse>({
    docs: {
        brief: "List device bindings by compatible string, or describe one",
        full: `Without a filter, every compatible of the Linux tree's bindings. With one,
the compatibles that contain it; when it is a compatible itself, or only one
compatible contains it, that device's binding is described.`,
        examples: [
            "list devices                  All known bindings",
            "list devices adi              Filter by substring",
            "list devices adi,ad7124-8     Describe one device",
        ],
    },
    async run({ filter }, _flags, session) {
        const loaded = load_workspace(session, ["bindings"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { bindings } = loaded.workspace;

        const keys = device_keys(bindings, filter);
        const named = named_device(filter, keys);
        const binding = named === undefined ? undefined : await load_binding(bindings, named);
        const device = named === undefined || binding?.ok !== true ? undefined : describe_device(binding.binding, named, binding.path);

        const response: ListDevicesResponse = {
            ok: true,
            message: device === undefined ? `Found ${keys.length} devices` : `Device ${device.compatible}`,
            severity: "info",
            devices: keys.map(key => ({ key })),
            ...(device === undefined ? {} : { device }),
            names: keys,
        };
        return answer(response, () => (device === undefined ? keys : device_lines(device)).join("\n"));
    },
});

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("device_lines — the compatible, title, description, binding and counts; no title or description when the binding has none", () => {
        const device: DeviceDescription = {
            key: "adi,ad7124-8",
            compatible: "adi,ad7124-8",
            title: "Analog Devices AD7124 ADC",
            binding: "/linux/adi,ad7124.yaml",
            properties: [{ name: "reg", type: { kind: "number", subtype: "int" }, display: "number", required: true }],
            children: [],
        };
        expect(device_lines(device)).toEqual([
            "adi,ad7124-8",
            "  Analog Devices AD7124 ADC",
            "  binding: /linux/adi,ad7124.yaml",
            "  1 properties, 0 child node patterns",
        ]);
    });

    test("named_device — the filter when it is a compatible, else the only match", () => {
        expect(named_device("adi,ad7124-4", ["adi,ad7124-4", "adi,ad7124-4x"])).toBe("adi,ad7124-4");
        expect(named_device("ad7124", ["adi,ad7124-4", "adi,ad7124-8"])).toBeUndefined();
        expect(named_device("7124-8", ["adi,ad7124-8"])).toBe("adi,ad7124-8");
        expect(named_device(undefined, ["adi,ad7124-8"])).toBeUndefined();
        expect(named_device("nope", [])).toBeUndefined();
    });
}
