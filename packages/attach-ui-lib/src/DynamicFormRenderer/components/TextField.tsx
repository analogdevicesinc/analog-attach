import { VscodeTextfield } from "hds-react";
import type { FormEvent } from "react";

interface TextFieldProps {
    value: string;
    onInput: (e: FormEvent) => void;
    error: boolean;
    disabled?: boolean;
    placeholder?: string;
}

export function TextField({ value, onInput, error, disabled, placeholder }: TextFieldProps) {
    return (
        <VscodeTextfield
            type="text"
            value={value}
            onInput={onInput}
            invalid={error}
            disabled={disabled}
            placeholder={placeholder}
        />
    );
}
