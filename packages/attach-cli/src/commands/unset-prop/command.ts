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

        const result = unset_overlay_property(base, overlay, node, property);

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
    base: DeviceTree,
    overlay: DeviceTreeOverlay,
    identifier: string,
    property: string,
): "unset" | "node-not-found" | "property-not-found" | "not-in-overlay" {
    const found = overlay.find_node(identifier);

    const deref_base = () => {
        const reference = base.resolve_identifier(identifier);
        if (reference === undefined) { return; }
        const dt_reference = reference.kind === "path" ? base.get_node_by_path(reference) : base.get_node_by_label(reference);
        return dt_reference === undefined ? undefined : base.deref_node(dt_reference);
    };

    // Before returning node-not-found, check if the property exists only in base
    // (property is in base node but not in overlay) → not-in-overlay.
    if (found === undefined || !found.node.properties.some(p => p.name === property)) {
        if (found !== undefined || base.resolve_identifier(identifier) !== undefined) {
            // Node exists somewhere — check if property is in base only
            const base_node = deref_base();
            if (base_node !== undefined && base_node.properties.some(p => p.name === property)) {
                return "not-in-overlay";
            }
        }

        if (found === undefined) { return "node-not-found"; }

        return "property-not-found";
    }

    const node = found.node;
    const property_ = node.properties.find((p) => p.name === property)!;

    // A property is overlay-owned unless it also exists verbatim in the base node.
    // (An overlay-added child node has is_in_base === false, so all its props are overlay-owned.)
    if (found.is_in_base) {
        const base_node = deref_base();
        if (base_node !== undefined && base_node.properties.some(p => p.name === property)) {
            return "not-in-overlay";
        }
    }

    node.properties = node.properties.filter((p) => p !== property_);

    return "unset";
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const { DeviceTree: DT, DeviceTreeOverlay: DTO_cls } = await import('attach-lib');

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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = unset_overlay_property(base, overlay, "spi0", "status");
        expect(result).toBe("unset");
        const output = overlay.print();
        expect(output).toContain("spi0");
        expect(output).toContain("imu1");
    });

    test("unset_overlay_property - removing last overlay property from base node drops the status", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_status_only, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = unset_overlay_property(base, overlay, "spi0", "status");
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
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_imu_with_extra, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = unset_overlay_property(base, overlay, "imu1", "spi-max-frequency");
        expect(result).toBe("unset");
        const output = overlay.print();
        expect(output).not.toContain("spi-max-frequency");
        expect(output).toContain("imu1");
        expect(output).toContain("compatible");
    });

    test("unset_overlay_property - returns node-not-found for unknown node", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = unset_overlay_property(base, overlay, "nonexistent", "status");
        expect(result).toBe("node-not-found");
    });

    test("unset_overlay_property - returns property-not-found when property absent", () => {
        const base = DT.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = unset_overlay_property(base, overlay, "spi0", "clock-frequency");
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
        const base = DT.new_from_string(base_dts_with_property);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DTO_cls.new_from_string(overlay_with_status_and_imu, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        const result = unset_overlay_property(base, overlay, "spi0", "clock-names");
        expect(result).toBe("not-in-overlay");
    });
}
