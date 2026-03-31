import { buildCommand } from "@stricli/core";
import { parseDtso, print_value, search_node_in_dts } from "attach-lib";

import * as fs from 'node:fs';

type Flags = {
    linux: string,
    dtSchema: string,
    context: string,
    node: string,
    input: string,
    property: string,
}

export const get_property_command = buildCommand({
    parameters: {
        flags: {
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo"
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo"
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts"
            },
            node: {
                kind: "parsed",
                parse: String,
                brief: "Target node"
            },
            input: {
                kind: "parsed",
                parse: String,
                brief: "dtso"
            },
            property: {
                kind: "parsed",
                parse: String,
                brief: "Target property"
            }
        }
    },
    docs: {
        brief: "Set the value of a property of a node from a dtso"
    },
    async func(flags: Flags) {
        const { node, input, property } = flags;

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

        const found_node = search_node_in_dts(input_document, node);

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