import { VscodeCheckbox } from "hds-react";
import type { FormEvent } from "react";

interface CheckboxFieldProps {
    label: string;
    checked: boolean;
    onChange: (e: FormEvent) => void;
    error: boolean;
}

export function CheckboxField({ label, checked, onChange, error }: CheckboxFieldProps) {
    return (
        <VscodeCheckbox
            invalid={error ?? false}
            label={label}
            checked={checked}
            onChange={onChange}
        />
    );
}
