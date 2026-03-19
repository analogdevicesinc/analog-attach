import { buildCommand } from "@stricli/core";
import { Attach, extract_compatible, insert_known_structures, parse_dts, parseDtso, query_devicetree, type CellArrayElement, type DtsNode, type DtsValue, type DtsValueComponent } from "attach-lib";

import * as fs from 'node:fs';
import path from "node:path";

import { get_all_file_paths } from "../../utilities";

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

        const input_data = parseNodeValues(node_to_validate);
        console.log(JSON.stringify(Object.fromEntries(input_data), bigIntReplacer));

        const update = attach.update_binding_by_changes(JSON.stringify(Object.fromEntries(input_data), bigIntReplacer));

        if (update === undefined) {
            console.log(`Failed to update with set compatible "${compatible}" for ${binding_path}`);
            return;
        }

        console.log(JSON.stringify(update.errors));
    }
});

async function find_binding(linux: string, dtSchema: string, compatible_to_find: string): Promise<string | undefined> {
    const bindings_folder = path.resolve(linux, "Documentation", "devicetree", "bindings");

    if (!fs.existsSync(bindings_folder)) {
        console.log(`Missing ${bindings_folder}`);
        return;
    }

    const all_files = get_all_file_paths(bindings_folder);
    const yaml_files = all_files.filter(file => file.endsWith(".yaml"));

    for (const file of yaml_files) {

        const attach = Attach.new();
        const binding = await attach.parse_binding(file, linux, dtSchema);

        if (binding === undefined) {
            continue;
        }

        const compatible = extract_compatible(binding.parsed_binding);

        if (compatible === undefined) {
            continue;
        }

        for (const entry of compatible) {
            // TODO fix why entry could be undefined
            // arm/actions.yaml
            if (entry !== undefined && entry === compatible_to_find) {
                return file;
            }
        }

    }

    return;
}

function bigIntReplacer(_key: string, value: any): any {
    return typeof value === 'bigint' ? value.toString() : value;
}

function parseNodeValues(node: DtsNode): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const property of node.properties) {
        if (property.name === "status") {
            continue;
        }
        map.set(property.name, property.value ? parseDtsValue(property.value) : true);
    }
    return map;
}

function parseDtsValue(value: DtsValue): unknown {
    if (value.components.length === 1 && value.components[0] !== undefined) {
        return parseValueComponent(value.components[0]);
    }

    return value.components.map((component) => parseValueComponent(component));
}

function parseValueComponent(component: DtsValueComponent): string | number[] | (string | bigint | undefined)[] | undefined {
    switch (component.kind) {
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
            return component.elements.map((element) => parseArrayElement(element));
        }
        default: {
            return;
        }
    }
}

function parseArrayElement(element: CellArrayElement): string | bigint | undefined {
    const { item } = element;

    switch (item.kind) {
        case "number":
        case "u64": {
            return BigInt(item.value);
        }
        case "macro": {
            return item.value;
        }
        case "ref": {
            return item.ref.kind === "label" ? item.ref.name : item.ref.path;
        }
        case "expression": {
            return item.value;
        }
        default: {
            return undefined;
        }
    }
}