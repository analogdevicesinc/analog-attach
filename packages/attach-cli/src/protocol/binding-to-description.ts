import type { ParsedBinding, ResolvedProperty, PatternPropertyRule } from "attach-lib";
import { attach_type_to_protocol_type } from "./dt-to-protocol";
import type { Types } from "./types";
import type { TypeDescription, PropertyDescription, ChildNodeDescription, DeviceDescription } from "./descriptions";

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

export function describe_type(resolved: ResolvedProperty): TypeDescription {
    const type = attach_type_to_protocol_type(resolved.value);
    return {
        type,
        display: format_type(type),
    };
}

export function describe_property(
    resolved: ResolvedProperty,
    required: boolean,
    options?: { set?: boolean },
): PropertyDescription {
    return {
        name: resolved.key,
        description: resolved.value.description,
        type: describe_type(resolved),
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
        description: rule.description || undefined,
        properties: rule.properties.map(p => describe_property(p, rule.required.includes(p.key))),
    }));

    return {
        compatible,
        title: binding.title,
        description: binding.description,
        binding: binding_path,
        properties,
        children,
    };
}
