import { buildCommand } from "@stricli/core";
import { Attach, get_node_key, insert_known_structures, mergeDtso, parse_dts, parseDtso, query_devicetree, search_node_in_dts, search_node_in_unresolved_overlays, type CellArrayElement, type DtsDocument, type DtsNode, type DtsProperty, type DtsValue, type DtsValueComponent, type ParsedBinding, type PatternPropertyRule } from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, parse_dts_node } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    node: string,
    overlay: string,
    linux?: string,
    dtSchema?: string,
    context?: string,
}

function extract_compatible_value(compatible: DtsProperty): string | undefined {
    if (compatible.value?.components[0]?.kind === 'string') {
        return compatible.value.components[0].value;
    }

    return;
}

async function validate_pattern_matched_child(arguments_: {
    found_node: DtsNode,
    parent: string,
    parent_node: DtsNode | undefined,
    node: string,
    input: string,
    linux: string,
    dtSchema: string,
    document: DtsDocument,
}): Promise<void> {
    const { found_node, parent, parent_node, node, input, linux, dtSchema, document } = arguments_;

    if (parent_node === undefined) {
        console.log(`${node} has no compatible and no parent to check patternProperties against`);
        return;
    }

    const parent_compatible = parent_node.properties.find((property) => property.name === "compatible");

    if (parent_compatible === undefined) {
        console.log(`Missing compatible in ${node} from ${input}, and its parent also has no compatible`);
        return;
    }

    const parent_compatible_value = extract_compatible_value(parent_compatible);

    if (parent_compatible_value === undefined) {
        console.log(`Unexpected value in compatible of the parent of ${node} in ${input}`);
        return;
    }

    const parent_binding_path = await find_binding(linux, dtSchema, parent_compatible_value);

    if (parent_binding_path === undefined) {
        console.log(`Failed to find binding for ${parent_compatible_value}`);
        return;
    }

    const parent_attach = Attach.new();

    const parent_binding = await parent_attach.parse_binding(parent_binding_path, linux, dtSchema);

    if (parent_binding === undefined) {
        console.log(`Failed to parse binding ${parent_binding_path}`);
        return;
    }

    const node_key = get_node_key(found_node);

    const matched_pattern = parent_binding.patterns.find((pattern) => new RegExp(pattern).test(node_key));

    if (matched_pattern === undefined) {
        console.log(`${node} does not match any patternProperties of ${parent_compatible_value}`);
        return;
    }

    const rule: PatternPropertyRule | undefined = parent_binding.parsed_binding.pattern_properties?.find(
        (pattern) => pattern.pattern === matched_pattern
    );

    if (rule === undefined) {
        console.log(`${node} does not match any patternProperties of ${parent_compatible_value}`);
        return;
    }

    const partial_input_data = Object.fromEntries(parse_dts_node(found_node, { required_properties: rule.required, properties: rule.properties, pattern_properties: undefined, examples: [] }));

    rule.properties = query_devicetree(
        document,
        rule.properties,
        JSON.stringify(partial_input_data, bigIntReplacer),
        parent
    );

    rule.properties = insert_known_structures(rule.properties);

    const input_data = Object.fromEntries(parse_dts_node(found_node, { required_properties: rule.required, properties: rule.properties, pattern_properties: undefined, examples: [] }));
    console.log(JSON.stringify(input_data, bigIntReplacer));

    const update = parent_attach.update_pattern_binding_by_changes(matched_pattern, JSON.stringify(input_data, bigIntReplacer));

    if (update === undefined) {
        console.log(`Failed to validate ${node} against pattern "${matched_pattern}" of ${parent_compatible_value}`);
        return;
    }

    let updated_properties = query_devicetree(
        document,
        update.binding.properties,
        JSON.stringify(input_data, bigIntReplacer),
        parent
    );

    updated_properties = insert_known_structures(updated_properties);

    console.log(`Validating ${node} as pattern-matched child of ${parent_compatible_value} (pattern: ${matched_pattern})`);
    console.log(`============= UPDATED BINDING =============`);
    console.log(JSON.stringify({ ...update.binding, properties: updated_properties }, bigIntReplacer, 4));
    console.log(`============= VALIDATION ERRORS =============`);
    console.log(JSON.stringify(update.errors));
}

export const validate_command = buildCommand({
    parameters: {
        flags: {
            node: {
                kind: "parsed",
                parse: String,
                brief: "Target node name to validate"
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "Path to the DTSO file containing the node"
            },
            linux: {
                kind: "parsed",
                parse: String,
                brief: "Path to Linux repo",
                optional: true,
            },
            dtSchema: {
                kind: "parsed",
                parse: String,
                brief: "Path to dt-schema repo",
                optional: true,
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
        brief: "Validate a device node in a DTSO against its binding"
    },
    async func(flags: Flags) {
        const config = load_config();
        const linux = flags.linux ?? config.linux;
        const dtSchema = flags.dtSchema ?? config.dtSchema;
        const context = flags.context ?? config.context;
        const { node, overlay: input } = flags;

        if (linux === undefined) {
            console.log("Missing: --linux (no config.toml found)");
            return;
        }

        if (dtSchema === undefined) {
            console.log("Missing: --dt-schema (no config.toml found)");
            return;
        }

        if (context === undefined) {
            console.log("Missing: --context (no config.toml found)");
            return;
        }

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

        const { found_node, parent, parent_node } = searched_node;

        const compatible = found_node.properties.find((property) => property.name === "compatible");

        if (compatible === undefined) {
            await validate_pattern_matched_child(
                { found_node, parent, parent_node, node, input, linux, dtSchema, document }
            );
            return;
        }

        const compatible_value = extract_compatible_value(compatible);

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
