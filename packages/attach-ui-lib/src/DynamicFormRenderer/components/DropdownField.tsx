import { useState, useEffect } from "react";
import { VscodeOption, VscodeSingleSelect } from "hds-react";

interface DropdownFieldProps {
    value: string;
    defaultValue?: string;
    options: (string | boolean | bigint)[];
    onChange: (e: Event) => void;
    error: boolean;
    disabled?: boolean;
}

export function DropdownField({ value, defaultValue, options, onChange, error, disabled }: DropdownFieldProps) {
    // Track local state to distinguish between user-selected value and default
    const [localValue, setLocalValue] = useState<string>(value || defaultValue || '');
    const [hasUserInteracted, setHasUserInteracted] = useState<boolean>(false);

    // Update local value when props change, but only if user hasn't interacted
    useEffect(() => {
        if (!hasUserInteracted) {
            setLocalValue(value || defaultValue || '');
        }
    }, [value, defaultValue, hasUserInteracted]);

    const handleChange = (e: Event) => {
        setHasUserInteracted(true);
        const target = e.target as any;
        setLocalValue(target.value || '');
        onChange(e);
    };

    return (
        <VscodeSingleSelect value={localValue} onChange={handleChange} invalid={error} disabled={disabled}>
            <VscodeOption key="none" value="">None</VscodeOption>
            {options.map((enumValue: string | boolean | bigint) => (
                <VscodeOption key={String(enumValue)} value={String(enumValue)}>
                    {String(enumValue)}
                </VscodeOption>
            ))}
        </VscodeSingleSelect>
    );
}
