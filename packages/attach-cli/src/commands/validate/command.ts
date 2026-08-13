import { buildCommand } from "@stricli/core";
import {
    Attach,
    DeviceTree,
    DeviceTreeOverlay,
    insert_known_structures,
    query_devicetree,
    is_dt_flag,
    dt_to_validator_input,
    type DTNode,
    type DTProperty,
    type PatternPropertyRule
} from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";

type Flags = {
    node: string,
    overlay: string,
    linux?: string,
    dtSchema?: string,
    context?: string,
}

function extract_compatible_value(compatible: DTProperty): string | undefined {
    if (is_dt_flag(compatible.value)) { return; }
    const first = compatible.value[0];
    if (first === undefined || first.kind !== 'string') { return; }
    return first.value;
}

async function validate_pattern_matched_child(
    found_node: DTNode,
    parent: string,
    parent_node: DTNode | undefined,
    node: string,
    input: string,
    linux: string,
    dtSchema: string,
    base_dt: DeviceTree,
): Promise<void> {

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

    const node_key = found_node.unit_addr ? `${found_node.name}@${found_node.unit_addr}` : found_node.name;

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

    const partial_input_data = Object.fromEntries(
        dt_to_validator_input(
            found_node,
            {
                required_properties: rule.required,
                properties: rule.properties,
                pattern_properties: undefined,
                examples: []
            }
        )
    );

    rule.properties = query_devicetree(
        base_dt,
        rule.properties,
        JSON.stringify(partial_input_data, bigIntReplacer),
        parent
    );

    rule.properties = insert_known_structures(rule.properties);

    const input_data = Object.fromEntries(
        dt_to_validator_input(
            found_node,
            {
                required_properties: rule.required,
                properties: rule.properties,
                pattern_properties: undefined,
                examples: []
            }
        )
    );

    console.log(JSON.stringify(input_data, bigIntReplacer));

    const update = parent_attach.update_pattern_binding_by_changes(matched_pattern, JSON.stringify(input_data, bigIntReplacer));

    if (update === undefined) {
        console.log(`Failed to validate ${node} against pattern "${matched_pattern}" of ${parent_compatible_value}`);
        return;
    }

    let updated_properties = query_devicetree(
        base_dt,
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
                brief: "Target node to validate: label, &label, path, &{path}, or label/child (e.g. spi0, &spi0, /soc/spi@0, &{/soc/spi@0}, spi0/adi,ad7124-8)"
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
            console.log(`Missing: ${input}`);
            return;
        }

        const context_content = fs.readFileSync(context, 'utf8');
        const input_content = fs.readFileSync(input, 'utf8');

        const base_dt = DeviceTree.new_from_string(context_content);

        if (typeof base_dt === 'string') {
            console.log(`Failed to parse dts ${context}: ${base_dt}`);
            return;
        }

        const overlay = DeviceTreeOverlay.new_from_string(input_content, base_dt);

        if (typeof overlay === 'string') {
            console.log(`Failed to parse dtso ${input}: ${overlay}`);
            return;
        }

        const searched_node = overlay.find_node(resolve_node_identifier(node, overlay));

        if (searched_node === undefined) {
            console.log(`Couldn't find ${node} in ${input}`);
            return;
        }

        const { node: found_node, parent_node } = searched_node;
        const parent = found_node.labels.at(-1) ?? searched_node.node_path;

        const compatible = found_node.properties.find((property) => property.name === "compatible");

        if (compatible === undefined) {
            await validate_pattern_matched_child(
                found_node, parent, parent_node, node, input, linux, dtSchema, base_dt
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
            console.log(`Failed to find binding for ${compatible_value}`);
            return;
        }

        let attach = Attach.new();

        let binding = await attach.parse_binding(binding_path, linux, dtSchema);

        if (binding === undefined) {
            console.log(`Failed to parse binding ${binding_path}`);
            return;
        }

        const partial_input_data = Object.fromEntries(dt_to_validator_input(found_node, binding.parsed_binding));

        const extended_binding = structuredClone(binding);

        extended_binding.parsed_binding.properties = query_devicetree(
            base_dt,
            binding.parsed_binding.properties,
            JSON.stringify(partial_input_data, bigIntReplacer),
            parent
        );

        extended_binding.parsed_binding.properties = insert_known_structures(extended_binding.parsed_binding.properties);

        for (const pattern of extended_binding.parsed_binding.pattern_properties ?? []) {
            pattern.properties = query_devicetree(
                base_dt,
                pattern.properties,
                JSON.stringify(partial_input_data, bigIntReplacer),
                parent
            );

            pattern.properties = insert_known_structures(pattern.properties);
        }

        const input_data = Object.fromEntries(dt_to_validator_input(found_node, extended_binding.parsed_binding));
        console.log(JSON.stringify(input_data, bigIntReplacer));

        const update = attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

        if (update === undefined) {
            console.log(`Failed to update with set compatible "${compatible_value}" for ${binding_path}`);
            return;
        }

        binding = { parsed_binding: update.binding, patterns: binding.patterns };

        binding.parsed_binding.properties = query_devicetree(
            base_dt,
            binding.parsed_binding.properties,
            JSON.stringify(input_data, bigIntReplacer),
            parent
        );

        binding.parsed_binding.properties = insert_known_structures(binding.parsed_binding.properties);

        if (binding.parsed_binding.pattern_properties !== undefined) {
            for (const pattern of binding.parsed_binding.pattern_properties) {
                pattern.properties = query_devicetree(
                    base_dt,
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
