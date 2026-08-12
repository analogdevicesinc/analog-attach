/* eslint-disable unicorn/prevent-abbreviations */
import { DtBindingSchema } from "../DtBindingSchema";

export type RefResolvedBinding = {
    root_binding: DtBindingSchema,
    refs: DtBindingSchema[]
};

export type BindingAndPatterns = {
    binding: DtBindingSchema,
    patterns: PathPatternValue[],
}

export type PathPatternValue = {
    path: string[],
    pattern: string,
    value: unknown
};

export type PathEntry = {
    path: string[];
    key: string;
    value: unknown;
}

export type PathValue = {
    path: string[],
    value: unknown
}

export type PlainObject = Record<string, unknown>;
