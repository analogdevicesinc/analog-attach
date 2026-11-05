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
    examples: string[],
};
