import { AttachType } from "./StructuralTypes.js";
import type { ValueSuggestion } from "../Intelligence/layers/types.js";

export type ResolvedProperty = {
    key: string,
    value: AttachType,
    /** Concrete candidate values contributed by intelligence layers (e.g. a board description). */
    suggestions?: ValueSuggestion[],
    /** For a `*-gpios` property: how many rows (controller + cells) it takes, as the binding sizes it (set by the devicetree layer). */
    gpio_rows?: { min_rows: number; max_rows?: number },
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
