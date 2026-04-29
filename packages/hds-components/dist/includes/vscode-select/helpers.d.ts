import { TemplateResult } from 'lit';
import { InternalOption, FilterMethod } from './types.js';
export type SearchResult = {
    match: boolean;
    ranges: [number, number][];
};
export declare const startsWithPerTermSearch: (subject: string, pattern: string) => SearchResult;
export declare const startsWithSearch: (subject: string, pattern: string) => SearchResult;
export declare const containsSearch: (subject: string, pattern: string) => SearchResult;
export declare const fuzzySearch: (subject: string, pattern: string) => SearchResult;
export declare const filterOptionsByPattern: (list: InternalOption[], pattern: string, method: FilterMethod) => InternalOption[];
export declare const highlightRanges: (text: string, ranges: [number, number][]) => TemplateResult | TemplateResult[];
export declare function findNextSelectableOptionIndex(options: InternalOption[], fromIndex: number): number;
export declare function findPrevSelectableOptionIndex(options: InternalOption[], fromIndex: number): number;
//# sourceMappingURL=helpers.d.ts.map