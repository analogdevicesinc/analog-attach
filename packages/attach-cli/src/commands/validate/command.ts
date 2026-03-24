import { buildCommand } from "@stricli/core";
import { Attach, parse_dts, parseDtso, type CellArrayElement, type DtsNode, type DtsValue, type DtsValueComponent, type ParsedBinding } from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding } from "../../utilities";

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

        let node_to_validate = input_document.unresolved_overlays.find((value) => value.overlay_node.name === node)?.overlay_node;

        if (node_to_validate === undefined) {
            node_to_validate = input_document.root.children.find((value) => value.name === node);
            if (node_to_validate === undefined) {
                console.log(`Couldn't find ${node} in ${input}`);
                return;
            }
        }

        const compatible = node_to_validate.properties.find((property) => property.name === "compatible");

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

        const input_data = parse_dts_node(node_to_validate, binding.parsed_binding);
        console.log(JSON.stringify(Object.fromEntries(input_data), bigIntReplacer));

        const update = attach.update_binding_by_changes(JSON.stringify(Object.fromEntries(input_data), bigIntReplacer));

        if (update === undefined) {
            console.log(`Failed to update with set compatible "${compatible}" for ${binding_path}`);
            return;
        }

        console.log(`============= UPDATED BINDING =============`);
        console.log(JSON.stringify(update.binding));
        console.log(`============= VALIDATION ERRORS =============`);
        console.log(JSON.stringify(update.errors));
    }
});

function parse_dts_node(node: DtsNode, parsed_binding: ParsedBinding): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const property of node.properties) {
        if (property.name === "status") {
            continue;
        }

        const value = parse_dts_value(property.value);

        const definition = parsed_binding.properties.find((value) => value.key === property.name);

        if (definition === undefined) {
            map.set(property.name, value);
            continue;
        }

        const definition_type = definition.value._t;
        switch (definition_type) {
            case "array":
            case "enum_array":
            case "fixed_index":
            case "number_array":
            case "string_array": {

                if (Array.isArray(value)) {
                    map.set(property.name, value);
                    continue;
                }

                map.set(property.name, [value]);
                continue;
            }
            case "matrix": {

                if (Array.isArray(value)) {

                    if (value.every((entry) => Array.isArray(entry))) {
                        map.set(property.name, value);
                        continue;
                    }

                    map.set(property.name, value.map((entry) => [entry]));
                    continue;
                } else {
                    map.set(property.name, [[value]]);
                    continue;
                }
            }
            case "boolean":
            case "const":
            case "enum_integer":
            case "generic":
            case "integer": {
                map.set(property.name, value);
                continue;
            }
            case "object": {
                // TODO: finish?
                continue;
            }

            default: {
                const _x: never = definition_type;
                throw new Error("Exhaustion check failed!");
            }
        }
    }
    return map;
}

function parse_dts_value(value: DtsValue | undefined): unknown {

    if (value === undefined) {
        return true;
    }

    if (value.components.length === 1 && value.components[0] !== undefined) {
        return parse_dts_value_component(value.components[0]);
    }

    return value.components.map((component) => parse_dts_value_component(component));
}

function parse_dts_value_component(component: DtsValueComponent): string | number[] | (string | bigint)[] {
    const kind = component.kind;

    switch (kind) {
        case "string": {
            return component.value;
        }
        case "ref": {
            return component.ref.kind === "label" ? component.ref.name : component.ref.path;
        }
        case "bytes": {
            return component.bytes.map((byte) => byte.value);
        }
        case "array": {
            return component.elements.map((element) => parse_cell_array_element(element));
        }
        default: {
            const _x: never = kind;
            throw new Error("Exhaustion check failed!");
        }
    }
}

function parse_cell_array_element(element: CellArrayElement): string | bigint {
    const kind = element.item.kind;

    switch (kind) {
        case "number":
        case "u64": {
            return BigInt(element.item.value);
        }
        case "macro": {
            return element.item.value;
        }
        case "ref": {
            return element.item.ref.kind === "label" ? element.item.ref.name : element.item.ref.path;
        }
        case "expression": {
            return element.item.value;
        }
        default: {
            const _x: never = kind;
            throw new Error("Exhaustive check failed!");
        }
    }
}