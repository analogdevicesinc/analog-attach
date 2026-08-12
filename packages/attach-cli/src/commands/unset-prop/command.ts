import { buildCommand } from "@stricli/core";
import { DeviceTree, DeviceTreeOverlay } from "attach-lib";

import * as fs from 'node:fs';

import { load_config } from "../../config";

type Flags = {
    node: string,
    property: string,
    overlay: string,
    context?: string,
}

export const unset_property_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Target node: label, &label, path, &{path}, or label/child",
            },
            property: {
                kind: "parsed",
                parse: String,
                brief: "Property name to remove",
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso",
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts",
                optional: true,
            },
        }
    },
    docs: {
        brief: "Remove a property set by the overlay from a node in a dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const context = flags.context ?? config.context;
        const { node, property, overlay: input } = flags;

        if (context === undefined) {
            console.log("Missing: --context (no config.toml found)");
            return;
        }

        if (!fs.existsSync(context)) {
            console.log(`Missing: ${context}`);
            return;
        }

        if (!fs.existsSync(input)) {
            console.log(`Missing: ${input} (use "create" to generate a new overlay first)`);
            return;
        }

        const context_content = fs.readFileSync(context, 'utf8');
        const base = DeviceTree.new_from_string(context_content);

        if (typeof base === "string") {
            console.log(`Failed to parse dts ${context}: ${base}`);
            return;
        }

        const input_content = fs.readFileSync(input, 'utf8');
        const overlay = DeviceTreeOverlay.new_from_string(input_content, base);

        if (typeof overlay === "string") {
            console.log(`Failed to parse dtso ${input}: ${overlay}`);
            return;
        }

        const result = unset_overlay_property(overlay, node, property);

        switch (result) {
            case "node-not-found": {
                console.log(`Couldn't find node ${node} in ${input}`);
                return;
            }
            case "property-not-found": {
                console.log(`Couldn't find property ${property} in ${node}`);
                return;
            }
            case "not-in-overlay": {
                console.log(`${property} in ${node} is not set by this overlay`);
                return;
            }
            case "unset": {
                fs.writeFileSync(input, overlay.print());
                console.log(`Unset ${property} in ${node} in ${input}`);
                return;
            }
        }
    }
});

export function unset_overlay_property(
    overlay: DeviceTreeOverlay,
    identifier: string,
    property: string,
): "unset" | "node-not-found" | "property-not-found" | "not-in-overlay" {

    const base = overlay.get_base_dts()!;
    const found = overlay.find_node(identifier);

    if (found === undefined) {
        if (base.resolve_identifier(identifier) !== undefined) {
            return "not-in-overlay";
        }
        return "node-not-found";
    }

    if (found.node.properties.some(p => p.name === property)) {
        overlay.remove_property({ kind: "path", labels: [], path: found.node_path }, property);
        return "unset";
    }

    // Property not in overlay fragment — check if it's base-only
    if (found.is_in_base) {
        const dt_reference = base.get_node_by_path({ kind: "path", labels: [], path: found.node_path })!;
        const base_node = base.deref_node(dt_reference);
        if (base_node?.properties.some(p => p.name === property)) {
            return "not-in-overlay";
        }
    }

    return "property-not-found";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_dts = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
        };
    };
};`;

    const overlay_with_status_and_imu = `/dts-v1/;
/plugin/;

&spi0 {
    status = "okay";
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    const overlay_with_status_only = `/dts-v1/;
/plugin/;

&spi0 {
    status = "okay";
};`;

    test("unset_overlay_property - removes overlay-set property, node and children still present", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "spi0", "status");

        expect(result).toBe("unset");

        const output = overlay.print();

        expect(output).toContain("spi0");
        expect(output).toContain("imu1");
    });

    test("unset_overlay_property - removing last overlay property from base node drops the status", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status_only, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "spi0", "status");

        expect(result).toBe("unset");

        const output = overlay.print();

        expect(output).not.toContain('status');
    });

    test("unset_overlay_property - removes property from overlay-added node", () => {
        const overlay_imu_with_extra = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
        spi-max-frequency = <1000000>;
    };
};`;
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_imu_with_extra, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "imu1", "spi-max-frequency");

        expect(result).toBe("unset");

        const output = overlay.print();

        expect(output).not.toContain("spi-max-frequency");
        expect(output).toContain("imu1");
        expect(output).toContain("compatible");
    });

    test("unset_overlay_property - removes overlay override of a base property", () => {
        const base_dts_with_status = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            status = "disabled";
        };
    };
};`;
        const overlay_overrides_status = `/dts-v1/;
/plugin/;

&spi0 {
    status = "okay";
};`;
        const base = DeviceTree.new_from_string(base_dts_with_status);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_overrides_status, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "spi0", "status");

        expect(result).toBe("unset");

        const output = overlay.print();

        expect(output).not.toContain('status = "okay"');
        expect(output).not.toContain('spi0');
    });

    test("unset_overlay_property - returns node-not-found for unknown node", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "nonexistent", "status");

        expect(result).toBe("node-not-found");
    });

    test("unset_overlay_property - returns property-not-found when property absent", () => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "spi0", "clock-frequency");

        expect(result).toBe("property-not-found");
    });

    test("unset_overlay_property - returns not-in-overlay for base-only property", () => {
        const base_dts_with_property = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            clock-names = "core";
        };
    };
};`;
        const base = DeviceTree.new_from_string(base_dts_with_property);
        if (typeof base === "string") { throw new TypeError(base); }

        const overlay = DeviceTreeOverlay.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }

        const result = unset_overlay_property(overlay, "spi0", "clock-names");

        expect(result).toBe("not-in-overlay");
    });
}
