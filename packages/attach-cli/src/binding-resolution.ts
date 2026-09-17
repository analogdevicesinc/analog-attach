import {
    Attach,
    is_dt_flag,
    dt_to_validator_input,
    get_full_node_name,
} from "attach-lib";
import type {
    DTNode,
    DeviceTree,
    ResolvedProperty,
    PatternPropertyRule,
} from "attach-lib";

import { find_binding, bigIntReplacer } from "./utilities";

export type NodeBinding = {
    properties: ResolvedProperty[];
    required_properties: string[];
    origin:
        | { kind: "compatible"; compatible: string }
        | { kind: "pattern"; parent_compatible: string; pattern: string };
    narrow_and_populate(node: DTNode): { properties: ResolvedProperty[]; errors: unknown[] } | undefined;
};

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

export async function resolve_node_binding(
    found_node: DTNode,
    parent_node: DTNode | undefined,
    parent_name: string,
    base_dt: DeviceTree,
    linux: string,
    dtSchema: string,
    json: boolean,
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

        const binding_path = await find_binding(linux, dtSchema, compatible_value, json);
        if (binding_path === undefined) {
            return { error: `No binding found for ${compatible_value}` };
        }

        const initial = await Attach.new_populated_binding(binding_path, linux, dtSchema, base_dt, found_node, parent_name);
        if (initial === undefined) {
            return { error: `Failed to parse binding ${binding_path}` };
        }

        return {
            properties: initial.parsed_binding.properties,
            required_properties: initial.parsed_binding.required_properties,
            origin: { kind: "compatible", compatible: compatible_value },
            narrow_and_populate(node: DTNode) {
                const input_data = Object.fromEntries(dt_to_validator_input(node, initial.parsed_binding));
                const input_json = JSON.stringify(input_data, bigIntReplacer);
                const update = initial.attach.update_binding_by_changes(input_json);
                if (update === undefined) { return undefined; }
                const populated = Attach.populate_parsed_binding(update.binding, base_dt, input_json, parent_name);
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

    const parent_binding_path = await find_binding(linux, dtSchema, parent_compatible_value, json);
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

            match.rule.properties = Attach.populate_properties(
                match.rule.properties, base_dt, JSON.stringify(partial_input_data, bigIntReplacer), parent_name
            );

            const input_data = Object.fromEntries(
                dt_to_validator_input(node, {
                    required_properties: match.rule.required,
                    properties: match.rule.properties,
                    pattern_properties: undefined,
                    examples: [],
                })
            );

            const input_json = JSON.stringify(input_data, bigIntReplacer);
            const update = parent_attach.update_pattern_binding_by_changes(match.pattern, input_json);
            if (update === undefined) { return undefined; }

            const populated_properties = Attach.populate_properties(
                update.binding.properties, base_dt, input_json, parent_name
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
