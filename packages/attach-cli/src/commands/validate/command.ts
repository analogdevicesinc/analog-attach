import { Command } from "commander";
import {
    Attach,
    DeviceTree,
    DeviceTreeOverlay,
    is_dt_flag,
    dt_to_validator_input,
    type DTNode,
    type DTProperty,
    type PatternPropertyRule
} from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";
import type { LocalContext } from "../../context";
import type { ValidationError, ValidationResponse } from "../../protocol/types";
import { respond, input_error } from "../../protocol/output";

export function build_validate_command(context_: LocalContext): Command {
    return new Command("validate")
        .description("Validate a device node in a DTSO against its binding")
        .option("--overlay <value>", "Path to the DTSO file containing the node")
        .option("--linux <value>", "Path to Linux repo")
        .option("--dt-schema <value>", "Path to dt-schema repo")
        .option("--context <value>", "The target dts")
        .argument("[path...]", "Path segments to the node to validate (e.g. spi0 imu1, or /soc/spi@7e204000/imu1)")
        .action(async (path_arguments: string[], options) => {
            const config = load_config();
            const linux = options.linux ?? config.linux;
            const dtSchema = options.dtSchema ?? config.dtSchema;
            const context = options.context ?? config.context;
            const input = options.overlay ?? config.overlay;

            if (linux === undefined) {
                if (context_.json) { input_error("Missing: linux (no config.toml found)"); return; }
                console.log("Missing: --linux (no config.toml found)");
                return;
            }

            if (dtSchema === undefined) {
                if (context_.json) { input_error("Missing: dt-schema (no config.toml found)"); return; }
                console.log("Missing: --dt-schema (no config.toml found)");
                return;
            }

            if (context === undefined) {
                if (context_.json) { input_error("Missing: context (no config.toml found)"); return; }
                console.log("Missing: --context (no config.toml found)");
                return;
            }

            if (input === undefined) {
                if (context_.json) { input_error("Missing: overlay (no config.toml found)"); return; }
                console.log("Missing: --overlay (no config.toml found)");
                return;
            }

            if (!fs.existsSync(context)) {
                if (context_.json) { input_error(`Missing: ${context}`); return; }
                console.log(`Missing: ${context}`);
                return;
            }

            if (!fs.existsSync(linux)) {
                if (context_.json) { input_error(`Missing: ${linux}`); return; }
                console.log(`Missing: ${linux}`);
                return;
            }

            if (!fs.existsSync(dtSchema)) {
                if (context_.json) { input_error(`Missing: ${dtSchema}`); return; }
                console.log(`Missing: ${dtSchema}`);
                return;
            }

            if (!fs.existsSync(input)) {
                if (context_.json) { input_error(`Missing: ${input}`); return; }
                console.log(`Missing: ${input}`);
                return;
            }

            const context_content = fs.readFileSync(context, 'utf8');
            const input_content = fs.readFileSync(input, 'utf8');

            const base_dt = DeviceTree.new_from_string(context_content);

            if (typeof base_dt === 'string') {
                if (context_.json) { input_error(`Failed to parse dts ${context}: ${base_dt}`); return; }
                console.log(`Failed to parse dts ${context}: ${base_dt}`);
                return;
            }

            const overlay = DeviceTreeOverlay.new_from_string(input_content, base_dt);

            if (typeof overlay === 'string') {
                if (context_.json) { input_error(`Failed to parse dtso ${input}: ${overlay}`); return; }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            const node_identifier = resolve_positional_path(path_arguments);

            if (node_identifier === undefined) {
                if (context_.json) {
                    respond({ errors: [], warnings: [] } satisfies ValidationResponse);
                    return;
                }
                console.log("No node specified");
                return;
            }

            const searched_node = overlay.find_node(resolve_node_identifier(node_identifier, overlay));

            if (searched_node === undefined) {
                if (context_.json) { input_error(`Couldn't find ${node_identifier} in ${input}`); return; }
                console.log(`Couldn't find ${node_identifier} in ${input}`);
                return;
            }

            const { node: found_node, parent_node } = searched_node;
            const parent = found_node.labels.at(-1) ?? searched_node.node_path;
            const path_segs = node_path_segments(searched_node.node_path);

            const compatible = found_node.properties.find((property) => property.name === "compatible");

            if (compatible === undefined) {
                if (context_.json) {
                    const result = await validate_pattern_matched_child_proto(
                        found_node, parent, parent_node, path_segs, linux, dtSchema, base_dt, context_.json
                    );
                    respond(result);
                    return;
                }
                await validate_pattern_matched_child(
                    found_node, parent, parent_node, node_identifier, input, linux, dtSchema, base_dt, context_.json
                );
                return;
            }

            const compatible_value = extract_compatible_value(compatible);

            if (compatible_value === undefined) {
                if (context_.json) { input_error(`Unexpected value in compatible of ${node_identifier} in ${input}`); return; }
                console.log(`Unexpected value in compatible of ${node_identifier} in ${input}`);
                return;
            }

            const binding_path = await find_binding(linux, dtSchema, compatible_value, context_.json);

            if (binding_path === undefined) {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: path_segs, message: `Failed to find binding for ${compatible_value}` }], warnings: [] } satisfies ValidationResponse);
                    return;
                }
                console.log(`Failed to find binding for ${compatible_value}`);
                return;
            }

            const initial = await Attach.new_populated_binding(binding_path, linux, dtSchema, base_dt, found_node, parent);

            if (initial === undefined) {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: [], message: `Failed to parse binding ${binding_path}` }], warnings: [] } satisfies ValidationResponse);
                    return;
                }
                console.log(`Failed to parse binding ${binding_path}`);
                return;
            }

            const input_data = Object.fromEntries(dt_to_validator_input(found_node, initial.parsed_binding));

            const update = initial.attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

            if (update === undefined) {
                if (context_.json) {
                    respond({ errors: [{ kind: "generic", path: [], message: `Failed to update with set compatible "${compatible_value}" for ${binding_path}` }], warnings: [] } satisfies ValidationResponse);
                    return;
                }
                console.log(`Failed to update with set compatible "${compatible_value}" for ${binding_path}`);
                return;
            }

            if (context_.json) {
                const result: ValidationResponse = {
                    errors: map_validation_errors(update.errors, path_segs),
                    warnings: [],
                };
                respond(result);
                return;
            }

            console.log(JSON.stringify(input_data, bigIntReplacer));

            const binding = {
                parsed_binding: Attach.populate_parsed_binding(update.binding, base_dt, JSON.stringify(input_data, bigIntReplacer), parent),
                patterns: initial.patterns,
            };

            console.log(`============= UPDATED BINDING =============`);
            console.log(JSON.stringify(binding.parsed_binding, bigIntReplacer, 4));
            console.log(`============= VALIDATION ERRORS =============`);
            console.log(JSON.stringify(update.errors));
        });
}

function extract_compatible_value(compatible: DTProperty): string | undefined {
    if (is_dt_flag(compatible.value)) { return; }
    const first = compatible.value[0];
    if (first === undefined || first.kind !== 'string') { return; }
    return first.value;
}

function node_path_segments(node_path: string): string[] {
    return node_path.split("/").filter(s => s.length > 0);
}

function map_validation_errors(errors: any[], node_path: string[]): ValidationError[] {
    return errors.map((error: any) => {
        switch (error._t) {
            case "missing_required": {
                return { kind: "generic" as const, path: node_path, message: `Missing required property: ${error.missing_property}` };
            }
            case "number_limit": {
                return {
                    kind: "generic" as const,
                    path: [...node_path, ...(Array.isArray(error.failed_property) ? error.failed_property as string[] : [String(error.failed_property)])],
                    message: `Value ${error.comparison} ${error.limit}`,
                };
            }
            case "failed_dependency": {
                return { kind: "generic" as const, path: node_path, message: `Property ${error.dependent_property} requires ${error.missing_property}` };
            }
            case "generic": {
                return { kind: "generic" as const, path: node_path, message: error.msg ?? String(error.origin) };
            }
            default: {
                return { kind: "generic" as const, path: node_path, message: JSON.stringify(error) };
            }
        }
    });
}

async function validate_pattern_matched_child_proto(
    found_node: DTNode,
    parent: string,
    parent_node: DTNode | undefined,
    node_path: string[],
    linux: string,
    dtSchema: string,
    base_dt: DeviceTree,
    silent: boolean,
): Promise<ValidationResponse> {
    if (parent_node === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: "Node has no compatible and no parent to check patternProperties against" }], warnings: [] };
    }

    const parent_compatible = parent_node.properties.find((property) => property.name === "compatible");

    if (parent_compatible === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: "Node has no compatible and its parent also has no compatible" }], warnings: [] };
    }

    const parent_compatible_value = extract_compatible_value(parent_compatible);

    if (parent_compatible_value === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: "Unexpected value in compatible of parent node" }], warnings: [] };
    }

    const parent_binding_path = await find_binding(linux, dtSchema, parent_compatible_value, silent);

    if (parent_binding_path === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: `Failed to find binding for ${parent_compatible_value}` }], warnings: [] };
    }

    const parent_attach = Attach.new();
    const parent_binding = await parent_attach.parse_binding(parent_binding_path, linux, dtSchema);

    if (parent_binding === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: `Failed to parse binding ${parent_binding_path}` }], warnings: [] };
    }

    const node_key = found_node.unit_addr ? `${found_node.name}@${found_node.unit_addr}` : found_node.name;
    const matched_pattern = parent_binding.patterns.find((pattern) => new RegExp(pattern).test(node_key));

    if (matched_pattern === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: `Node does not match any patternProperties of ${parent_compatible_value}` }], warnings: [] };
    }

    const rule: PatternPropertyRule | undefined = parent_binding.parsed_binding.pattern_properties?.find(
        (pattern) => pattern.pattern === matched_pattern
    );

    if (rule === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: `Node does not match any patternProperties of ${parent_compatible_value}` }], warnings: [] };
    }

    const partial_input_data = Object.fromEntries(
        dt_to_validator_input(
            found_node,
            { required_properties: rule.required, properties: rule.properties, pattern_properties: undefined, examples: [] }
        )
    );

    rule.properties = Attach.populate_properties(rule.properties, base_dt, JSON.stringify(partial_input_data, bigIntReplacer), parent);

    const input_data = Object.fromEntries(
        dt_to_validator_input(
            found_node,
            { required_properties: rule.required, properties: rule.properties, pattern_properties: undefined, examples: [] }
        )
    );

    const update = parent_attach.update_pattern_binding_by_changes(matched_pattern, JSON.stringify(input_data, bigIntReplacer));

    if (update === undefined) {
        return { errors: [{ kind: "generic", path: node_path, message: `Failed to validate against pattern "${matched_pattern}" of ${parent_compatible_value}` }], warnings: [] };
    }

    return { errors: map_validation_errors(update.errors, node_path), warnings: [] };
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
    silent: boolean,
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

    const parent_binding_path = await find_binding(linux, dtSchema, parent_compatible_value, silent);

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

    rule.properties = Attach.populate_properties(rule.properties, base_dt, JSON.stringify(partial_input_data, bigIntReplacer), parent);

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

    const updated_properties = Attach.populate_properties(update.binding.properties, base_dt, JSON.stringify(input_data, bigIntReplacer), parent);

    console.log(`Validating ${node} as pattern-matched child of ${parent_compatible_value} (pattern: ${matched_pattern})`);
    console.log(`============= UPDATED BINDING =============`);
    console.log(JSON.stringify({ ...update.binding, properties: updated_properties }, bigIntReplacer, 4));
    console.log(`============= VALIDATION ERRORS =============`);
    console.log(JSON.stringify(update.errors));
}

function resolve_positional_path(arguments_: string[]): string | undefined {
    if (arguments_.length === 0) { return undefined; }
    const first = arguments_[0]!;
    if (first.startsWith("/") || first.startsWith("&")) {
        return arguments_.length === 1 ? first : `${first}/${arguments_.slice(1).join("/")}`;
    }
    return arguments_.join("/");
}
