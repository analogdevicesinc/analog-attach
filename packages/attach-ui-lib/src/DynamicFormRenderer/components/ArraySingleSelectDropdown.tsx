import { VscodeOption, VscodeSingleSelect } from "hds-react";

interface ArraySingleSelectDropdownProps {
    value: string;
    enumValues: string[];
    onChange: (e: Event) => void;
    error: boolean;
}

export function ArraySingleSelectDropdown({ value, enumValues, onChange, error }: ArraySingleSelectDropdownProps) {
    return (
        <VscodeSingleSelect value={value} onChange={onChange} invalid={error}>
            <VscodeOption key="none" value={"-1"}> None </VscodeOption>
            {enumValues.map((enumValue: string, i: number) => (
                <VscodeOption key={String(enumValue)} value={String(i)}>
                    {String(enumValue)}
                </VscodeOption>
            ))}
        </VscodeSingleSelect>
    );
}
