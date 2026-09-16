import { Command } from "commander";
import {
    Attach,
    AttachEnumType,
    DeviceTree,
    DeviceTreeOverlay,
    PropertyBuilder,
    is_dt_flag,
    to_attach_array,
    dt_to_validator_input,
    type AttachArray,
    type CellValue,
    type DTNode,
    type DTProperty,
    type ResolvedProperty,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { bigIntReplacer, find_binding, resolve_node_identifier } from "../../utilities";
import { respond, respond_fail, input_error } from "../../protocol/output";

export function build_update_command(context_: LocalContext): Command {
    return new Command("update")
        .description("Update (upsert) a property value on a node in the overlay")
        .requiredOption("--with <value>", "Value to set (raw string, parsed by the tool)")
        .option("--overlay <value>", "dtso")
        .option("--context <value>", "The target dts")
        .option("--linux <value>", "Path to Linux repo")
        .option("--dt-schema <value>", "Path to dt-schema repo")
        .argument("[path...]", "Path to property: node path segments followed by property name")
        .action(async (path: string[], options) => {
            const config = load_config();
            const context = options.context ?? config.context;
            const input = options.overlay ?? config.overlay;
            const linux = options.linux ?? config.linux;
            const dtSchema = options.dtSchema ?? config.dtSchema;
            const withValue: string = options['with'];

            const full_path = path.join("/");
            const last_slash = full_path.lastIndexOf("/");
            const property_name = last_slash >= 0 ? full_path.slice(last_slash + 1) : "";
            const node_identifier = last_slash > 0
                ? full_path.slice(0, last_slash)
                : last_slash === 0 ? "/" : "";

            if (!property_name || !node_identifier) {
                const message = "Path must include at least a node and a property name";
                if (context_.json) { input_error(message); return; }
                console.log(message);
                return;
            }

            if (input === undefined) {
                if (context_.json) { input_error("Missing: overlay (not configured)"); return; }
                console.log("Missing: --overlay (no config.toml found)");
                return;
            }
            if (context === undefined) {
                if (context_.json) { input_error("Missing: context (not configured)"); return; }
                console.log("Missing: --context (no config.toml found)");
                return;
            }
            if (linux === undefined) {
                if (context_.json) { input_error("Missing: linux (not configured)"); return; }
                console.log("Missing: --linux (no config.toml found)");
                return;
            }
            if (dtSchema === undefined) {
                if (context_.json) { input_error("Missing: dt-schema (not configured)"); return; }
                console.log("Missing: --dt-schema (no config.toml found)");
                return;
            }

            for (const p of [context, linux, dtSchema, input]) {
                if (!fs.existsSync(p)) {
                    if (context_.json) { input_error(`Missing: ${p}`); return; }
                    console.log(`Missing: ${p}`);
                    return;
                }
            }

            const context_content = fs.readFileSync(context, "utf8");
            const input_content = fs.readFileSync(input, "utf8");

            const base_dt = DeviceTree.new_from_string(context_content);
            if (typeof base_dt === "string") {
                if (context_.json) { input_error(`Failed to parse dts: ${base_dt}`); return; }
                console.log(`Failed to parse dts ${context}: ${base_dt}`);
                return;
            }

            const overlay = DeviceTreeOverlay.new_from_string(input_content, base_dt);
            if (typeof overlay === "string") {
                if (context_.json) { input_error(`Failed to parse dtso: ${overlay}`); return; }
                console.log(`Failed to parse dtso ${input}: ${overlay}`);
                return;
            }

            const searched_node = overlay.find_node(resolve_node_identifier(node_identifier, overlay));
            if (searched_node === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${node_identifier} in ${input}`);
                }
                return;
            }

            const { node: found_node } = searched_node;
            const parent = found_node.labels.at(-1) ?? searched_node.node_path;

            const compatible = found_node.properties.find(p => p.name === "compatible");
            if (compatible === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Missing compatible in ${node_identifier}`, severity: "error" });
                } else {
                    console.log(`Missing compatible in ${node_identifier} from ${input}`);
                }
                return;
            }

            const compatible_value = (() => {
                if (is_dt_flag(compatible.value)) { return; }
                const first = compatible.value[0];
                if (first === undefined || first.kind !== "string") { return; }
                return first.value;
            })();

            if (compatible_value === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Unexpected compatible value in ${node_identifier}`, severity: "error" });
                } else {
                    console.log(`Unexpected value in compatible of ${node_identifier} in ${input}`);
                }
                return;
            }

            const binding_path = await find_binding(linux, dtSchema, compatible_value, context_.json);
            if (binding_path === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `No binding found for ${compatible_value}`, severity: "error" });
                } else {
                    console.log(`Failed to find binding for ${compatible_value}`);
                }
                return;
            }

            const initial = await Attach.new_populated_binding(binding_path, linux, dtSchema, base_dt, found_node, parent);
            if (initial === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Failed to parse binding ${binding_path}`, severity: "error" });
                } else {
                    console.log(`Failed to parse binding ${binding_path}`);
                }
                return;
            }

            const input_data = Object.fromEntries(dt_to_validator_input(found_node, initial.parsed_binding));
            const update = initial.attach.update_binding_by_changes(JSON.stringify(input_data, bigIntReplacer));

            if (update === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Failed to update binding for ${compatible_value}`, severity: "error" });
                } else {
                    console.log(`Failed to update with set compatible "${compatible_value}" for ${binding_path}`);
                }
                return;
            }

            const binding = {
                parsed_binding: Attach.populate_parsed_binding(update.binding, base_dt, JSON.stringify(input_data, bigIntReplacer), parent),
                patterns: initial.patterns,
            };

            const property_definition = binding.parsed_binding.properties.find(entry => entry.key === property_name);

            if (property_definition === undefined) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Property ${property_name} not found in ${compatible_value} binding`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${property_name} in ${compatible_value} binding`);
                }
                return;
            }

            const parsed = parse_value(withValue);
            const success = set_property(parsed, found_node, property_name, property_definition);

            if (!success) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Failed to set ${property_name}`, severity: "error" });
                }
                return;
            }

            const printed = overlay.print();
            const test_parse = DeviceTreeOverlay.new_from_string(printed, base_dt);

            if (typeof test_parse === "string") {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Update would produce an unreadable overlay: ${test_parse}`, severity: "error" });
                } else {
                    console.log(`Update would produce an unreadable overlay: ${test_parse}`);
                }
                return;
            }

            fs.writeFileSync(input, printed);

            if (context_.json) {
                respond({ ok: true, message: `Updated ${property_name}`, severity: "info" });
            } else {
                console.log(`Set ${property_name} on ${node_identifier}`);
            }
        });
}

type ParsedInputValue = SingleInput | ArrayInput;
type SingleInput = boolean | bigint | string;
type ArrayInput = (bigint | string)[];

export function parse_value(value: string): ParsedInputValue {
    value = value.trim();

    if (!value.startsWith('[')) {
        const lowerValue = value.toLowerCase();
        if (lowerValue === 'true') { return true; }
        if (lowerValue === 'false') { return false; }
        const numberMatch = value.match(/^-?\d+$/);
        if (numberMatch) { return BigInt(value); }
        return value;
    }

    if (value.includes('],')) {
        const result: (bigint | string)[] = [];
        const arrayGroups = value.split(/],\s*\[/);

        for (let index = 0; index < arrayGroups.length; index++) {
            let group = arrayGroups[index];

            if (group === undefined) { continue; }
            if (index === 0) { group = group.slice(1); }
            if (index === arrayGroups.length - 1) { group = group.slice(0, -1); }

            result.push(...group.split(';').map(item => {
                item = item.trim();
                return /^-?\d+$/.test(item) ? BigInt(item) : item;
            }));
        }

        return result;
    }

    return value.slice(1, -1).split(';').map(item => {
        item = item.trim();
        return /^-?\d+$/.test(item) ? BigInt(item) : item;
    });
}

function upsert_property(found_node: DTNode, property: DTProperty): void {
    const existing = found_node.properties.find(p => p.name === property.name);
    if (existing === undefined) { found_node.properties.push(property); return; }
    existing.value = structuredClone(property.value);
}

function to_cell_value(entry: bigint | string, enum_type: AttachEnumType): CellValue {
    if (typeof entry === "bigint") {
        return PropertyBuilder.tag_number(entry);
    }

    switch (enum_type) {
        case AttachEnumType.PHANDLE: {
            return PropertyBuilder.tag_label(entry);
        }
        case AttachEnumType.MACRO: {
            return PropertyBuilder.tag_expression(entry);
        }
        default: {
            throw new Error(`Unexpected enum_type for string value: ${enum_type}`);
        }
    }
}

export function set_property(
    parsed_value: ParsedInputValue,
    found_node: DTNode,
    property: string,
    definition: ResolvedProperty
): boolean {
    switch (definition.value._t) {
        case "boolean": {
            if (typeof parsed_value !== 'boolean') {
                console.log(`Property ${property} is a flag and can be set to appear with 'true' or disappear with 'false'`);
                return false;
            }

            const existing = found_node.properties.find(p => p.name === property);

            if (existing !== undefined && parsed_value === false) {
                found_node.properties = found_node.properties.filter(p => p !== existing);
            } else if (existing === undefined && parsed_value === true) {
                found_node.properties.push(
                    PropertyBuilder.build_flag()
                        .set_flag()
                        .with_name(property)
                        .build()
                );
            }
            return true;
        }
        case "integer":
        case "enum_integer":
        case "const": {
            if (Array.isArray(parsed_value)) {
                console.log(`Definition in binding for property '${property}' requires a singular value`);
                return false;
            }
            if (typeof parsed_value === 'boolean') {
                console.log(`Property '${property}' isn't a flag => can't have boolean values`);
                return false;
            }
            if (typeof parsed_value === 'string') {
                console.log(`Property ${property} in binding demands numbers`);
                return false;
            }
            if (definition.value._t === 'enum_integer' && !definition.value.enum.includes(parsed_value)) {
                console.log(`Values for property ${property} are: ${JSON.stringify(definition.value.enum)}`);
                return false;
            }
            if (definition.value._t === 'const' && BigInt(definition.value.const) !== parsed_value) {
                console.log(`Value for property ${property} is: ${JSON.stringify(definition.value.const)}`);
                return false;
            }

            upsert_property(
                found_node,
                PropertyBuilder.build_cell_array()
                    .with_tagged_values(
                        PropertyBuilder.tag_number(parsed_value)
                    )
                    .with_name(property)
                    .build()
            );

            return true;
        }
        case "array":
        case "number_array":
        case "string_array":
        case "enum_array":
        case "fixed_index": {
            if (typeof parsed_value === 'boolean') {
                console.log(`Property '${property}' isn't a flag => can't have boolean values`);
                return false;
            }

            const array_definition = to_attach_array(definition);

            if (array_definition === undefined) { throw new Error("Failed cast"); }

            return set_array_property(
                Array.isArray(parsed_value) ? parsed_value : [parsed_value],
                found_node,
                property,
                array_definition
            );
        }
        case "matrix": {
            if (typeof parsed_value === 'boolean') {
                console.log(`Property '${property}' isn't a flag => can't have boolean values`);
                return false;
            }
            if (definition.value.minItems > 1) {
                console.log(`Property ${property} requires more values`);
                return false;
            }

            return set_array_property(
                Array.isArray(parsed_value) ? parsed_value : [parsed_value],
                found_node,
                property,
                definition.value.values[0]!
            );
        }
        case "object": {
            console.log(`Property '${property}' is defined as an object!`);
            return false;
        }
        case "generic": {
            console.log(`Property '${property}' couldn't be interpreted!`);
            return false;
        }
        default: {
            const _x: never = definition.value;
            throw new Error("Exhaustive check failed!");
        }
    }
}

function set_array_property(
    values: ArrayInput,
    found_node: DTNode,
    property: string,
    definition: AttachArray
): boolean {
    switch (definition._t) {
        case "array": {
            const tagged = values.map(element =>
                typeof element === "bigint" ? PropertyBuilder.tag_number(element) : PropertyBuilder.tag_expression(element)
            );

            upsert_property(
                found_node,
                PropertyBuilder.build_cell_array()
                    .with_tagged_values(tagged)
                    .with_name(property)
                    .build()
            );

            return true;
        }
        case "number_array": {
            if (!values.every((element): element is bigint => typeof element === "bigint")) {
                console.log(`Property ${property} in binding demands numbers`);
                return false;
            }

            upsert_property(
                found_node,
                PropertyBuilder.build_cell_array()
                    .with_tagged_values(
                        values.map(element => PropertyBuilder.tag_number(element))
                    )
                    .with_name(property).build()
            );

            return true;
        }
        case "string_array": {
            if (!values.every((element): element is string => typeof element === "string")) {
                console.log(`Property ${property} in binding demands string`);
                return false;
            }

            upsert_property(
                found_node,
                PropertyBuilder.build_string()
                    .with_value(values)
                    .with_name(property)
                    .build()
            );

            return true;
        }
        case "enum_array": {
            if (!values.every(element => definition.enum.includes(element))) {
                console.log(`Values for property ${property} are ${JSON.stringify(definition.enum)}`);
                return false;
            }
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                console.log(`Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items from ${JSON.stringify(definition.enum)}`);
                return false;
            }
            if (values.some(element => typeof element === "bigint") && definition.enum_type !== AttachEnumType.NUMBER) {
                console.log(`Values for property ${property} are ${JSON.stringify(definition.enum)}`);
                return false;
            }

            if (definition.enum_type === AttachEnumType.STRING &&
                values.every((element): element is string => typeof element === 'string')
            ) {
                upsert_property(
                    found_node,
                    PropertyBuilder.build_string()
                        .with_value(values)
                        .with_name(property)
                        .build()
                );
            } else {
                upsert_property(
                    found_node,
                    PropertyBuilder.build_cell_array()
                        .with_tagged_values(
                            values.map(element => to_cell_value(element, definition.enum_type))
                        )
                        .with_name(property).build());
            }
            return true;
        }
        case "fixed_index": {
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                console.log(`Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items`);
                return false;
            }

            const cell_values: CellValue[] = [];
            const string_values: string[] = [];

            for (let index = 0; index < definition.prefixItems.length && index < values.length; index++) {

                const v = values[index]!;
                const item_definition = definition.prefixItems[index]!;

                if (typeof v === "bigint") {
                    if (item_definition._t !== "number") {
                        console.log(`Property ${property} doesn't require a number at index ${index}`);
                        return false;
                    }

                    cell_values.push(PropertyBuilder.tag_number(v));
                } else {
                    if (item_definition._t === "number") {
                        console.log(`Property ${property} requires a number at index ${index}`);
                        return false;
                    }
                    if (!item_definition.enum.includes(v)) {
                        console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(item_definition.enum)}`);
                        return false;
                    }

                    if (item_definition.enum_type === AttachEnumType.STRING) {
                        string_values.push(v);
                    } else {
                        cell_values.push(to_cell_value(v, item_definition.enum_type));
                    }
                }
            }

            if (string_values.length > 0 && cell_values.length === 0) {
                upsert_property(
                    found_node,
                    PropertyBuilder.build_string()
                        .with_value(string_values)
                        .with_name(property)
                        .build()
                );
            } else if (cell_values.length > 0 && string_values.length === 0) {
                upsert_property(
                    found_node,
                    PropertyBuilder.build_cell_array()
                        .with_tagged_values(cell_values)
                        .with_name(property)
                        .build()
                );
            }
            return true;
        }
        default: {
            const _x: never = definition;
            throw new Error("Exhaustive check failed!");
        }
    }
}
