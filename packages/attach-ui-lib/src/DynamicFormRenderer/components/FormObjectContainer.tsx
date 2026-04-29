import React from "react";
import type { FormElement } from "extension-protocol";
import type { RenderFormElementOptions } from "../DynamicFormRenderer";
import classNames from "classnames";

interface FormObjectContainerProps {
    config: FormElement[];
    onChange: (elementKey: string, newValue: unknown, parentKey?: string) => void;
    parentKey: string;
    options: RenderFormElementOptions;
    effectiveStyles: Record<string, string>;
    renderFormElement: (
        element: FormElement,
        onChange: (elementKey: string, newValue: unknown, parentKey?: string) => void,
        parentKey: string | undefined,
        options: RenderFormElementOptions
    ) => React.ReactNode;
    error: boolean;
    
}

export function FormObjectContainer({
    config,
    onChange,
    parentKey,
    options,
    effectiveStyles,
    renderFormElement,
    error
}: FormObjectContainerProps) {
    return (
        <div className={classNames(
            effectiveStyles.formObjectContainer,
            error?effectiveStyles.error:''
        )}>
            {config.map((nestedElement: FormElement, index: number) => (
                <React.Fragment key={`${nestedElement.key}-${index}`}>
                    {renderFormElement(
                        nestedElement,
                        onChange,
                        parentKey,
                        options
                    )}
                </React.Fragment>
            ))}
        </div>
    );
}
