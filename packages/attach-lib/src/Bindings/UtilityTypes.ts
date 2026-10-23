/* eslint-disable unicorn/prevent-abbreviations */
import { DtBindingSchema } from "./Schema";

export type RefResolvedBinding = {
    root_binding: DtBindingSchema,
    refs: DtBindingSchema[]
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
