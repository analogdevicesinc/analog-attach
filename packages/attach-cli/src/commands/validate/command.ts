import { Command } from "commander";
import {
    Attach,
    DeviceTree,
    DeviceTreeOverlay,
    is_dt_flag,
    dt_to_validator_input,
    type DTNode,
    type DTProperty,
} from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, resolve_node_identifier, resolve_positional_path } from "../../utilities";
import { resolve_node_binding } from "../../binding-resolution";
import { resolve_config } from "../../resolve-config";
import type { LocalContext } from "../../context";
import type { ValidationError, ValidationResponse } from "../../protocol/types";
import { respond, input_error } from "../../protocol/output";

export function build_validate_command(context_: LocalContext): Command {
    return new Command("validate")
        .description("Validate a device node in a DTSO against its binding")
        .argument("[path...]", "Path segments to the node to validate (e.g. spi0 imu1, or /soc/spi@7e204000/imu1)")
        .action(async (path_arguments: string[], options) => {
            const resolved = resolve_config(context_, ["linux", "dtSchema", "context", "overlay"]);
            if (resolved === undefined) { return; }
            const { linux, dtSchema, context, overlay: input } = resolved.values;

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
                const binding = await resolve_node_binding(found_node, parent_node, parent, base_dt, linux, dtSchema, context_.json);

                if ('error' in binding) {
                    if (context_.json) {
                        respond({ errors: [{ kind: "generic", path: path_segs, message: binding.error }], warnings: [] } satisfies ValidationResponse);
                        return;
                    }
                    console.log(binding.error);
                    return;
                }

                const result = binding.narrow_and_populate(found_node);

                if (result === undefined) {
                    const msg = binding.origin.kind === "pattern"
                        ? `Failed to validate against pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`
                        : `Failed to validate binding`;
                    if (context_.json) {
                        respond({ errors: [{ kind: "generic", path: path_segs, message: msg }], warnings: [] } satisfies ValidationResponse);
                        return;
                    }
                    console.log(msg);
                    return;
                }

                if (context_.json) {
                    respond({ errors: map_validation_errors(result.errors, path_segs), warnings: [] } satisfies ValidationResponse);
                    return;
                }

                if (binding.origin.kind === "pattern") {
                    console.log(`Validating as pattern-matched child of ${binding.origin.parent_compatible} (pattern: ${binding.origin.pattern})`);
                }
                console.log(`============= UPDATED BINDING =============`);
                console.log(JSON.stringify({ properties: result.properties }, bigIntReplacer, 4));
                console.log(`============= VALIDATION ERRORS =============`);
                console.log(JSON.stringify(result.errors));
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


