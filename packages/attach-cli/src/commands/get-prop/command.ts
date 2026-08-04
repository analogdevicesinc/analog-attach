import { buildCommand } from "@stricli/core";
import { parseDtso, print_value, search_node_in_dts } from "attach-lib";

import * as fs from 'node:fs';

import { resolve_node_identifier } from "../../utilities";

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

        const found_node = search_node_in_dts(input_document, resolve_node_identifier(input_document, node));

        if (found_node === undefined) {
            console.log(`Couldn't find ${node} in ${input}`);
            return;
        }

        const found_property = found_node.found_node.properties.find((value) => value.name === property);

        if (found_property === undefined) {
            console.log(`Couldn't find ${property} in ${node} in ${input}`);
            return;
        }

        if (found_property.value === undefined) {
            console.log("true");
        } else {
            console.log(print_value(found_property.value));
        }

    }
});