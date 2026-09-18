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

            const target_reference = resolve_node_identifier(node_identifier, overlay);
            const found = overlay.find_node(target_reference);

            const base_reference = target_reference.kind === "path"
                ? base_dt.get_node_by_path(target_reference)
                : base_dt.get_node_by_label(target_reference);

            // A base-tree node is edited by writing into an overlay fragment that
            // targets it; the base tree itself is never modified.
            const is_base_target = (found?.is_in_base ?? false) || (found === undefined && base_reference !== undefined);

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

            if (is_base_target && base_reference !== undefined) {
                binding_node = base_dt.deref_node(base_reference);
                const parent_reference = base_dt.get_parent(base_reference);
                binding_parent = parent_reference === undefined ? undefined : base_dt.deref_node(parent_reference);
                parent_name = base_reference.labels.at(-1)?.name ?? base_reference.full_path.path;
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

            if (property_definition === undefined) {
                built = build_untyped_property(parsed, property_name);
            } else {
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
            }

            place_property(overlay, target_reference, found, is_base_target, built, property_name);

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

type ParsedInputValue = SingleInput | ArrayInput | MatrixInput;
type SingleInput = boolean | bigint | string;
type ArrayInput = (bigint | string)[];
type MatrixInput = ArrayInput[];

function parse_token(token: string): bigint | string {
    return /^-?\d+$/.test(token) ? BigInt(token) : token;
}

// Value mini-syntax for --with:
//   <value>                     -> single scalar
//   <value> <value>             -> flat array (space-separated items)
//   <value> <value>,<value> ... -> matrix rows (comma between rows, space within a row)
// Comma is a safe row separator: it can't appear in labels, macros, or numbers.
export function parse_value(value: string): ParsedInputValue {
    value = value.trim();

    const lowerValue = value.toLowerCase();
    if (lowerValue === 'true') { return true; }
    if (lowerValue === 'false') { return false; }

    const rows: MatrixInput = value
        .split(',')
        .map(row => row.trim().split(/\s+/).filter(token => token.length > 0).map((element) => parse_token(element)));

    if (rows.length > 1) { return rows; }

    const first = rows[0] ?? [];
    if (first.length === 1) { return first[0]!; }
    return first;
}

function is_matrix_input(value: ParsedInputValue): value is MatrixInput {
    return Array.isArray(value) && value.length > 0 && value.every(row => Array.isArray(row));
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
    target_reference: DTLabel | DTPath,
    found: FoundNodeResult | undefined,
    is_base_target: boolean,
    built: DTProperty | undefined,
    property_name: string,
): void {
    if (is_base_target) {
        if (built === undefined) {
            overlay.remove_property(target_reference, property_name);
        } else {
            overlay.add_fragment(target_reference, undefined, built);
        }
        return;
    }

    if (found !== undefined) {
        if (built === undefined) {
            found.node.properties = found.node.properties.filter(p => p.name !== property_name);
        } else {
            upsert_property(found.node, built);
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

    if (is_matrix_input(parsed)) {
        const rows = parsed.map(row =>
            row.map(element =>
                typeof element === "bigint" ? PropertyBuilder.tag_number(element) : PropertyBuilder.tag_expression(element)
            )
        ) as [CellValue[], ...CellValue[][]];

        return PropertyBuilder.build_cell_array()
            .with_tagged_values(...rows)
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

// The numeric values a MACRO enum accepts: each enum name resolved to its macro value.
// A bare number is a valid MACRO value only if it appears here (e.g. 2 == IRQ_TYPE_EDGE_FALLING).
function macro_enum_values(enum_names: unknown[]): Set<bigint> {
    const values = new Set<bigint>();
    for (const name of enum_names) {
        const resolved = ALL_MACROS.find(m => m.name === name);
        if (resolved !== undefined) { values.add(BigInt(resolved.value)); }
    }
    return values;
}

// An enum accepts a value if it names one of its members, or (for MACRO enums) if it is
// the numeric value one of those macros resolves to.
function enum_accepts(element: bigint | string, enum_values: unknown[], macro_values: Set<bigint> | undefined): boolean {
    if (enum_values.includes(element)) { return true; }
    return typeof element === "bigint" && macro_values !== undefined && macro_values.has(element);
}

// Validate a single matrix row against its row definition and return the row's cell
// values, or an error string. Matrix rows are always cell-valued (`<...>`): string
// shapes (string_array, string-typed enums) are rejected rather than emitted.
const MATRIX_STRING_ROW_ERROR = (property: string) =>
    `Property ${property} matrix rows must be numeric or reference values, not strings`;

function build_row_cells(values: ArrayInput, definition: AttachArray, property: string): CellValue[] | string {
    switch (definition._t) {
        case "array": {
            return values.map(element =>
                typeof element === "bigint" ? PropertyBuilder.tag_number(element) : PropertyBuilder.tag_expression(element)
            );
        }
        case "number_array": {
            if (!values.every((element): element is bigint => typeof element === "bigint")) {
                return `Property ${property} in binding demands numbers`;
            }
            return values.map(element => PropertyBuilder.tag_number(element));
        }
        case "string_array": {
            return MATRIX_STRING_ROW_ERROR(property);
        }
        case "enum_array": {
            const macro_values = definition.enum_type === AttachEnumType.MACRO
                ? macro_enum_values(definition.enum) : undefined;
            if (!values.every(element => enum_accepts(element, definition.enum, macro_values))) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items from ${JSON.stringify(definition.enum)}`;
            }
            if (definition.enum_type === AttachEnumType.STRING) {
                return MATRIX_STRING_ROW_ERROR(property);
            }
            if (values.some(element => typeof element === "bigint")
                && definition.enum_type !== AttachEnumType.NUMBER
                && definition.enum_type !== AttachEnumType.MACRO) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            return values.map(element => to_cell_value(element, definition.enum_type));
        }
        case "fixed_index": {
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items`;
            }

            const cell_values: CellValue[] = [];

            for (let index = 0; index < definition.prefixItems.length && index < values.length; index++) {
                const v = values[index]!;
                const item_definition = definition.prefixItems[index]!;

                if (typeof v === "bigint") {
                    if (item_definition._t === "number") {
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else if (item_definition.enum_type === AttachEnumType.MACRO) {
                        if (!macro_enum_values(item_definition.enum).has(v)) {
                            return `Property ${property} at index ${index} accepts a macro from ${JSON.stringify(item_definition.enum)} or its numeric value`;
                        }
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else {
                        return `Property ${property} doesn't require a number at index ${index}`;
                    }
                } else {
                    if (item_definition._t === "number") {
                        return `Property ${property} requires a number at index ${index}`;
                    }
                    if (!item_definition.enum.includes(v)) {
                        return `Property ${property} at index ${index} require a value from ${JSON.stringify(item_definition.enum)}`;
                    }
                    if (item_definition.enum_type === AttachEnumType.STRING) {
                        return MATRIX_STRING_ROW_ERROR(property);
                    }
                    cell_values.push(to_cell_value(v, item_definition.enum_type));
                }
            }

            return cell_values;
        }
        default: {
            const _x: never = definition;
            throw new Error("Exhaustive check failed!");
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
            if (is_matrix_input(parsed_value)) {
                return `Property ${property} does not accept comma-separated rows`;
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

            // Normalize to rows: a matrix input is already rows; a flat array is one row;
            // a scalar is a single one-cell row.
            const rows: ArrayInput[] = is_matrix_input(parsed_value)
                ? parsed_value
                : [Array.isArray(parsed_value) ? parsed_value : [parsed_value]];

            if (rows.length < definition.value.minItems || rows.length > definition.value.maxItems) {
                return `Property ${property} accepts between ${definition.value.minItems} and ${definition.value.maxItems} row(s)`;
            }

            const row_definitions = definition.value.values;
            const built_rows: CellValue[][] = [];

            for (const [index, row] of rows.entries()) {
                // Row definitions usually hold a single template broadcast to every row
                // (e.g. reg, opp-hz); fall back to it when there is no per-index entry.
                const row_definition = row_definitions[index] ?? row_definitions[0];
                if (row_definition === undefined) {
                    return `Property ${property} has no row definition in its binding`;
                }

                const cells = build_row_cells(row!, row_definition, property);
                if (typeof cells === "string") { return cells; }
                built_rows.push(cells);
            }

            upsert_property(
                found_node,
                PropertyBuilder.build_cell_array()
                    .with_tagged_values(...(built_rows as [CellValue[], ...CellValue[][]]))
                    .with_name(property)
                    .build()
            );

            return true;
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
            const macro_values = definition.enum_type === AttachEnumType.MACRO
                ? macro_enum_values(definition.enum) : undefined;
            if (!values.every(element => enum_accepts(element, definition.enum, macro_values))) {
                return `Values for property ${property} are ${JSON.stringify(definition.enum)}`;
            }
            if (definition.minItems > values.length || definition.maxItems < values.length) {
                return `Property ${property} accepts between ${definition.minItems} and ${definition.maxItems} items from ${JSON.stringify(definition.enum)}`;
            }
            if (values.some(element => typeof element === "bigint")
                && definition.enum_type !== AttachEnumType.NUMBER
                && definition.enum_type !== AttachEnumType.MACRO) {
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
                    if (item_definition._t === "number") {
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else if (item_definition.enum_type === AttachEnumType.MACRO) {
                        if (!macro_enum_values(item_definition.enum).has(v)) {
                            return `Property ${property} at index ${index} accepts a macro from ${JSON.stringify(item_definition.enum)} or its numeric value`;
                        }
                        cell_values.push(PropertyBuilder.tag_number(v));
                    } else {
                        return `Property ${property} doesn't require a number at index ${index}`;
                    }
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

    const parse = (overlay_source: string) => {
        const base = DeviceTree.new_from_string(base_dts);
        if (typeof base === "string") { throw new TypeError(base); }
        const overlay = DeviceTreeOverlay.new_from_string(overlay_source, base);
        if (typeof overlay === "string") { throw new TypeError(overlay); }
        return { base, overlay };
    };

    test("build_untyped_property - infers shapes from the value syntax", () => {
        expect(build_untyped_property(true, "wakeup-source")?.value).toEqual({ kind: "flag" });
        expect(build_untyped_property(false, "wakeup-source")).toBeUndefined();

        const number_ = build_untyped_property(5_000_000n, "spi-max-frequency");
        expect(number_?.value).toMatchObject([{ kind: "array" }]);

        const string_ = build_untyped_property("okay", "status");
        expect(string_?.value).toMatchObject([{ kind: "string", value: "okay" }]);

        const nums = build_untyped_property([1n, 2n], "reg");
        expect(nums?.value).toMatchObject([{ kind: "array" }]);

        const strs = build_untyped_property(["a", "b"], "clock-names");
        expect(strs?.value).toMatchObject([{ kind: "string" }, { kind: "string" }]);

        const matrix = build_untyped_property([[1n, 2n], [3n, 4n]], "reg");
        expect(matrix?.value).toMatchObject([{ kind: "array" }, { kind: "array" }]);
    });

    test("parse_value - scalars, flat arrays, and comma-separated matrices", () => {
        expect(parse_value("0")).toBe(0n);
        expect(parse_value("some_label")).toBe("some_label");
        expect(parse_value("true")).toBe(true);
        expect(parse_value("false")).toBe(false);
        expect(parse_value("a b c")).toEqual(["a", "b", "c"]);
        expect(parse_value("1 2")).toEqual([1n, 2n]);
        expect(parse_value("1 2,3 4")).toEqual([[1n, 2n], [3n, 4n]]);
        expect(parse_value("0,1,2")).toEqual([[0n], [1n], [2n]]);
    });

    test("set_property - builds a multi-row matrix and enforces the row count", () => {
        const definition: ResolvedProperty = {
            key: "reg",
            value: {
                _t: "matrix",
                minItems: 1,
                maxItems: 2,
                values: [{ _t: "number_array", minItems: 1, maxItems: 2, minimum: 0n, maximum: 0xFF_FF_FF_FFn }],
            },
        };

        const scratch: DTNode = { name: "s", unit_addr: undefined, labels: [], properties: [], children: [] };
        expect(set_property([[1n, 2n], [3n, 4n]], scratch, "reg", definition)).toBe(true);
        expect(scratch.properties.find(p => p.name === "reg")?.value).toMatchObject([{ kind: "array" }, { kind: "array" }]);

        // Too many rows (maxItems = 2) is rejected with a message.
        const scratch2: DTNode = { name: "s", unit_addr: undefined, labels: [], properties: [], children: [] };
        expect(typeof set_property([[1n], [2n], [3n]], scratch2, "reg", definition)).toBe("string");
    });

    test("set_property - accepts a macro's numeric value at a MACRO enum index", () => {
        const definition: ResolvedProperty = {
            key: "interrupts",
            value: {
                _t: "fixed_index",
                minItems: 2,
                maxItems: 2,
                prefixItems: [
                    { _t: "number", minimum: 0n, maximum: 0xFF_FF_FF_FFn },
                    { _t: "enum", enum: INTERRUPT_MACROS.map(m => m.name), enum_type: AttachEnumType.MACRO },
                ],
            },
        };

        // 2 == IRQ_TYPE_EDGE_FALLING, so the bare number is accepted.
        const scratch: DTNode = { name: "s", unit_addr: undefined, labels: [], properties: [], children: [] };
        expect(set_property([25n, 2n], scratch, "interrupts", definition)).toBe(true);
        expect(scratch.properties.find(p => p.name === "interrupts")?.value).toMatchObject([{ kind: "array" }]);

        // The macro name still works.
        const scratch2: DTNode = { name: "s", unit_addr: undefined, labels: [], properties: [], children: [] };
        expect(set_property([25n, "IRQ_TYPE_EDGE_FALLING"], scratch2, "interrupts", definition)).toBe(true);

        // A number that is not any IRQ macro value is rejected.
        const scratch3: DTNode = { name: "s", unit_addr: undefined, labels: [], properties: [], children: [] };
        expect(typeof set_property([25n, 99n], scratch3, "interrupts", definition)).toBe("string");
    });

    test("place_property - writes a true multi-row matrix as separate <...> groups", () => {
        const { overlay } = parse(empty_overlay);
        const target: DTLabel = { kind: "label", labels: [], name: "spi0" };

        place_property(overlay, target, undefined, true, build_untyped_property([[1n, 2n], [3n, 4n]], "reg"), "reg");

        const output = overlay.print();
        expect(output).toMatch(/<[^>]*>,\s*<[^>]*>/);
    });

    test("place_property - adds a property to a base node with no fragment yet", () => {
        const { overlay } = parse(empty_overlay);

        expect(overlay.get_fragments().length).toBe(0);

        const built = build_untyped_property(5_000_000n, "spi-max-frequency");
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
