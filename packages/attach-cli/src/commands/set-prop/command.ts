import { buildCommand } from "@stricli/core";
import {
    Attach,
    AttachEnumType,
    DeviceTree,
    DeviceTreeOverlay,
    PropertyBuilder,
    insert_known_structures,
    query_devicetree,
    is_dt_flag,
    to_attach_array,
    dt_to_validator_input,
    type AttachArray,
    type CellValue,
    type DTNode,
    type DTProperty,
    type ResolvedProperty
} from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, resolve_node_identifier } from "../../utilities";
import { load_config } from "../../config";

// set-prop --property compatible --value adi,ad7124-8
// set-prop --property compatible --value [adi,ad7124-8; adi,ad7124-4]
// set-prop --property reg --value 0
// set-prop --property reg --value [0; 1]
// set-prop --property reg --value [0; 1], [1; 2]
// set-prop --property interrupts --value [25; IRQ_FALLING_EDGE]
// set-prop --property refin1-supply --value 5regulator
// subnodes??????????????????????????????????

type Flags = {
    node: string,
    property: string,
    value: string,
    overlay: string,
    context?: string,
    linux?: string,
    dtSchema?: string,
}

export const set_property_command = buildCommand({
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
            value: {
                kind: "parsed",
                parse: String,
                brief: "Value to be set"
            },
            overlay: {
                kind: "parsed",
                parse: String,
                brief: "dtso"
            },
            context: {
                kind: "parsed",
                parse: String,
                brief: "The target dts",
                optional: true,
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
        }
    },
    docs: {
        brief: "Set the value of a property in a node in a dtso"
    },
    async func(flags: Flags) {
        const config = load_config();
        const linux = flags.linux ?? config.linux;
        const dtSchema = flags.dtSchema ?? config.dtSchema;
        const context = flags.context ?? config.context;
        const { node, overlay: input, property, value } = flags;

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

        const { node: found_node } = searched_node;
        const parent = found_node.labels.at(-1) ?? searched_node.node_path;

        const compatible = found_node.properties.find((property) => property.name === "compatible");

        if (compatible === undefined) {
            console.log(`Missing compatible in ${node} from ${input}`);
            return;
        }

        const compatible_value = (() => {
            if (is_dt_flag(compatible.value)) { return; }
            const first = compatible.value[0];
            if (first === undefined || first.kind !== 'string') { return; }
            return first.value;
        })();

        if (compatible_value === undefined) {
            console.log(`Unexpected value in compatible of ${node} in ${input}`);
            return;
        }

        const binding_path = await find_binding(linux, dtSchema, compatible_value);

        if (binding_path === undefined) {
            console.log(`Failed to find binding for ${compatible_value}`);
            return;
        }

        // TODO: most of this process should be in the lib

        const attach = Attach.new();

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

        const property_binding_definition = binding.parsed_binding.properties.find((entry) => entry.key === property);

        if (property_binding_definition === undefined) {
            console.log(`Couldn't find ${property} in ${compatible_value} binding`);
            return;
        }

        const parsed_value = parse_value(value);

        set_property(parsed_value, found_node, property, property_binding_definition);

        fs.writeFileSync(input, overlay.print());
    }
});

type ParsedInputValue = SingleInput | ArrayInput;
type SingleInput = boolean | bigint | string;
type ArrayInput = (bigint | string)[];

/**
 * @param value string to be parsed which comes in form:
 * - single number
 * - single string
 * - if single string is 'true' | 'True' | 'false' | 'False' => boolean
 * - number/string (can be mixed) array separated by ';' and marked with '[' and ']'
 * - array of above mentioned array separated by ','
 */
function parse_value(value: string): ParsedInputValue {
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

// TODO: ResolvedProperty to DTProperty mapping should be in lib

function set_property(
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
