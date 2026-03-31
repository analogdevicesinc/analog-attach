import { buildCommand } from "@stricli/core";
import { Attach, AttachEnumType, create_cell_array, create_flag, create_string_array, insert_known_structures, mergeDocument, mergeDtso, parse_dts, parseDtso, printDts, printDtso, query_devicetree, search_node_in_dts, search_node_in_unresolved_overlays, type CellArrayString, type DtsNode } from "attach-lib";

import * as fs from 'node:fs';

import { bigIntReplacer, find_binding, parse_dts_node } from "../../utilities";

// set-prop --property compatible --value adi,ad7124-8
// set-prop --property compatible --value [adi,ad7124-8; adi,ad7124-4]
// set-prop --property reg --value 0
// set-prop --property reg --value [0; 1]
// set-prop --property reg --value [0; 1], [1; 2]
// set-prop --property interrupts --value [25; IRQ_FALLING_EDGE]
// set-prop --property refin1-supply --value 5regulator
// subnodes??????????????????????????????????


type Flags = {
    linux: string,
    dtSchema: string,
    context: string,
    node: string,
    input: string,
    property: string,
    value: string,
}

export const set_property_command = buildCommand({
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
            },
            value: {
                kind: "parsed",
                parse: String,
                brief: "Value to be set"
            }
        }
    },
    docs: {
        brief: "Set the value of a property in a node in a dtso"
    },
    async func(flags: Flags) {
        const { linux, dtSchema, context, node, input, property, value } = flags;

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

        // TODO: make context optional always
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

        const attach = Attach.new();

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

        const property_binding_definition = binding.parsed_binding.properties.find((entry) => entry.key === property);

        if (property_binding_definition === undefined) {
            console.log(`Couldn't find ${property} in ${compatible_value} binding`);
            return;
        }

        const parsed_value = parse_value(value);

        if (Array.isArray(parsed_value)) {
            const target_property = found_node.properties.find((entry) => entry.name === property);

            switch (property_binding_definition.value._t) {
                case "array": {
                    const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                        (entry) => {
                            return typeof entry === "bigint" ? entry : { value: entry, type: "EXPRESSION" };
                        }
                    );

                    if (target_property === undefined) {
                        if (typeof parsed_value === 'bigint') {
                            found_node.properties.push(create_cell_array(property, parsed_value));
                            break;
                        }

                        // generic array we don't know anything
                        found_node.properties.push(
                            create_cell_array(property, mapped_value)
                        );
                        break;
                    }

                    if (typeof parsed_value === 'bigint') {
                        target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                        target_property.modified_by_user = true;
                        break;
                    }

                    target_property.value = structuredClone(
                        create_cell_array(property, mapped_value).value
                    );
                    target_property.modified_by_user = true;
                    break;
                }
                case "number_array": {
                    if (!parsed_value.every((entry) => typeof entry === 'bigint')) {
                        console.log(`Property ${property} in binding demands numbers`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_cell_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "string_array": {
                    if (!parsed_value.every((entry) => typeof entry === 'string')) {
                        console.log(`Property ${property} in binding demands string`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_string_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "enum_array": {
                    const valid_values = property_binding_definition.value.enum;
                    if (!parsed_value.every((entry) => valid_values.includes(entry))) {
                        console.log(`Values for property ${property} are ${JSON.stringify(property_binding_definition.value.enum)}`);
                        return;
                    }

                    if (property_binding_definition.value.minItems > parsed_value.length ||
                        property_binding_definition.value.maxItems < parsed_value.length
                    ) {
                        console.log(`Property ${property} accepts between ${property_binding_definition.value.minItems} and ${property_binding_definition.value.maxItems} items from ${JSON.stringify(property_binding_definition.value.enum)}`);
                        return;
                    }

                    if (target_property === undefined) {

                        if (parsed_value.every((entry) => typeof entry === 'bigint')) {

                            if (property_binding_definition.value.enum_type !== AttachEnumType.NUMBER) {
                                console.log(`Values for property ${property} are ${JSON.stringify(property_binding_definition.value.enum)}`);
                                return;
                            }

                            found_node.properties.push(create_cell_array(property, parsed_value));

                            break;
                        }

                        // ATP ALL CHECKS SHOULD ENSURE CORRECTNESS BUT ITS NOT REFLECTED IN TYPE SYSTEM
                        switch (property_binding_definition.value.enum_type) {
                            case AttachEnumType.PHANDLE: {
                                const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                    (entry) => {
                                        return typeof entry === "bigint" ? entry : { value: entry, type: "PHANDLE" };
                                    }
                                );
                                found_node.properties.push(
                                    create_cell_array(property, mapped_value)
                                );
                                break;
                            }
                            case AttachEnumType.MACRO: {
                                const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                    (entry) => {
                                        return typeof entry === "bigint" ? entry : { value: entry, type: "MACRO" };
                                    }
                                );
                                found_node.properties.push(
                                    create_cell_array(property, mapped_value)
                                );
                                break;
                            }
                            case AttachEnumType.STRING: {
                                const mapped_value: string[] = parsed_value.filter((entry) => typeof entry === "string");
                                found_node.properties.push(create_string_array(property, mapped_value));
                                break;
                            }
                            case AttachEnumType.NUMBER: {
                                // Handled above
                                break;
                            }
                            default: {
                                const _x: never = property_binding_definition.value.enum_type;
                                throw new Error("Failed exhaustive check!");
                            }
                        }
                        break;
                    }

                    if (parsed_value.every((entry) => typeof entry === 'bigint')) {

                        if (property_binding_definition.value.enum_type !== AttachEnumType.NUMBER) {
                            console.log(`Values for property ${property} are ${JSON.stringify(property_binding_definition.value.enum)}`);
                            return;
                        }

                        target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                        target_property.modified_by_user = true;

                        break;
                    }

                    switch (property_binding_definition.value.enum_type) {
                        case AttachEnumType.PHANDLE: {
                            const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                (entry) => {
                                    return typeof entry === "bigint" ? entry : { value: entry, type: "PHANDLE" };
                                }
                            );
                            target_property.value = structuredClone(
                                create_cell_array(property, mapped_value).value
                            );
                            break;
                        }
                        case AttachEnumType.MACRO: {
                            const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                (entry) => {
                                    return typeof entry === "bigint" ? entry : { value: entry, type: "MACRO" };
                                }
                            );
                            target_property.value = structuredClone(
                                create_cell_array(property, mapped_value).value
                            );
                            break;
                        }
                        case AttachEnumType.STRING: {
                            const mapped_value: string[] = parsed_value.filter((entry) => typeof entry === "string");
                            target_property.value = structuredClone(create_string_array(property, mapped_value).value);
                            break;
                        }
                        case AttachEnumType.NUMBER: {
                            // Handled above
                            break;
                        }
                        default: {
                            const _x: never = property_binding_definition.value.enum_type;
                            throw new Error("Failed exhaustive check!");
                        }
                    }
                    break;

                }
                case "fixed_index": {
                    if (property_binding_definition.value.minItems > parsed_value.length ||
                        property_binding_definition.value.maxItems < parsed_value.length
                    ) {
                        console.log(`Property ${property} accepts between ${property_binding_definition.value.minItems} and ${property_binding_definition.value.maxItems} items`);
                        return;
                    }

                    const values: (bigint | string | CellArrayString)[] = [];

                    for (let index = 0; index < property_binding_definition.value.prefixItems.length; index++) {

                        if (index > parsed_value.length - 1) {
                            break;
                        }

                        const current_value = parsed_value[index];
                        const target_definition = property_binding_definition.value.prefixItems[index]!;

                        if (typeof current_value === "bigint") {

                            if (target_definition._t !== "number") {
                                console.log(`Property ${property} doesn't require a number at index ${index}`);
                                return;
                            }

                            values.push(current_value);
                            continue;
                        }

                        if (target_definition._t === 'number') {
                            console.log(`Property ${property} requires a number at index ${index}`);
                            return;
                        }

                        switch (target_definition.enum_type) {
                            case AttachEnumType.PHANDLE: {
                                if (typeof current_value === 'string') {
                                    if (!target_definition.enum.includes(current_value)) {
                                        console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(target_definition.enum)}`);
                                        return;
                                    }

                                    values.push({ value: current_value, type: "PHANDLE" });
                                    break;
                                }
                                throw new Error("Unexpected Type");
                            }
                            case AttachEnumType.MACRO: {
                                if (typeof current_value === 'string') {
                                    if (!target_definition.enum.includes(current_value)) {
                                        console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(target_definition.enum)}`);
                                        return;
                                    }
                                    values.push({ value: current_value, type: "MACRO" });
                                    break;
                                }
                                throw new Error("Unexpected Type");
                            }
                            case AttachEnumType.STRING: {
                                if (typeof current_value === 'string') {
                                    if (!target_definition.enum.includes(current_value)) {
                                        console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(target_definition.enum)}`);
                                        return;
                                    }
                                    values.push(current_value);
                                    break;
                                }
                                throw new Error("Unexpected Type");
                            }
                            case AttachEnumType.NUMBER: {
                                if (typeof current_value === 'bigint') {
                                    if (!target_definition.enum.includes(current_value)) {
                                        console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(target_definition.enum)}`);
                                        return;
                                    }
                                    values.push(current_value);
                                    break;
                                }
                                throw new Error("Unexpected Type");
                            }
                            default: {
                                const _x: never = target_definition.enum_type;
                                throw new Error("Exhaustive check failed!");
                            }
                        }
                    }

                    if (values.every((entry) => typeof entry === 'string')) {
                        if (target_property === undefined) {
                            found_node.properties.push(create_string_array(property, values));
                            break;
                        }

                        target_property.value = structuredClone(create_string_array(property, values).value);
                        target_property.modified_by_user = true;
                        break;
                    }

                    if (values.every((entry) => typeof entry !== 'string')) {
                        if (target_property === undefined) {
                            found_node.properties.push(create_cell_array(property, values));
                            break;
                        }

                        target_property.value = structuredClone(create_cell_array(property, values).value);
                        target_property.modified_by_user = true;
                        break;
                    }

                    break;
                }
                case "matrix": {
                    if (property_binding_definition.value.minItems > 1) {
                        console.log(`Property ${property} requires more values`);
                        return;
                    }

                    const target_definition = property_binding_definition.value.values[0]!;

                    switch (target_definition._t) {
                        case "array": {
                            const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                (entry) => {
                                    return typeof entry === "bigint" ? entry : { value: entry, type: "EXPRESSION" };
                                }
                            );

                            if (target_property === undefined) {
                                if (typeof parsed_value === 'bigint') {
                                    found_node.properties.push(create_cell_array(property, parsed_value));
                                    break;
                                }

                                // generic array we don't know anything
                                found_node.properties.push(
                                    create_cell_array(property, mapped_value)
                                );
                                break;
                            }

                            if (typeof parsed_value === 'bigint') {
                                target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                                target_property.modified_by_user = true;
                                break;
                            }

                            target_property.value = structuredClone(
                                create_cell_array(property, mapped_value).value
                            );
                            target_property.modified_by_user = true;
                            break;
                        }
                        case "number_array": {
                            if (!parsed_value.every((entry) => typeof entry === 'bigint')) {
                                console.log(`Property ${property} in binding demands numbers`);
                                return;
                            }

                            if (target_property === undefined) {
                                found_node.properties.push(create_cell_array(property, parsed_value));
                                break;
                            }

                            target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case "string_array": {
                            if (!parsed_value.every((entry) => typeof entry === 'string')) {
                                console.log(`Property ${property} in binding demands string`);
                                return;
                            }

                            if (target_property === undefined) {
                                found_node.properties.push(create_string_array(property, parsed_value));
                                break;
                            }

                            target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case "enum_array": {
                            const valid_values = target_definition.enum;
                            if (!parsed_value.every((entry) => valid_values.includes(entry))) {
                                console.log(`Values for property ${property} are ${JSON.stringify(target_definition.enum)}`);
                                return;
                            }

                            if (target_definition.minItems > parsed_value.length ||
                                target_definition.maxItems < parsed_value.length
                            ) {
                                console.log(`Property ${property} accepts between ${target_definition.minItems} and ${target_definition.maxItems} items from ${JSON.stringify(target_definition.enum)}`);
                                return;
                            }

                            if (target_property === undefined) {

                                if (parsed_value.every((entry) => typeof entry === 'bigint')) {

                                    if (target_definition.enum_type !== AttachEnumType.NUMBER) {
                                        console.log(`Values for property ${property} are ${JSON.stringify(target_definition.enum)}`);
                                        return;
                                    }

                                    found_node.properties.push(create_cell_array(property, parsed_value));

                                    break;
                                }

                                // ATP ALL CHECKS SHOULD ENSURE CORRECTNESS BUT ITS NOT REFLECTED IN TYPE SYSTEM
                                switch (target_definition.enum_type) {
                                    case AttachEnumType.PHANDLE: {
                                        const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                            (entry) => {
                                                return typeof entry === "bigint" ? entry : { value: entry, type: "PHANDLE" };
                                            }
                                        );
                                        found_node.properties.push(
                                            create_cell_array(property, mapped_value)
                                        );
                                        break;
                                    }
                                    case AttachEnumType.MACRO: {
                                        const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                            (entry) => {
                                                return typeof entry === "bigint" ? entry : { value: entry, type: "MACRO" };
                                            }
                                        );
                                        found_node.properties.push(
                                            create_cell_array(property, mapped_value)
                                        );
                                        break;
                                    }
                                    case AttachEnumType.STRING: {
                                        const mapped_value: string[] = parsed_value.filter((entry) => typeof entry === "string");
                                        found_node.properties.push(create_string_array(property, mapped_value));
                                        break;
                                    }
                                    case AttachEnumType.NUMBER: {
                                        // Handled above
                                        break;
                                    }
                                    default: {
                                        const _x: never = target_definition.enum_type;
                                        throw new Error("Failed exhaustive check!");
                                    }
                                }
                                break;
                            }

                            if (parsed_value.every((entry) => typeof entry === 'bigint')) {

                                if (target_definition.enum_type !== AttachEnumType.NUMBER) {
                                    console.log(`Values for property ${property} are ${JSON.stringify(target_definition.enum)}`);
                                    return;
                                }

                                target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                                target_property.modified_by_user = true;

                                break;
                            }

                            switch (target_definition.enum_type) {
                                case AttachEnumType.PHANDLE: {
                                    const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                        (entry) => {
                                            return typeof entry === "bigint" ? entry : { value: entry, type: "PHANDLE" };
                                        }
                                    );
                                    target_property.value = structuredClone(
                                        create_cell_array(property, mapped_value).value
                                    );
                                    break;
                                }
                                case AttachEnumType.MACRO: {
                                    const mapped_value: (bigint | CellArrayString)[] = parsed_value.map(
                                        (entry) => {
                                            return typeof entry === "bigint" ? entry : { value: entry, type: "MACRO" };
                                        }
                                    );
                                    target_property.value = structuredClone(
                                        create_cell_array(property, mapped_value).value
                                    );
                                    break;
                                }
                                case AttachEnumType.STRING: {
                                    const mapped_value: string[] = parsed_value.filter((entry) => typeof entry === "string");
                                    target_property.value = structuredClone(create_string_array(property, mapped_value).value);
                                    break;
                                }
                                case AttachEnumType.NUMBER: {
                                    // Handled above
                                    break;
                                }
                                default: {
                                    const _x: never = target_definition.enum_type;
                                    throw new Error("Failed exhaustive check!");
                                }
                            }
                            break;

                        }
                        case "fixed_index": {
                            if (target_definition.minItems > parsed_value.length ||
                                target_definition.maxItems < parsed_value.length
                            ) {
                                console.log(`Property ${property} accepts between ${target_definition.minItems} and ${target_definition.maxItems} items`);
                                return;
                            }

                            const values: (bigint | string | CellArrayString)[] = [];

                            for (let index = 0; index < target_definition.prefixItems.length; index++) {

                                if (index > parsed_value.length - 1) {
                                    break;
                                }

                                const current_value = parsed_value[index];
                                const sub_target_definition = target_definition.prefixItems[index]!;

                                if (typeof current_value === "bigint") {

                                    if (sub_target_definition._t !== "number") {
                                        console.log(`Property ${property} doesn't require a number at index ${index}`);
                                        return;
                                    }

                                    values.push(current_value);
                                    continue;
                                }

                                if (sub_target_definition._t === 'number') {
                                    console.log(`Property ${property} requires a number at index ${index}`);
                                    return;
                                }

                                switch (sub_target_definition.enum_type) {
                                    case AttachEnumType.PHANDLE: {
                                        if (typeof current_value === 'string') {
                                            if (!sub_target_definition.enum.includes(current_value)) {
                                                console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(sub_target_definition.enum)}`);
                                                return;
                                            }

                                            values.push({ value: current_value, type: "PHANDLE" });
                                            break;
                                        }
                                        throw new Error("Unexpected Type");
                                    }
                                    case AttachEnumType.MACRO: {
                                        if (typeof current_value === 'string') {
                                            if (!sub_target_definition.enum.includes(current_value)) {
                                                console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(sub_target_definition.enum)}`);
                                                return;
                                            }
                                            values.push({ value: current_value, type: "MACRO" });
                                            break;
                                        }
                                        throw new Error("Unexpected Type");
                                    }
                                    case AttachEnumType.STRING: {
                                        if (typeof current_value === 'string') {
                                            if (!sub_target_definition.enum.includes(current_value)) {
                                                console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(sub_target_definition.enum)}`);
                                                return;
                                            }
                                            values.push(current_value);
                                            break;
                                        }
                                        throw new Error("Unexpected Type");
                                    }
                                    case AttachEnumType.NUMBER: {
                                        if (typeof current_value === 'bigint') {
                                            if (!sub_target_definition.enum.includes(current_value)) {
                                                console.log(`Property ${property} at index ${index} require a value from ${JSON.stringify(sub_target_definition.enum)}`);
                                                return;
                                            }
                                            values.push(current_value);
                                            break;
                                        }
                                        throw new Error("Unexpected Type");
                                    }
                                    default: {
                                        const _x: never = sub_target_definition.enum_type;
                                        throw new Error("Exhaustive check failed!");
                                    }
                                }
                            }

                            if (values.every((entry) => typeof entry === 'string')) {
                                if (target_property === undefined) {
                                    found_node.properties.push(create_string_array(property, values));
                                    break;
                                }

                                target_property.value = structuredClone(create_string_array(property, values).value);
                                target_property.modified_by_user = true;
                                break;
                            }

                            if (values.every((entry) => typeof entry !== 'string')) {
                                if (target_property === undefined) {
                                    found_node.properties.push(create_cell_array(property, values));
                                    break;
                                }

                                target_property.value = structuredClone(create_cell_array(property, values).value);
                                target_property.modified_by_user = true;
                                break;
                            }

                            break;
                        }
                    }

                    break;
                }
                case "boolean":
                case "integer":
                case "enum_integer":
                case "const": {
                    console.log(`Definition in binding for property ${property} requires a singular value`);
                    return;
                }
                case "object": {
                    throw new Error("Not supported");
                }
                case "generic": {
                    throw new Error("Not supported");
                }
                default: {
                    const _x: never = property_binding_definition.value;
                    throw new Error("Exhaustive check failed!");
                }
            }
        } else {
            const target_property = found_node.properties.find((entry) => entry.name === property);

            const definition_type = property_binding_definition.value._t;
            switch (definition_type) {
                case "boolean": {
                    if (typeof parsed_value !== 'boolean') {
                        console.log(`Property ${property} is a flag and can be set to appear with 'true' or disappear with 'false'`);
                        return;
                    }

                    if (target_property !== undefined && parsed_value === false) {
                        found_node.properties = found_node.properties.filter((entry) => entry !== target_property);
                        break;
                    }

                    if (target_property === undefined && parsed_value === true) {
                        found_node.properties.push(create_flag(property));
                        break;
                    }

                    break;
                }
                case "array": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }

                    if (target_property === undefined) {
                        if (typeof parsed_value === 'bigint') {
                            found_node.properties.push(create_cell_array(property, parsed_value));
                            break;
                        }

                        // generic array we don't know anything
                        found_node.properties.push(
                            create_cell_array(property, { value: parsed_value, type: "EXPRESSION" })
                        );
                        break;
                    }

                    if (typeof parsed_value === 'bigint') {
                        target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                        target_property.modified_by_user = true;
                        break;
                    }

                    target_property.value = structuredClone(
                        create_cell_array(property, { value: parsed_value, type: "EXPRESSION" }).value
                    );
                    target_property.modified_by_user = true;
                    break;
                }
                case "number_array": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }
                    if (typeof parsed_value === 'string') {
                        console.log(`Property ${property} in binding demands numbers`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_cell_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "string_array": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }
                    if (typeof parsed_value === 'bigint') {
                        console.log(`Property ${property} in binding demands string`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_string_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "enum_array": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }

                    if (!property_binding_definition.value.enum.includes(parsed_value)) {
                        console.log(`Values for property ${property} are ${JSON.stringify(property_binding_definition.value.enum)}`);
                        return;
                    }

                    if (target_property === undefined) {

                        if (typeof parsed_value === "bigint") {

                            if (property_binding_definition.value.enum_type !== AttachEnumType.NUMBER) {
                                console.log(`Values for property ${property} are ${JSON.stringify(property_binding_definition.value.enum)}`);
                                return;
                            }

                            found_node.properties.push(create_cell_array(property, parsed_value));

                            break;
                        }

                        switch (property_binding_definition.value.enum_type) {
                            case AttachEnumType.PHANDLE: {
                                found_node.properties.push(
                                    create_cell_array(property, { value: parsed_value, type: "PHANDLE" })
                                );
                                break;
                            }
                            case AttachEnumType.MACRO: {
                                found_node.properties.push(
                                    create_cell_array(property, { value: parsed_value, type: "MACRO" })
                                );
                                break;
                            }
                            case AttachEnumType.STRING: {
                                found_node.properties.push(create_string_array(property, parsed_value));
                                break;
                            }
                            case AttachEnumType.NUMBER: {
                                // Handled above
                                break;
                            }
                            default: {
                                const _x: never = property_binding_definition.value.enum_type;
                                throw new Error("Failed exhaustive check!");
                            }
                        }
                        break;
                    }

                    if (typeof parsed_value === "bigint") {

                        if (property_binding_definition.value.enum_type !== AttachEnumType.NUMBER) {
                            console.log(`Values for property ${property} are ${JSON.stringify(property_binding_definition.value.enum)}`);
                            return;
                        }

                        target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                        target_property.modified_by_user = true;

                        break;
                    }

                    switch (property_binding_definition.value.enum_type) {
                        case AttachEnumType.PHANDLE: {
                            target_property.value = structuredClone(
                                create_cell_array(property, { value: parsed_value, type: "PHANDLE" }).value
                            );
                            break;
                        }
                        case AttachEnumType.MACRO: {
                            target_property.value = structuredClone(
                                create_cell_array(property, { value: parsed_value, type: "MACRO" }).value
                            );
                            break;
                        }
                        case AttachEnumType.STRING: {
                            target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                            break;
                        }
                        case AttachEnumType.NUMBER: {
                            // Handled above
                            break;
                        }
                        default: {
                            const _x: never = property_binding_definition.value.enum_type;
                            throw new Error("Failed exhaustive check!");
                        }
                    }
                    break;

                }
                case "fixed_index": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }

                    if (property_binding_definition.value.minItems > 1) {
                        console.log(`Property ${property} requires more than one value`);
                        return;
                    }

                    if (typeof parsed_value === "bigint") {

                        if (property_binding_definition.value.prefixItems[0]?._t !== "number") {
                            console.log(`Property ${property} doesn't require a number`);
                            return;
                        }

                        if (target_property === undefined) {
                            found_node.properties.push(create_cell_array(property, parsed_value));
                            break;
                        }

                        target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                        target_property.modified_by_user = true;
                        break;
                    }

                    const target_definition = property_binding_definition.value.prefixItems[0]!;

                    if (target_definition._t === 'number') {
                        console.log(`Property ${property} requires a number`);
                        return;
                    }

                    switch (target_definition.enum_type) {
                        case AttachEnumType.PHANDLE: {

                            if (target_property === undefined) {
                                found_node.properties.push(create_cell_array(property, { value: parsed_value, type: "PHANDLE" }));
                                break;
                            }

                            target_property.value = structuredClone(create_cell_array(property, { value: parsed_value, type: "PHANDLE" }).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case AttachEnumType.MACRO: {

                            if (target_property === undefined) {
                                found_node.properties.push(create_cell_array(property, { value: parsed_value, type: "MACRO" }));
                                break;
                            }

                            target_property.value = structuredClone(create_cell_array(property, { value: parsed_value, type: "MACRO" }).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case AttachEnumType.STRING: {

                            if (target_property === undefined) {
                                found_node.properties.push(create_string_array(property, parsed_value));
                                break;
                            }

                            target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case AttachEnumType.NUMBER: {
                            throw new Error("?????");
                        }
                        default: {
                            const _x: never = target_definition.enum_type;
                            throw new Error("Exhaustive check failed!");
                        }
                    }
                    break;
                }
                case "matrix": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }

                    if (property_binding_definition.value.minItems > 1) {
                        console.log(`Property ${property} requires more values`);
                        return;
                    }

                    const target_definition = property_binding_definition.value.values[0]!;

                    switch (target_definition._t) {
                        case "array": {
                            if (typeof parsed_value === 'boolean') {
                                console.log(`Property ${property} isn't a flag => can't have boolean values`);
                                return;
                            }

                            if (target_property === undefined) {
                                if (typeof parsed_value === 'bigint') {
                                    found_node.properties.push(create_cell_array(property, parsed_value));
                                    break;
                                }

                                // generic array we don't know anything
                                found_node.properties.push(
                                    create_cell_array(property, { value: parsed_value, type: "EXPRESSION" })
                                );
                                break;
                            }

                            if (typeof parsed_value === 'bigint') {
                                target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                                target_property.modified_by_user = true;
                                break;
                            }

                            target_property.value = structuredClone(
                                create_cell_array(property, { value: parsed_value, type: "EXPRESSION" }).value
                            );
                            target_property.modified_by_user = true;
                            break;
                        }
                        case "number_array": {
                            if (typeof parsed_value === 'boolean') {
                                console.log(`Property ${property} isn't a flag => can't have boolean values`);
                                return;
                            }
                            if (typeof parsed_value === 'string') {
                                console.log(`Property ${property} in binding demands numbers`);
                                return;
                            }

                            if (target_property === undefined) {
                                found_node.properties.push(create_cell_array(property, parsed_value));
                                break;
                            }

                            target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case "string_array": {
                            if (typeof parsed_value === 'boolean') {
                                console.log(`Property ${property} isn't a flag => can't have boolean values`);
                                return;
                            }
                            if (typeof parsed_value === 'bigint') {
                                console.log(`Property ${property} in binding demands string`);
                                return;
                            }

                            if (target_property === undefined) {
                                found_node.properties.push(create_string_array(property, parsed_value));
                                break;
                            }

                            target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                            target_property.modified_by_user = true;
                            break;
                        }
                        case "enum_array": {
                            if (typeof parsed_value === 'boolean') {
                                console.log(`Property ${property} isn't a flag => can't have boolean values`);
                                return;
                            }

                            if (!target_definition.enum.includes(parsed_value)) {
                                console.log(`Values for property ${property} are ${JSON.stringify(target_definition.enum)}`);
                                return;
                            }

                            if (target_property === undefined) {

                                if (typeof parsed_value === "bigint") {

                                    if (target_definition.enum_type !== AttachEnumType.NUMBER) {
                                        console.log(`Values for property ${property} are ${JSON.stringify(target_definition.enum)}`);
                                        return;
                                    }

                                    found_node.properties.push(create_cell_array(property, parsed_value));

                                    break;
                                }

                                switch (target_definition.enum_type) {
                                    case AttachEnumType.PHANDLE: {
                                        found_node.properties.push(
                                            create_cell_array(property, { value: parsed_value, type: "PHANDLE" })
                                        );
                                        break;
                                    }
                                    case AttachEnumType.MACRO: {
                                        found_node.properties.push(
                                            create_cell_array(property, { value: parsed_value, type: "MACRO" })
                                        );
                                        break;
                                    }
                                    case AttachEnumType.STRING: {
                                        found_node.properties.push(create_string_array(property, parsed_value));
                                        break;
                                    }
                                    case AttachEnumType.NUMBER: {
                                        // Handled above
                                        break;
                                    }
                                    default: {
                                        const _x: never = target_definition.enum_type;
                                        throw new Error("Failed exhaustive check!");
                                    }
                                }
                                break;
                            }

                            if (typeof parsed_value === "bigint") {

                                if (target_definition.enum_type !== AttachEnumType.NUMBER) {
                                    console.log(`Values for property ${property} are ${JSON.stringify(target_definition.enum)}`);
                                    return;
                                }

                                target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                                target_property.modified_by_user = true;

                                break;
                            }

                            switch (target_definition.enum_type) {
                                case AttachEnumType.PHANDLE: {
                                    target_property.value = structuredClone(
                                        create_cell_array(property, { value: parsed_value, type: "PHANDLE" }).value
                                    );
                                    break;
                                }
                                case AttachEnumType.MACRO: {
                                    target_property.value = structuredClone(
                                        create_cell_array(property, { value: parsed_value, type: "MACRO" }).value
                                    );
                                    break;
                                }
                                case AttachEnumType.STRING: {
                                    target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                                    break;
                                }
                                case AttachEnumType.NUMBER: {
                                    // Handled above
                                    break;
                                }
                                default: {
                                    const _x: never = target_definition.enum_type;
                                    throw new Error("Failed exhaustive check!");
                                }
                            }
                            break;

                        }
                        case "fixed_index": {
                            if (typeof parsed_value === 'boolean') {
                                console.log(`Property ${property} isn't a flag => can't have boolean values`);
                                return;
                            }

                            if (target_definition.minItems > 1) {
                                console.log(`Property ${property} requires more than one value`);
                                return;
                            }

                            if (typeof parsed_value === "bigint") {

                                if (target_definition.prefixItems[0]?._t !== "number") {
                                    console.log(`Property ${property} doesn't require a number`);
                                    return;
                                }

                                if (target_property === undefined) {
                                    found_node.properties.push(create_cell_array(property, parsed_value));
                                    break;
                                }

                                target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                                target_property.modified_by_user = true;
                                break;
                            }

                            const sub_target_definition = target_definition.prefixItems[0]!;

                            if (sub_target_definition._t === 'number') {
                                console.log(`Property ${property} requires a number`);
                                return;
                            }

                            switch (sub_target_definition.enum_type) {
                                case AttachEnumType.PHANDLE: {

                                    if (target_property === undefined) {
                                        found_node.properties.push(create_cell_array(property, { value: parsed_value, type: "PHANDLE" }));
                                        break;
                                    }

                                    target_property.value = structuredClone(create_cell_array(property, { value: parsed_value, type: "PHANDLE" }).value);
                                    target_property.modified_by_user = true;
                                    break;
                                }
                                case AttachEnumType.MACRO: {

                                    if (target_property === undefined) {
                                        found_node.properties.push(create_cell_array(property, { value: parsed_value, type: "MACRO" }));
                                        break;
                                    }

                                    target_property.value = structuredClone(create_cell_array(property, { value: parsed_value, type: "MACRO" }).value);
                                    target_property.modified_by_user = true;
                                    break;
                                }
                                case AttachEnumType.STRING: {

                                    if (target_property === undefined) {
                                        found_node.properties.push(create_string_array(property, parsed_value));
                                        break;
                                    }

                                    target_property.value = structuredClone(create_string_array(property, parsed_value).value);
                                    target_property.modified_by_user = true;
                                    break;
                                }
                                case AttachEnumType.NUMBER: {
                                    throw new Error("?????");
                                }
                                default: {
                                    const _x: never = sub_target_definition.enum_type;
                                    throw new Error("Exhaustive check failed!");
                                }
                            }
                            break;
                        }
                    }

                    break;
                }
                case "integer": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }
                    if (typeof parsed_value === 'string') {
                        console.log(`Property ${property} in binding demands numbers`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_cell_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "enum_integer": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }
                    if (typeof parsed_value === 'string') {
                        console.log(`Property ${property} in binding demands numbers`);
                        return;
                    }

                    if (!property_binding_definition.value.enum.includes(parsed_value)) {
                        console.log(`Values for property ${property} are: ${JSON.stringify(property_binding_definition.value.enum)}`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_cell_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "const": {
                    if (typeof parsed_value === 'boolean') {
                        console.log(`Property ${property} isn't a flag => can't have boolean values`);
                        return;
                    }
                    if (typeof parsed_value === 'string') {
                        console.log(`Property ${property} in binding demands numbers`);
                        return;
                    }

                    if (typeof parsed_value === 'bigint' && BigInt(property_binding_definition.value.const) !== parsed_value) {
                        console.log(`Value for property ${property} is: ${JSON.stringify(property_binding_definition.value.const)}`);
                        return;
                    }

                    if (typeof parsed_value !== 'bigint' && property_binding_definition.value.const !== parsed_value) {
                        console.log(`Value for property ${property} is: ${JSON.stringify(property_binding_definition.value.const)}`);
                        return;
                    }

                    if (target_property === undefined) {
                        found_node.properties.push(create_cell_array(property, parsed_value));
                        break;
                    }

                    target_property.value = structuredClone(create_cell_array(property, parsed_value).value);
                    target_property.modified_by_user = true;
                    break;
                }
                case "object": {
                    throw new Error("Not supported");
                }
                case "generic": {
                    throw new Error("Not supported");
                }
                default: {
                    const _x: never = definition_type;
                    throw new Error("Exhaustive check failed!");
                }
            }
        }

        fs.writeFileSync(input, printDtso(input_document_merged));
    }
});

/**
 * @param value string to be parsed which comes in form:
 * - single number
 * - single string
 * - if single string is 'true' | 'True' | 'false' | 'False' => boolean
 * - number/string (can be mixed) array separated by ';' and marked with '[' and ']'
 * - array of above mentioned array separated by ','
 */
function parse_value(value: string): boolean | bigint | string | (bigint | string)[] {
    // Trim whitespace
    value = value.trim();

    // If it doesn't start with '[', it's a single value
    if (!value.startsWith('[')) {
        // Try to parse as boolean first
        const lowerValue = value.toLowerCase();
        if (lowerValue === 'true') {
            return true;
        }
        if (lowerValue === 'false') {
            return false;
        }

        // Try to parse as number (for bigint), otherwise return as string
        const numberMatch = value.match(/^-?\d+$/);
        if (numberMatch) {
            return BigInt(value);
        }
        return value;
    }

    // Handle array format [item1; item2; ...] or array of arrays [a; b], [c; d]
    // First check if we have multiple array groups separated by commas
    if (value.includes('],')) {
        // Split into array groups and flatten them
        const result: (bigint | string)[] = [];
        const arrayGroups = value.split(/],\s*\[/);

        for (let index = 0; index < arrayGroups.length; index++) {
            let group = arrayGroups[index];

            if (group === undefined) {
                continue;
            }

            // Clean up brackets - add missing ones back
            if (index === 0) {
                group = group.slice(1); // Remove leading [
            }
            if (index === arrayGroups.length - 1) {
                group = group.slice(0, -1); // Remove trailing ]
            }

            // Parse this group as semicolon-separated values
            const groupValues = group.split(';').map(item => {
                item = item.trim();
                const numberMatch = item.match(/^-?\d+$/);
                if (numberMatch) {
                    return BigInt(item);
                }
                return item;
            });

            result.push(...groupValues);
        }

        return result;
    }

    // Single array format [item1; item2; ...]
    // Remove the brackets
    const content = value.slice(1, -1);

    // Split by semicolon and parse each item
    return content.split(';').map(item => {
        item = item.trim();
        // Try to parse as number, otherwise return as string
        const numberMatch = item.match(/^-?\d+$/);
        if (numberMatch) {
            return BigInt(item);
        }
        return item;
    });
}
