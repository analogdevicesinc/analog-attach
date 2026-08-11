import { buildCommand } from "@stricli/core";
import { DeviceTreeOverlay, is_dt_flag, print_property } from "attach-lib";

import * as fs from 'node:fs';


type Flags = {
    node: string,
    property: string,
    overlay: string,
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

        const found = overlay.find_node(node);

        if (found === undefined) {
            console.log(`Couldn't find ${node} in ${input}`);
            return;
        }

        const found_property = found.node.properties.find((p) => p.name === property);

        if (found_property === undefined) {
            console.log(`Couldn't find ${property} in ${node} in ${input}`);
            return;
        }

        // TODO: inconsistent 
        if (is_dt_flag(found_property.value)) {
            console.log("true");
        } else {
            console.log(print_property(found_property, "", 0).trim());
        }
    }
});