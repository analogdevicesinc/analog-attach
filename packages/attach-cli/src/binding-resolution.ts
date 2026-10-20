import {
    Attach,
    is_dt_flag,
    dt_to_validator_input,
    get_full_node_name,
    unit_radix,
} from "attach-lib";
import type {
    DTNode,
    UnitRadix,
    DeviceTree,
    ResolvedProperty,
    PatternPropertyRule,
    PropertyPatternRule,
    AttachType,
    PopulateOptions,
    ControllerContext,
    ParseOptions,
} from "attach-lib";

import { find_binding, bigIntReplacer, node_compatibles } from "./utilities";

export type NodeBinding = {
    properties: ResolvedProperty[];
    required_properties: string[];
    /** Child nodes the binding allows (its node patternProperties, e.g. `^channel@([0-9]|1[0-5])$`). */
    child_nodes: PatternPropertyRule[];
    /** Properties named by a pattern (e.g. `^adi,bypass-attenuator-in[0-4]$`). */
    property_patterns: PropertyPatternRule[];
    /** The YAML file the properties come from (the parent's, for a pattern match). */
    binding_path: string;
    origin:
    | { kind: "compatible"; compatible: string }
    | { kind: "pattern"; parent_compatible: string; pattern: string };
    narrow_and_populate(node: DTNode): { properties: ResolvedProperty[]; errors: unknown[] } | undefined;
};

/** A binding's definition of a property, and the pattern it came from when it isn't named. */
export type PropertyDefinition = ResolvedProperty & { pattern?: string };

/** The definition of `name`: the property of that name, else the first property pattern that matches it. */
export function find_property_definition(
    binding: Pick<NodeBinding, "property_patterns">,
    properties: ResolvedProperty[],
    name: string,
): PropertyDefinition | undefined {
    const named = properties.find(p => p.key === name);
    if (named !== undefined) { return named; }
    const rule = binding.property_patterns.find(r => new RegExp(r.pattern).test(name));
    if (rule === undefined) { return undefined; }
    const value = rule.value.description === undefined && rule.description !== "" ? { ...rule.value, description: rule.description } : rule.value;
    return { key: name, value, pattern: rule.pattern };
}

export function match_pattern_rule(
    patterns: string[],
    rules: PatternPropertyRule[] | undefined,
    node_key: string,
): { pattern: string; rule: PatternPropertyRule } | undefined {
    const matched_pattern = patterns.find((pattern) => new RegExp(pattern).test(node_key));
    if (matched_pattern === undefined) { return undefined; }
    const rule = rules?.find((r) => r.pattern === matched_pattern);
    if (rule === undefined) { return undefined; }
    return { pattern: matched_pattern, rule };
}

/**
 * The radix of `child_name@<unit>` unit addresses under `parent`, read from the
 * node patterns of the parent's binding. Undefined when the parent has no
 * binding or none of its patterns accepts the name.
 */
export async function child_unit_radix(
    parent: DTNode | undefined,
    child_name: string,
    linux: string,
    dtSchema: string,
): Promise<UnitRadix | undefined> {
    if (parent === undefined) { return undefined; }
    for (const compatible of node_compatibles(parent)) {
        const binding_path = await find_binding(linux, dtSchema, compatible);
        if (binding_path === undefined) { continue; }
        try {
            const binding = await Attach.new().parse_binding(binding_path, linux, dtSchema);
            return binding === undefined ? undefined : unit_radix(binding.patterns, child_name);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export async function resolve_node_binding(
    found_node: DTNode,
    parent_node: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    linux: string,
    dtSchema: string,
    options?: PopulateOptions,
    parent_compatibles?: string[],
): Promise<NodeBinding | { error: string }> {
    const compatible_property = found_node.properties.find(p => p.name === "compatible");

    if (compatible_property !== undefined) {
        if (is_dt_flag(compatible_property.value)) {
            return { error: "Unexpected compatible value" };
        }
        const first = compatible_property.value[0];
        if (first === undefined || first.kind !== "string") {
            return { error: "Unexpected compatible value" };
        }
        const compatible_value = first.value;

        const binding_path = await find_binding(linux, dtSchema, compatible_value);
        if (binding_path === undefined) {
            return { error: `No binding found for ${compatible_value}` };
        }

        let controller_context: ControllerContext | undefined;
        if (parent_compatibles !== undefined && parent_compatibles.length > 0) {
            let controller_binding_path: string | undefined;
            for (const compat of parent_compatibles) {
                controller_binding_path = await find_binding(linux, dtSchema, compat);
                if (controller_binding_path !== undefined) { break; }
            }
            controller_context = { compatibles: parent_compatibles, binding_path: controller_binding_path };
        }
        const parse_options: ParseOptions | undefined = controller_context === undefined ? undefined : { controller: controller_context };
        const initial = await Attach.new_populated_binding(binding_path, linux, dtSchema, base_dt, found_node, parent_name, options, parse_options);
        if (initial === undefined) {
            return { error: `Failed to parse binding ${binding_path}` };
        }

        return {
            properties: initial.parsed_binding.properties,
            required_properties: initial.parsed_binding.required_properties,
            child_nodes: initial.parsed_binding.pattern_properties ?? [],
            property_patterns: initial.parsed_binding.property_patterns ?? [],
            binding_path,
            origin: { kind: "compatible", compatible: compatible_value },
            narrow_and_populate(node: DTNode) {
                const input_data = Object.fromEntries(dt_to_validator_input(node, initial.parsed_binding));
                const input_json = JSON.stringify(input_data, bigIntReplacer);
                const update = initial.attach.update_binding_by_changes(input_json);
                if (update === undefined) { return; }
                const populated = Attach.populate_parsed_binding(update.binding, base_dt, input_json, parent_name, options);
                return { properties: populated.properties, errors: update.errors as unknown[] };
            },
        };
    }

    if (parent_node === undefined) {
        return { error: "Node has no compatible and no parent to check patternProperties against" };
    }

    const parent_compatible = parent_node.properties.find(p => p.name === "compatible");
    if (parent_compatible === undefined) {
        return { error: "Node has no compatible and its parent also has no compatible" };
    }

    if (is_dt_flag(parent_compatible.value)) {
        return { error: "Unexpected value in compatible of parent node" };
    }
    const parent_first = parent_compatible.value[0];
    if (parent_first === undefined || parent_first.kind !== "string") {
        return { error: "Unexpected value in compatible of parent node" };
    }
    const parent_compatible_value = parent_first.value;

    const parent_binding_path = await find_binding(linux, dtSchema, parent_compatible_value);
    if (parent_binding_path === undefined) {
        return { error: `Failed to find binding for ${parent_compatible_value}` };
    }

    const parent_attach = Attach.new();
    const parent_binding = await parent_attach.parse_binding(parent_binding_path, linux, dtSchema);
    if (parent_binding === undefined) {
        return { error: `Failed to parse binding ${parent_binding_path}` };
    }

    const node_key = get_full_node_name(found_node);
    const match = match_pattern_rule(parent_binding.patterns, parent_binding.parsed_binding.pattern_properties, node_key);
    if (match === undefined) {
        return { error: `Node does not match any patternProperties of ${parent_compatible_value}` };
    }

    return {
        properties: match.rule.properties,
        required_properties: match.rule.required,
        // Nested patterns (children of a pattern-matched node) aren't resolved.
        child_nodes: [],
        property_patterns: [],
        binding_path: parent_binding_path,
        origin: { kind: "pattern", parent_compatible: parent_compatible_value, pattern: match.pattern },
        narrow_and_populate(node: DTNode) {
            const partial_input_data = Object.fromEntries(
                dt_to_validator_input(node, {
                    required_properties: match.rule.required,
                    properties: match.rule.properties,
                    pattern_properties: undefined,
                    examples: [],
                })
            );

            const populated = Attach.populate_properties(
                match.rule.properties, base_dt, JSON.stringify(partial_input_data, bigIntReplacer), parent_name, options
            );

            const input_data = Object.fromEntries(
                dt_to_validator_input(node, {
                    required_properties: match.rule.required,
                    properties: populated,
                    pattern_properties: undefined,
                    examples: [],
                })
            );

            const input_json = JSON.stringify(input_data, bigIntReplacer);
            const update = parent_attach.update_pattern_binding_by_changes(match.pattern, input_json);
            if (update === undefined) { return; }

            const populated_properties = Attach.populate_properties(
                update.binding.properties, base_dt, input_json, parent_name, options
            );

            return { properties: populated_properties, errors: update.errors as unknown[] };
        },
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("match_pattern_rule matches first regex-matching pattern and returns its rule", () => {
        const rules = [
            { pattern: "^channel@[0-9a-f]+$", description: "ADC channel", properties: [], required: [] },
            { pattern: "^gpio@[0-9]+$", description: "GPIO bank", properties: [], required: [] },
        ];
        const patterns = rules.map(r => r.pattern);

        const result = match_pattern_rule(patterns, rules, "channel@0");
        expect(result).toBeDefined();
        expect(result!.pattern).toBe("^channel@[0-9a-f]+$");
        expect(result!.rule.description).toBe("ADC channel");
    });

    test("match_pattern_rule returns undefined when no pattern matches", () => {
        const rules = [
            { pattern: "^channel@[0-9a-f]+$", description: "ADC channel", properties: [], required: [] },
        ];
        const patterns = rules.map(r => r.pattern);

        expect(match_pattern_rule(patterns, rules, "not-a-channel")).toBeUndefined();
    });

    test("match_pattern_rule returns undefined when rules is undefined", () => {
        expect(match_pattern_rule(["^channel@[0-9]+$"], undefined, "channel@0")).toBeUndefined();
    });

    test("find_property_definition — a named property first, else the first property pattern that matches", () => {
        const enum_type: AttachType = { _t: "enum_integer", enum: [0n, 1n], description: "bypass" };
        const flag: AttachType = { _t: "boolean", description: "named" };
        const binding = {
            property_patterns: [
                { pattern: "^adi,bypass-attenuator-in[0-4]$", description: "Configures bypassing", value: enum_type },
                { pattern: "^adi,.*$", description: "catch-all", value: { _t: "generic" } as AttachType },
            ],
        };
        const named = [{ key: "adi,bypass-attenuator-in1", value: flag }];

        expect(find_property_definition(binding, [], "adi,bypass-attenuator-in1")).toEqual({ key: "adi,bypass-attenuator-in1", value: enum_type, pattern: "^adi,bypass-attenuator-in[0-4]$" });
        expect(find_property_definition(binding, named, "adi,bypass-attenuator-in1")).toEqual(named[0]);
        expect(find_property_definition(binding, [], "adi,other")?.pattern).toBe("^adi,.*$");
        expect(find_property_definition(binding, [], "reg")).toBeUndefined();
    });

    test("find_property_definition — the pattern's description when the type has none", () => {
        const binding = { property_patterns: [{ pattern: "-supply$", description: "Input supply", value: { _t: "generic" } as const }] };
        expect(find_property_definition(binding, [], "vdd-supply")?.value.description).toBe("Input supply");
    });

    test("match_pattern_rule prefers the first matching pattern", () => {
        const rules = [
            { pattern: "^.*$", description: "catch-all", properties: [], required: [] },
            { pattern: "^channel@[0-9]+$", description: "specific", properties: [], required: [] },
        ];
        const patterns = rules.map(r => r.pattern);

        const result = match_pattern_rule(patterns, rules, "channel@0");
        expect(result).toBeDefined();
        expect(result!.rule.description).toBe("catch-all");
    });
}
