import { VscodeFormGroup, VscodeLabel } from "hds-react";

interface FormFieldWrapperProperties {
    label: string;
    children: React.ReactNode;
    showLabel?: boolean;
}

export function FormFieldWrapper({ label, children, showLabel = true }: FormFieldWrapperProperties) {
    return (
        <VscodeFormGroup variant="settings-group">
            {showLabel && <VscodeLabel>{label}</VscodeLabel>}
            {children}
        </VscodeFormGroup>
    );
}

