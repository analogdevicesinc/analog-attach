import { AttachType } from "./AttachType.js";

export type ResolvedProperty = {
    key: string,
    value: AttachType,
}

export type PatternPropertyRule = {
    pattern: string;
    description: string;
    properties: ResolvedProperty[];
    required: string[];
};

/** A patternProperties entry that names properties rather than child nodes. */
export type PropertyPatternRule = {
    pattern: string;
    description: string;
    value: AttachType;
};

export type ParsedBinding = {
    title?: string,
    description?: string,
    required_properties: string[],
    properties: ResolvedProperty[],
    pattern_properties?: PatternPropertyRule[],
    property_patterns?: PropertyPatternRule[],
    /**
     * The property patterns of the schemas dt-validate checks every node against (`select: true`: dt-core.yaml's
     * `.*-supply$`, property-units.yaml's `-microvolt$`) that type a name, in file order: types for a name the
     * binding's own patterns allow (`property_definition`), not names to offer. The same array for every binding of
     * the same search paths.
     */
    selected_patterns?: readonly PropertyPatternRule[],
    examples: string[],
};

/** Whether `pattern` matches somewhere in `name`, as dt-schema's `re.search`; not a pattern only Python's `re` reads. */
function matches(pattern: string, name: string): boolean {
    try {
        return new RegExp(pattern).test(name);
    } catch {
        return false;
    }
}

/** A binding's definition of a property, and the pattern it came from when it isn't named. */
export type PropertyDefinition = ResolvedProperty & { pattern?: string };

/**
 * The definition of `name` in `binding` (`properties` its properties, narrowed or populated): the property of that
 * name, else the first of its property patterns that matches it. A pattern that doesn't type it
 * (`"^in[13]-supply$": true`) takes the type of the first of `selected_patterns` that matches the name (dt-core.yaml's
 * `.*-supply$`, a phandle), with the binding's description: dt-schema types a name by every pattern it knows
 * (`validator.py:property_get_type`). A name no pattern of the binding allows has none.
 */
export function property_definition(
    binding: Pick<ParsedBinding, "property_patterns" | "selected_patterns">,
    properties: ResolvedProperty[],
    name: string,
): PropertyDefinition | undefined {
    const named = properties.find(property => property.key === name);
    if (named !== undefined) { return named; }

    const rule = binding.property_patterns?.find(rule => matches(rule.pattern, name));
    if (rule === undefined) { return undefined; }

    const selected = rule.value._t === "unknown" ? binding.selected_patterns?.find(other => matches(other.pattern, name)) : undefined;
    const value = selected?.value ?? rule.value;
    const description = rule.value.description ?? (rule.description === "" ? undefined : rule.description) ?? value.description;
    return { key: name, value: description === undefined ? value : { ...value, description }, pattern: rule.pattern };
}
