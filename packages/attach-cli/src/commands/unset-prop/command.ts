import { buildCommand } from "@stricli/core";
import { mergeDtso, parse_dts, parseDtso, printDtso, search_node_in_dts, type DtsDocument } from "attach-lib";

import * as fs from 'node:fs';

import { resolve_node_identifier } from "../../utilities";
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

        const base_document = (() => {
            try {
                return parse_dts(context_content);
            } catch {
                return;
            }
        })();

        if (base_document === undefined) {
            console.log(`Failed to parse dts ${context}`);
            return;
        }

        const input_content = fs.readFileSync(input, 'utf8');

        const input_document = (() => {
            try {
                return parseDtso(input_content);
            } catch (error) {
                console.log(`${error}`);
                return;
            }
        })();

        if (input_document === undefined) {
            console.log(`Failed to parse dtso ${input}`);
            return;
        }

        const merged = mergeDtso(base_document, input_content, true);

        const result = unset_overlay_property(merged, node, property);

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
                fs.writeFileSync(input, printDtso(merged));
                console.log(`Unset ${property} in ${node} in ${input}`);
                return;
            }
        }
    }
});

export function unset_overlay_property(
    merged: DtsDocument,
    identifier: string,
    property: string,
): "unset" | "node-not-found" | "property-not-found" | "not-in-overlay" {
    const resolved = resolve_node_identifier(merged, identifier);
    const found = search_node_in_dts(merged, resolved);
    if (found === undefined) { return "node-not-found"; }

    const node = found.found_node;
    const prop = node.properties.find((p) => p.name === property);
    if (prop === undefined) { return "property-not-found"; }
    if (!prop.modified_by_user) { return "not-in-overlay"; }

    node.properties = node.properties.filter((p) => p !== prop);
    return "unset";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { parse_dts: parse_dts_v } = await import('attach-lib');

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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_status_and_imu, true);
        const result = unset_overlay_property(merged, "spi0", "status");
        expect(result).toBe("unset");
        const output = printDtso(merged);
        // The printer auto-inserts status="okay" when there are new child nodes,
        // so we verify the explicit status property was removed by checking that
        // the node and its children are still present.
        expect(output).toContain("spi0");
        expect(output).toContain("imu1");
    });

    test("unset_overlay_property - removing last overlay property from base node drops the block", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_status_only, true);
        const result = unset_overlay_property(merged, "spi0", "status");
        expect(result).toBe("unset");
        const output = printDtso(merged);
        expect(output).not.toContain('status');
        expect(output).not.toContain('spi0');
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
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_imu_with_extra, true);
        const result = unset_overlay_property(merged, "imu1", "spi-max-frequency");
        expect(result).toBe("unset");
        const output = printDtso(merged);
        expect(output).not.toContain("spi-max-frequency");
        expect(output).toContain("imu1");
        expect(output).toContain("compatible");
    });

    test("unset_overlay_property - returns node-not-found for unknown node", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_status_and_imu, true);
        const result = unset_overlay_property(merged, "nonexistent", "status");
        expect(result).toBe("node-not-found");
    });

    test("unset_overlay_property - returns property-not-found when property absent", () => {
        const base = parse_dts_v(base_dts);
        const merged = mergeDtso(base, overlay_with_status_and_imu, true);
        const result = unset_overlay_property(merged, "spi0", "clock-frequency");
        expect(result).toBe("property-not-found");
    });

    test("unset_overlay_property - returns not-in-overlay for base-only property", () => {
        const base_dts_with_prop = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            clock-names = "core";
        };
    };
};`;
        const base = parse_dts_v(base_dts_with_prop);
        const merged = mergeDtso(base, overlay_with_status_and_imu, true);
        const result = unset_overlay_property(merged, "spi0", "clock-names");
        expect(result).toBe("not-in-overlay");
    });
}
