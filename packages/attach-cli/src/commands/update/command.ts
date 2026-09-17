import { Command } from "commander";
import {
    AttachEnumType,
    DeviceTree,
    DeviceTreeOverlay,
    PropertyBuilder,
    INTERRUPT_MACROS,
    GPIO_MACROS,
    to_attach_array,
    type AttachArray,
    type CellValue,
    type DTNode,
    type DTProperty,
    type DTLabel,
    type DTPath,
    type FoundNodeResult,
    type ResolvedProperty,
} from "attach-lib";
import * as fs from "node:fs";

import type { LocalContext } from "../../context";
import { load_config } from "../../config";
import { resolve_node_identifier } from "../../utilities";
import { resolve_node_binding } from "../../binding-resolution";
import { respond, respond_fail, input_error, diagnostic } from "../../protocol/output";

export function build_update_command(context_: LocalContext): Command {
    return new Command("update")
        .description("Update (upsert) a property value on an overlay-added node or a base-tree node (writes into an overlay fragment; the base tree is never modified)")
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
            const property_name = last_slash === -1 ? "" : full_path.slice(last_slash + 1);
            const node_identifier = last_slash > 0
                ? full_path.slice(0, last_slash)
                : (last_slash === 0 ? "/" : "");

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

            const target_ref = resolve_node_identifier(node_identifier, overlay);
            const found = overlay.find_node(target_ref);

            const base_ref = target_ref.kind === "path"
                ? base_dt.get_node_by_path(target_ref)
                : base_dt.get_node_by_label(target_ref);

            // A base-tree node is edited by writing into an overlay fragment that
            // targets it; the base tree itself is never modified.
            const is_base_target = (found?.is_in_base ?? false) || (found === undefined && base_ref !== undefined);

            if (found === undefined && !is_base_target) {
                if (context_.json) {
                    respond_fail({ ok: false, message: `Node ${node_identifier} not found`, severity: "error" });
                } else {
                    console.log(`Couldn't find ${node_identifier} in ${input}`);
                }
                return;
            }

            // The node whose compatible/values drive binding resolution: the base node
            // for a base target (its compatible lives there, not in the overlay),
            // otherwise the overlay node we found.
            let binding_node: DTNode | undefined;
            let binding_parent: DTNode | undefined;
            let parent_name = "";

            if (is_base_target && base_ref !== undefined) {
                binding_node = base_dt.deref_node(base_ref);
                const parent_ref = base_dt.get_parent(base_ref);
                binding_parent = parent_ref === undefined ? undefined : base_dt.deref_node(parent_ref);
                parent_name = base_ref.labels.at(-1)?.name ?? base_ref.full_path.path;
            } else if (found !== undefined) {
                binding_node = found.node;
                binding_parent = found.parent_node;
                parent_name = found.node.labels.at(-1) ?? found.node_path;
            }

            // Resolve the binding for type validation. If it can't be resolved, or the
            // property isn't defined by the binding, fall back to writing the value
            // as-is (best-effort typing from the value syntax).
            let property_definition: ResolvedProperty | undefined;

            if (binding_node !== undefined) {
                const binding = await resolve_node_binding(binding_node, binding_parent, parent_name, base_dt, linux, dtSchema, context_.json);

                if ('error' in binding) {
                    diagnostic(`Property ${property_name} written without schema validation: ${binding.error}`);
                } else {
                    const result = binding.narrow_and_populate(binding_node);
                    if (result === undefined) {
                        diagnostic(`Property ${property_name} written without schema validation: failed to narrow binding`);
                    } else {
                        property_definition = result.properties.find(entry => entry.key === property_name);
                        if (property_definition === undefined) {
                            const origin_desc = binding.origin.kind === "compatible"
                                ? `${binding.origin.compatible} binding`
                                : `pattern "${binding.origin.pattern}" of ${binding.origin.parent_compatible}`;
                            diagnostic(`Property ${property_name} not defined by ${origin_desc}; written without schema validation`);
                        }
                    }
                }
            }

            const parsed = parse_value(withValue);

            // Build the property (undefined means "remove", e.g. a boolean set to false).
            let built: DTProperty | undefined;

            if (property_definition !== undefined) {
                const scratch: DTNode = { name: "scratch", unit_addr: undefined, labels: [], properties: [], children: [] };
                const success = set_property(parsed, scratch, property_name, property_definition);
                if (success !== true) {
                    if (context_.json) {
                        respond_fail({ ok: false, message: success, severity: "error" });
                    } else {
                        console.log(success);
                    }
                    return;
                }
                built = scratch.properties.find(p => p.name === property_name);
            } else {
                built = build_untyped_property(parsed, property_name);
            }

            place_property(overlay, target_ref, found, is_base_target, built, property_name);

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

// Write the built property into the overlay. A base-tree target is edited through an
// overlay fragment (created on demand, reused if present); an overlay node is mutated
// in place. `built === undefined` means remove the property (e.g. a boolean set false).
export function place_property(
    overlay: DeviceTreeOverlay,
    target_ref: DTLabel | DTPath,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    built: DTProperty | undefined,
    property_name: string,
): void {
    if (is_base_target) {
        if (built !== undefined) {
            overlay.add_fragment(target_ref, undefined, built);
        } else {
            overlay.remove_property(target_ref, property_name);
        }
        return;
    }

    if (found !== undefined) {
        if (built !== undefined) {
            upsert_property(found.node, built);
        } else {
            found.node.properties = found.node.properties.filter(p => p.name !== property_name);
        }
    }
}

// Best-effort property construction when no binding definition is available:
// infer the DTS shape from the parsed value syntax alone. Returns undefined when
// the property should be removed (a boolean set to false).
export function build_untyped_property(parsed: ParsedInputValue, property: string): DTProperty | undefined {
    if (typeof parsed === "boolean") {
        return parsed
            ? PropertyBuilder.build_flag().set_flag().with_name(property).build()
            : undefined;
    }

    if (typeof parsed === "bigint") {
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(PropertyBuilder.tag_number(parsed))
            .with_name(property)
            .build();
    }

    if (typeof parsed === "string") {
        return PropertyBuilder.build_string()
            .with_value(parsed)
            .with_name(property)
            .build();
    }

    if (parsed.every((element): element is bigint => typeof element === "bigint")) {
        return PropertyBuilder.build_cell_array()
            .with_tagged_values(parsed.map(element => PropertyBuilder.tag_number(element)))
            .with_name(property)
            .build();
    }

    if (parsed.every((element): element is string => typeof element === "string")) {
        return PropertyBuilder.build_string()
            .with_value(parsed)
            .with_name(property)
            .build();
    }

    return PropertyBuilder.build_cell_array()
        .with_tagged_values(
            parsed.map(element =>
                typeof element === "bigint" ? PropertyBuilder.tag_number(element) : PropertyBuilder.tag_expression(element)
            )
        )
        .with_name(property)
        .build();
}

const ALL_MACROS = [...INTERRUPT_MACROS, ...GPIO_MACROS];

function to_cell_value(entry: bigint | string, enum_type: AttachEnumType): CellValue {
    if (typeof entry === "bigint") {
        return PropertyBuilder.tag_number(entry);
    }

    switch (enum_type) {
        case AttachEnumType.PHANDLE: {
            return PropertyBuilder.tag_label(entry);
        }
        case AttachEnumType.MACRO: {
            const resolved = ALL_MACROS.find(m => m.name === entry);
            if (resolved !== undefined) {
                return PropertyBuilder.tag_number(BigInt(resolved.value));
            }
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
): string | true {
    switch (definition.value._t) {
        case "boolean": {
            if (typeof parsed_value !== 'boolean') {
                return `Property ${property} is a flag and can be set to appear with 'true' or disappear with 'false'`;
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
                return `Definition in binding for property '${property}' requires a singular value`;
            }
            if (typeof parsed_value === 'boolean') {
                return `Property '${property}' isn't a flag => can't have boolean values`;
            }
            if (typeof parsed_value === 'string') {
                return `Property ${property} in binding demands numbers`;
            }
            if (definition.value._t === 'enum_integer' && !definition.value.enum.includes(parsed_value)) {
                return `Values for property ${property} are: ${JSON.stringify(definition.value.enum)}`;
            }
            if (definition.value._t === 'const' && BigInt(definition.value.const) !== parsed_value) {
                return `Value for property ${property} is: ${JSON.stringify(definition.value.const)}`;
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
                return `Property '${property}' isn't a flag => can't have boolean values`;
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
                return `Property '${property}' isn't a flag => can't have boolean values`;
            }
            if (definition.value.minItems > 1) {
                return `Property ${property} requires more values`;
            }

            return set_array_property(
                Array.isArray(parsed_value) ? parsed_value : [parsed_value],
                found_node,
                property,
                definition.value.values[0]!
            );
        }
        case "object": {
            return `Property '${property}' is defined as an object!`;
        }
        case "generic": {
            return `Property '${property}' couldn't be interpreted!`;
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
): string | true {
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
                return `Property ${property} in binding demands numbers`;
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
                return `Property ${property} in binding demands string`;
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
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items from ${JSON.stringify(definition.enum)}`;
            }
            if (values.some(element => typeof element === "bigint") && definition.enum_type !== AttachEnumType.NUMBER) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
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
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items`;
            }

            const cell_values: CellValue[] = [];
            const string_values: string[] = [];

            for (let index = 0; index < definition.prefixItems.length && index < values.length; index++) {

                const v = values[index]!;
                const item_definition = definition.prefixItems[index]!;

                if (typeof v === "bigint") {
                    if (item_definition._t !== "number") {
                        return `Property ${property} doesn't require a number at index ${index}`;
                    }

                    cell_values.push(PropertyBuilder.tag_number(v));
                } else {
                    if (item_definition._t === "number") {
                        return `Property ${property} requires a number at index ${index}`;
                    }
                    if (!item_definition.enum.includes(v)) {
                        return `Property ${property} at index ${index} require a value from ${JSON.stringify(item_definition.enum)}`;
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

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const base_dts = `/dts-v1/;
/ {
    soc {
        spi0: spi@7e204000 {
            compatible = "brcm,bcm2835-spi";
        };
    };
};`;

    const empty_overlay = `/dts-v1/;
/plugin/;

/ {
};
`;

    const overlay_with_imu = `/dts-v1/;
/plugin/;

&spi0 {
    imu1: adi,ad7124-8@0 {
        compatible = "adi,ad7124-8";
    };
};`;

    const parse = (overlay_src: string) => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_src, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return { base, overlay };
    };

    test("build_untyped_property - infers shapes from the value syntax", () => {
        expect(build_untyped_property(true, "wakeup-source")?.value).toEqual({ kind: "flag" });
        expect(build_untyped_property(false, "wakeup-source")).toBeUndefined();

        const num = build_untyped_property(5000000n, "spi-max-frequency");
        expect(num?.value).toMatchObject([{ kind: "array" }]);

        const str = build_untyped_property("okay", "status");
        expect(str?.value).toMatchObject([{ kind: "string", value: "okay" }]);

        const nums = build_untyped_property([1n, 2n], "reg");
        expect(nums?.value).toMatchObject([{ kind: "array" }]);

        const strs = build_untyped_property(["a", "b"], "clock-names");
        expect(strs?.value).toMatchObject([{ kind: "string" }, { kind: "string" }]);
    });

    test("place_property - adds a property to a base node with no fragment yet", () => {
        const { overlay } = parse(empty_overlay);

        expect(overlay.get_fragments().length).toBe(0);

        const built = build_untyped_property(5000000n, "spi-max-frequency");
        place_property(overlay, { kind: "label", labels: [], name: "spi0" }, undefined, true, built, "spi-max-frequency");

        const output = overlay.print();
        expect(output).toContain("spi0");
        expect(output).toContain("spi-max-frequency");
        expect(overlay.get_fragments().length).toBe(1);
    });

    test("place_property - updating a base-node property reuses the fragment", () => {
        const { overlay } = parse(empty_overlay);
        const target: DTLabel = { kind: "label", labels: [], name: "spi0" };

        place_property(overlay, target, undefined, true, build_untyped_property(1n, "spi-max-frequency"), "spi-max-frequency");
        place_property(overlay, target, undefined, true, build_untyped_property(2n, "spi-max-frequency"), "spi-max-frequency");

        expect(overlay.get_fragments().length).toBe(1);
        expect(overlay.print()).toContain("spi-max-frequency");
    });

    test("place_property - removing a base-node boolean prunes the emptied fragment", () => {
        const { overlay } = parse(empty_overlay);
        const target: DTLabel = { kind: "label", labels: [], name: "spi0" };

        place_property(overlay, target, undefined, true, build_untyped_property(true, "wakeup-source"), "wakeup-source");
        expect(overlay.get_fragments().length).toBe(1);

        // built === undefined => remove
        place_property(overlay, target, undefined, true, undefined, "wakeup-source");
        expect(overlay.print()).not.toContain("wakeup-source");
        expect(overlay.get_fragments().length).toBe(0);
    });

    test("place_property - mutates an overlay-added node in place", () => {
        const { overlay } = parse(overlay_with_imu);
        const found = overlay.find_node({ kind: "label", labels: [], name: "imu1" });
        expect(found).toBeDefined();

        place_property(overlay, { kind: "label", labels: [], name: "imu1" }, found, false, build_untyped_property(0n, "reg"), "reg");

        const output = overlay.print();
        expect(output).toContain("imu1");
        expect(output).toContain("reg");
    });
}
