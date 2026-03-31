import { buildCommand } from "@stricli/core";
import { Attach, insert_known_structures, mergeDtso, parse_dts, parseDtso, query_devicetree, search_node_in_dts, search_node_in_unresolved_overlays, type CellArrayElement, type DtsNode, type DtsValue, type DtsValueComponent, type ParsedBinding } from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, parse_dts_node } from "../../utilities";

type Flags = {
    linux: string,
    dtSchema: string,
    context: string,
    node: string,
    input: string,
}

export const validate_command = buildCommand({
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
                brief: "Compatible string of the desired device binding"
            },
            input: {
                kind: "parsed",
                parse: String,
                brief: "Compatible string of the desired device binding"
            }
        }
    },
    docs: {
        brief: "List available devices in linux repo"
    },
    async func(flags: Flags) {
        const { linux, dtSchema, context, node, input } = flags;

        if (!fs.existsSync(context)) {
            console.log(`Missing: ${context}`);
            return;
        }

        if (!fs.existsSync(linux)) {
            console.log(`Missing: ${linux}`);
            return;
        }

        if (!fs.existsSync(dtSchema)) {
            console.log(`Missing: ${dtSchema}`);
            return;
        }

        if (!fs.existsSync(input)) {
            console.log(`Missing: ${dtSchema}`);
            return;
        }

        const context_content = fs.readFileSync(context, 'utf8');

        const document = (() => {
            try {
                return parse_dts(context_content);
            } catch {
                return;
            }
        })();

        const input_content = fs.readFileSync(input, 'utf8');

        const input_document = (() => {
            try {
                return parseDtso(input_content);
            } catch (error) {
                console.log(`${error}`);
                return;
            }
        })();

        if (document === undefined) {
            console.log(`Failed to parse dts ${context}`);
            return;
        }

        if (input_document === undefined) {
            console.log(`Failed to parse dtso ${input}`);
            return;
        }

        const input_document_merged = mergeDtso(document, input_content, true);
        /* 
                const found_node: { target_node: DtsNode, parent?: string } | undefined = (() => {
                    const node_with_parent = search_node_in_unresolved_overlays(input_document.unresolved_overlays, node);
        
                    if (node_with_parent !== undefined) {
                        return {
                            target_node: node_with_parent.node,
                            parent: node_with_parent.overlay.overlay_target_ref.ref.kind === 'label' ?
                                node_with_parent.overlay.overlay_target_ref.ref.name :
                                node_with_parent.overlay.overlay_target_ref.ref.path
                        };
                    }
        
                    const node_without_parent = search_node_in_dts(input_document, node);
        
                    if (node_without_parent !== undefined) {
                        return { target_node: node_without_parent, parent: "/" };
                    }
        
                    return;
                })();
         */

        const searched_node = search_node_in_dts(input_document_merged, node);

        if (searched_node === undefined) {
            console.log(`Couldn't find ${node} in ${input}`);
            return;
        }

        const { found_node, parent } = searched_node;

        const compatible = found_node.properties.find((property) => property.name === "compatible");

        if (compatible === undefined) {
            console.log(`Missing compatible in ${node} from ${input}`);
            return;
        }

        const compatible_value = (() => {
            if (compatible.value?.components[0]?.kind === 'string') {
                return compatible.value.components[0].value;
            }

            return;
        })();

        if (compatible_value === undefined) {
            console.log(`Unexpected value in compatible of ${node} in ${input}`);
            return;
        }

        const binding_path = await find_binding(linux, dtSchema, compatible_value);

        if (binding_path === undefined) {
            console.log(`Failed to find binding for ${compatible}`);
            return;
        }

        let attach = Attach.new();

        let binding = await attach.parse_binding(binding_path, linux, dtSchema);

        if (binding === undefined) {
            console.log(`Failed to parse binding ${binding_path}`);
            return;
        }

        const partial_input_data = Object.fromEntries(parse_dts_node(found_node, binding.parsed_binding));

        const extended_binding = structuredClone(binding);

        extended_binding.parsed_binding.properties = query_devicetree(
            document,
            binding.parsed_binding.properties,
            JSON.stringify(partial_input_data, bigIntReplacer),
            parent
        );

        extended_binding.parsed_binding.properties = insert_known_structures(extended_binding.parsed_binding.properties);

        for (const pattern of extended_binding.parsed_binding.pattern_properties ?? []) {
            pattern.properties = query_devicetree(
                document,
                pattern.properties,
                JSON.stringify(partial_input_data, bigIntReplacer),
                parent
            );

            pattern.properties = insert_known_structures(pattern.properties);
        }

        const input_data = Object.fromEntries(parse_dts_node(found_node, extended_binding.parsed_binding));
        console.log(JSON.stringify(input_data, bigIntReplacer));

        const update = attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

        if (update === undefined) {
            console.log(`Failed to update with set compatible "${compatible}" for ${binding_path}`);
            return;
        }

        binding = { parsed_binding: update.binding, patterns: binding.patterns };

        binding.parsed_binding.properties = query_devicetree(
            document,
            binding.parsed_binding.properties,
            JSON.stringify(input_data, bigIntReplacer),
            parent
        );

        binding.parsed_binding.properties = insert_known_structures(binding.parsed_binding.properties);

        if (binding.parsed_binding.pattern_properties !== undefined) {
            for (const pattern of binding.parsed_binding.pattern_properties) {
                pattern.properties = query_devicetree(
                    document,
                    pattern.properties,
                    JSON.stringify(input_data, bigIntReplacer),
                    parent
                );
                pattern.properties = insert_known_structures(pattern.properties);
            }
        }

        console.log(`============= UPDATED BINDING =============`);
        console.log(JSON.stringify(binding.parsed_binding, bigIntReplacer, 4));
        console.log(`============= VALIDATION ERRORS =============`);
        console.log(JSON.stringify(update.errors));
    }
});
