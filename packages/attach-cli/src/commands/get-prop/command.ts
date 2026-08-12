import { buildCommand } from "@stricli/core";
import { DeviceTreeOverlay, is_dt_flag, print_property } from "attach-lib";

import * as fs from 'node:fs';

type Flags = {
    node: string,
    property: string,
    overlay: string,
}

export function get_property(
    overlay: DeviceTreeOverlay,
    node: string,
    property: string,
): string | "node-not-found" | "property-not-found" {
    const found = overlay.find_node(node);
    if (found === undefined) { return "node-not-found"; }

    const found_property = found.node.properties.find((p) => p.name === property);
    if (found_property === undefined) { return "property-not-found"; }

    // TODO: inconsistent
    if (is_dt_flag(found_property.value)) {
        return "true";
    }
    return print_property(found_property, "", 0).trim();
}

export const get_property_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Target node: label, &label, path, &{path}, or label/child (e.g. spi0, &spi0, /soc/spi@0, &{/soc/spi@0}, spi0/adi,ad7124-8)"
            },
            property: {
                kind: "parsed",
                parse: String,
                brief: "Target property"
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso"
            },
        }
    },
    docs: {
        brief: "Get the value of a property of a node from a DTSO"
    },
    async func(flags: Flags) {
        const { node, overlay: input, property } = flags;

        const input_content = fs.readFileSync(input, 'utf8');

        const overlay = DeviceTreeOverlay.new_from_string(input_content);

        if (typeof overlay === "string") {
            console.log(`Failed to parse dtso ${input}: ${overlay}`);
            return;
        }

        const result = get_property(overlay, node, property);

        switch (result) {
            case "node-not-found": {
                console.log(`Couldn't find ${node} in ${input}`);
                return;
            }
            case "property-not-found": {
                console.log(`Couldn't find ${property} in ${node} in ${input}`);
                return;
            }
            default: {
                console.log(result);
            }
        }
    }
});

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const overlay_dts = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
        reg = <0>;
        spi-max-frequency = <10000000>;
        adi,bipolar;
    };
};`;

    test("get_property - returns string property value", () => {
        const overlay = DeviceTreeOverlay.new_from_string(overlay_dts);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = get_property(overlay, "imu1", "compatible");

        expect(result).toContain("adi,ad7124-8");
    });

    test("get_property - returns cell array property value", () => {
        const overlay = DeviceTreeOverlay.new_from_string(overlay_dts);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = get_property(overlay, "imu1", "spi-max-frequency");

        expect(result).not.toBe("node-not-found");
        expect(result).not.toBe("property-not-found");
        expect(result).toContain("spi-max-frequency");
    });

    test("get_property - returns 'true' for flag property", () => {
        const overlay = DeviceTreeOverlay.new_from_string(overlay_dts);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = get_property(overlay, "imu1", "adi,bipolar");

        expect(result).toBe("true");
    });

    test("get_property - returns node-not-found for unknown node", () => {
        const overlay = DeviceTreeOverlay.new_from_string(overlay_dts);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = get_property(overlay, "nonexistent", "compatible");

        expect(result).toBe("node-not-found");
    });

    test("get_property - returns property-not-found for unknown property", () => {
        const overlay = DeviceTreeOverlay.new_from_string(overlay_dts);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = get_property(overlay, "imu1", "no-such-prop");

        expect(result).toBe("property-not-found");
    });

    test("get_property - finds node via label/child syntax", () => {
        const overlay_nested = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        channel0: channel@0 {
            reg = <0>;
            label = "temperature";
        };
    };
};`;
        const overlay = DeviceTreeOverlay.new_from_string(overlay_nested);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = get_property(overlay, "imu1/channel@0", "label");

        expect(result).toContain("temperature");
    });
}