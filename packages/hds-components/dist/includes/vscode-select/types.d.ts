export interface Option {
    label?: string;
    value?: string;
    description?: string;
    selected?: boolean;
    disabled?: boolean;
    icon?: string;
}
export interface InternalOption extends Required<Omit<Option, 'icon'>> {
    icon: string;
    index: number;
    /** Option index in the filtered list. */
    filteredIndex: number;
    /** Character ranges to highlight matches in the filtered list. */
    ranges?: [number, number][];
    visible: boolean;
}
export type FilterMethod = 'startsWithPerTerm' | 'startsWith' | 'contains' | 'fuzzy';
//# sourceMappingURL=types.d.ts.map