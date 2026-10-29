import type { ParsedBinding, ResolvedProperty } from "attach-lib";
import { attach_type_to_protocol_type } from "./dt-to-protocol";
import type { Types } from "./types";
import type { PropertyDescription, ChildNodeDescription, DeviceDescription } from "./descriptions";

/** A type as `list devices` writes it: arrays as `<item>[]`, without the counts `list property` shows. */
export function format_type(type: Types): string {
    switch (type.kind) {
        case "number": { return "number"; }
        case "string": { return "string"; }
        case "bool": { return "bool"; }
        case "enum": { return `enum(${type.options.map(o => String(o.display_string ?? o.value)).join(" | ")})`; }
        case "array": { return `${format_type(type.items)}[]`; }
        case "tuple": { return `(${type.items.map((element) => format_type(element)).join(", ")})`; }
    }
}

export function describe_property(
    resolved: ResolvedProperty,
    required: boolean,
    options?: { set?: boolean },
): PropertyDescription {
    const type = attach_type_to_protocol_type(resolved.value);
    return {
        name: resolved.key,
        ...(resolved.value.description === undefined ? {} : { description: resolved.value.description }),
        type,
        display: format_type(type),
        required,
        ...(options?.set === undefined ? {} : { set: options.set }),
    };
}

export function child_node_name(pattern: string): string {
    const literal = pattern.replace(/^\^/, "").replaceAll(/\(([\w@,.-]+)\)/g, "$1");
    const prefix = /^[\w@,.-]*/.exec(literal)?.[0] ?? "";
    return prefix.endsWith("@") ? `${prefix}N` : (prefix || pattern);
}

export function describe_device(binding: ParsedBinding, compatible: string, binding_path: string): DeviceDescription {
    const required = new Set(binding.required_properties);
    const properties = binding.properties.map(p => describe_property(p, required.has(p.key)));
    const children: ChildNodeDescription[] = (binding.pattern_properties ?? []).map(rule => ({
        pattern: rule.pattern,
        name: child_node_name(rule.pattern),
        ...(rule.description ? { description: rule.description } : {}),
        properties: rule.properties.map(p => describe_property(p, rule.required.includes(p.key))),
    }));

    return {
        key: compatible,
        compatible,
        ...(binding.title === undefined ? {} : { title: binding.title }),
        ...(binding.description === undefined ? {} : { description: binding.description }),
        binding: binding_path,
        properties,
        children,
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("child_node_name — the pattern's literal start, N after an @, the pattern when nothing is fixed", () => {
        expect(child_node_name("^channel@([0-9]|1[0-5])$")).toBe("channel@N");
        expect(child_node_name("^fan-[0-9]+$")).toBe("fan-");
        expect(child_node_name("^(port)@[0-9]$")).toBe("port@N");
        expect(child_node_name("^[a-z]+$")).toBe("^[a-z]+$");
    });

    test("describe_property — the shared description: the type and how it is written side by side", () => {
        const resolved = { key: "reg", value: { _t: "list", item: { _t: "number", signed: false }, minItems: 1, maxItems: 2, description: "Chip select" } } as unknown as ResolvedProperty;
        expect(describe_property(resolved, true)).toMatchObject({ name: "reg", description: "Chip select", display: "number[]", required: true });
        expect(describe_property({ key: "spi-cpol", value: { _t: "flag" } } as unknown as ResolvedProperty, false))
            .toEqual({ name: "spi-cpol", type: { kind: "bool" }, display: "bool", required: false });
    });
}
