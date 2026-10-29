import { answer, command, input_error, refuse, type ListPropertyArguments } from "../../../../interface/backend-interface";
import { load_workspace } from "../../config/workspace";
import type { PropertyDescription, ListPropertyResponse } from "../../protocol/descriptions";
import type { PropertyValue } from "../../protocol/types";
import { bigIntReplacer } from "../../utilities";
import { node_properties, node_properties_message, node_property_entries, property_type } from "./data";
import { format_type, type PropertyInfo } from "./suggest";

/** What `list property <path> <property>` prints: the type line, then what the binding says, one item a line. */
export function property_type_lines(property: string, info: PropertyInfo): string[] {
    const lines = [`${property}${info.required ? " (required)" : ""}: ${format_type(info.type)}`];
    if (info.description !== undefined) {
        lines.push(...info.description.trim().split("\n").map(line => line.trim()).filter(Boolean).map(line => `  ${line}`));
    }
    const { constraints } = info;
    if (constraints.const !== undefined) { lines.push(`  const: ${JSON.stringify(constraints.const, bigIntReplacer)}`); }
    if (constraints.default !== undefined) { lines.push(`  default: ${JSON.stringify(constraints.default, bigIntReplacer)}`); }
    if (constraints.minimum !== undefined) { lines.push(`  min: ${constraints.minimum}`); }
    if (constraints.maximum !== undefined) { lines.push(`  max: ${constraints.maximum}`); }
    for (const suggestion of info.suggestions) { lines.push(`  ${suggestion.value}\t${suggestion.display_string}`); }
    return lines;
}

/** A binding's default as a protocol value: a cell's bigint becomes a number. */
function protocol_value(value: unknown): PropertyValue | undefined {
    if (value === undefined) { return undefined; }
    return JSON.parse(JSON.stringify(value, bigIntReplacer)) as PropertyValue;
}

/** The shared description of one property of a node. */
export function describe_node_property(property: string, info: PropertyInfo, set: boolean): PropertyDescription {
    const default_value = protocol_value(info.constraints.default);
    return {
        name: property,
        ...(info.description === undefined ? {} : { description: info.description }),
        type: info.type,
        display: format_type(info.type),
        required: info.required,
        set,
        ...(default_value === undefined ? {} : { default: default_value }),
        ...(info.suggestions.length === 0 ? {} : { suggestions: info.suggestions }),
    };
}

export const list_property = command<ListPropertyArguments, ListPropertyResponse>({
    docs: {
        brief: "List a node's properties from its binding, or describe one",
        full: `Paths:
  Label:        spi0                       (a label in the base tree)
  Label-first:  spi0/adi,ad7124-8@0       (label then child segments)
  Absolute:     /soc/spi@7e204000          (full device tree path)

Without a property: the binding's properties (marked set and required), its
property patterns and child-node patterns. With one: its type, description,
constraints and the values the binding offers.`,
        examples: [
            "list property spi0/adi,ad7124-8@0                Properties for a node",
            "list property spi0/adi,ad7124-8@0/channel@0 reg  One property",
        ],
    },
    async run({ path: identifier, property }, _flags, session) {
        if (identifier === undefined) { return input_error("Missing: path (list property <path> [property])"); }

        const loaded = load_workspace(session, ["bindings", "base", "overlay"]);
        if (!loaded.ok) { return loaded.outcome; }
        const { bindings, base, overlay } = loaded.workspace;

        if (property === undefined) {
            const found = await node_properties(identifier, overlay.tree, base.tree, bindings);
            if (!found.ok) { return refuse(found.message, { text: found.text ?? found.message }); }
            const entries = node_property_entries(found.value);
            return answer<ListPropertyResponse>(
                { ok: true, message: node_properties_message(found.value), severity: "info", names: entries.map(entry => entry.value), suggestions: entries },
                () => entries.map(entry => entry.display_string ?? entry.value).join("\n"),
            );
        }

        const found = await property_type(identifier, property, overlay.tree, base.tree, bindings);
        if (!found.ok) { return refuse(found.message, { text: found.text ?? found.message }); }
        const { info, set } = found.value;
        return answer<ListPropertyResponse>(
            {
                ok: true,
                message: `Type of ${property}`,
                severity: "info",
                property: describe_node_property(property, info, set),
                type: info.type,
                ...(info.description === undefined ? {} : { description: info.description }),
                ...(info.suggestions.length > 0 ? { suggestions: info.suggestions } : {}),
            },
            () => property_type_lines(property, info).join("\n"),
        );
    },
});

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    const info: PropertyInfo = {
        type: { kind: "array", items: { kind: "number", subtype: "int" }, min_items: 2, max_items: 2 },
        description: "  Two inputs.\n\n  The positive one first.\n",
        required: true,
        binding_path: "/linux/adi,ad7124.yaml",
        constraints: { minimum: 0n, maximum: 15n, default: 3n },
        suggestions: [{ value: "0 1", display_string: "AIN0, AIN1" }],
    };

    test("property_type_lines — the type, each description line trimmed, the constraints, the suggestions", () => {
        expect(property_type_lines("diff-channels", info)).toEqual([
            "diff-channels (required): number[2]",
            "  Two inputs.",
            "  The positive one first.",
            "  default: 3",
            "  min: 0",
            "  max: 15",
            "  0 1\tAIN0, AIN1",
        ]);
        expect(property_type_lines("label", { ...info, type: { kind: "string" }, description: undefined, required: false, constraints: { const: "x" }, suggestions: [] }))
            .toEqual(["label: string", "  const: \"x\""]);
    });

    test("describe_node_property — the shared description, the default as a number", () => {
        expect(describe_node_property("diff-channels", info, false)).toEqual({
            name: "diff-channels",
            description: info.description,
            type: info.type,
            display: "number[2]",
            required: true,
            set: false,
            default: 3,
            suggestions: info.suggestions,
        });
        expect(describe_node_property("label", { ...info, description: undefined, constraints: {}, suggestions: [] }, true))
            .not.toHaveProperty("default");
    });
}
