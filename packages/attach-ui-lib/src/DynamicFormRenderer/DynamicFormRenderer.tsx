import type {
    ArrayHyperlinkValidation,
    ArrayMixedTypeValidation,
    ArrayNumberValidation,
    ArrayStringValidation,
    FlagFormElement,
    FormArrayElement,
    FormElement,
    FormObjectElement,
    GenericFormElement,
    HyperlinkItem,
    MatrixValidation,
    MixedArrayNumber,
    MixedArrayNumberList,
    MixedArrayStringList,
    NumericRangeValidation
} from "extension-protocol";
import {
    Tooltip,
    VscodeIcon,
    VscodeLabel
} from "hds-react";

import DynamicHybridArray from "./components/DynamicHybridArray/DynamicHybridArray";
import GhostButton from "../GhostButton/GhostButton";
import MultiSelectDropdown from "../MultiSelectDropdown/MultiSelectDropdown";
import { ArraySingleSelectDropdown } from "./components/ArraySingleSelectDropdown";
import { CheckboxField } from "./components/CheckboxField";
import { DropdownField } from "./components/DropdownField";
import { FormObjectContainer } from "./components/FormObjectContainer";
import HybridArray from "./components/HybridArray/HybridArray";
import Matrix, { type CellRendererFn, type ColumnRule } from "./components/Matrix/Matrix";
import { NumberField } from "./components/NumberField";
import { TextField } from "./components/TextField";
import styles from "./DynamicFormRenderer.module.scss";
import { isCustomProperty, isCustomPropertyFlag } from "../CustomProperty/CreatePropertyToggle";
import { ArrayHyperlink } from "./components/ArrayHyperlink";

/**
 * Sometimes array values are given as single values from the backend.
 * This helper ensures we always return an array.
 */
function toOrAsArray(value: any): string[] {
    return Array.isArray(value) ? value : (value ? [value] : []);
}

/**
 * Errors are not always capitalized properly. This helper capitalizes the first letter.
 */
function capitalize(str: string): string {
    if (!str) return str;
    return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

/** Type guards for validation types */
function isArrayStringValidation(val: any | undefined): val is ArrayStringValidation {
    return val?.type === "ArrayStringValidation";
}

function isArrayNumberValidation(val: any | undefined): val is ArrayNumberValidation {
    return val?.type === "ArrayNumberValidation";
}

function isMixedArrayStringList(val: any | undefined): val is MixedArrayStringList {
    return val?.type === "StringList";
}

function isMixedArrayNumberList(val: any | undefined): val is MixedArrayNumberList {
    return val?.type === "NumberList";
}

function isMixedArrayNumber(val: any | undefined): val is MixedArrayNumber {
    return val?.type === "Number";
}

function isArrayMixedTypeValidation(val: any | undefined): val is ArrayMixedTypeValidation {
    return val?.type === "ArrayMixedTypeValidation";
}

/**
 * Validates a device alias string.
 * An empty alias is considered valid (alias is optional).
 * @returns `true` if the alias is valid or empty, `false` otherwise.
 */
export function isValidAlias(alias: string): boolean {
	if (alias === "") {
		return true;
	}
    // Alias must start with a letter and contain only alphanumeric characters
	return /^[_a-zA-Z][\w]*$/.test(alias);
}


function isArrayHyperlinkValidation(val: any | undefined): val is ArrayHyperlinkValidation {
    return val?.type === "ArrayHyperlinkValidation";
}

export interface DynamicFormRendererStyles {
    fieldContainer?: string;
    fieldLabelGroup?: string;
    badgeContainer?: string;
    optionalBadge?: string;
    errorBadge?: string;
    formObjectContainer?: string;
}

export interface RenderFormElementOptions {
    /**
     * Custom CSS module styles to apply to the rendered form elements
     */
    customStyles?: DynamicFormRendererStyles;

    /**
     * Only render flat form elements, not nested objects.
     */
    recursively?: boolean;

    /**
     * Callback to delete custom properties
     */
    deleteCustomPropsHandler: (name: string) => void
    onGoTo?: (gotoUID: string) => void; // Optional global onGoTo handler for hyperlink items
}

/**
 * Due to the complexity of the various types and validations retrieved from the backend,
 * we apply a transformation step that converts a FormElement into a FormComponentSpec.
 * This conversion describes what type of component to render and with what properties.
 * 
 * This datatype describes the specification for rendering all possible form components.
 */
type FormComponentSpec =
    | {
        type: 'checkbox';
        props: {
            label: string;
            checked: boolean;
            onChange: (e: React.SyntheticEvent) => void;
            error: boolean;
        };
    }
    | {
        type: 'dropdown';
        props: {
            value: string;
            defaultValue?: string;
            options: (string | boolean | bigint)[];
            onChange: (e: Event) => void;
            error: boolean;
            disabled?: boolean;
        };
    }
    | {
        type: 'number';
        props: {
            value: string;
            min?: bigint;
            max?: bigint;
            onInput: (e: React.SyntheticEvent) => void;
            error: boolean;
        };
    }
    | {
        type: 'text';
        props: {
            value: string;
            onInput: (e: React.SyntheticEvent) => void;
            error: boolean;
            disabled?: boolean;
            placeholder?: string;
        };
    }
    | {
        type: 'array-single-select-dropdown';
        props: {
            value: string;
            enumValues: string[];
            onChange: (e: Event) => void;
            error: boolean;
        };
    }
    | {
        type: 'multi-select-dropdown';
        props: {
            options: string[];
            value: string[];
            onChange: (values: unknown[]) => void;
            allowMultiple: boolean;
            placeholder: string;
            createable: boolean;
            error: boolean;
        };
    }
    | {
        type: 'array-hyperlink-dropdown';
        props: {
            items: HyperlinkItem[];
            value: string;
            onChange: (value: string | undefined) => void;
            onGoTo?: (gotoUID: string) => void;
            error: boolean;
        };
    }
    | {
        type: 'hybrid-array';
        props: {
            value: (string | bigint | undefined)[];
            length: number;
            onChange: (values: (string | bigint | undefined)[]) => void;
            colRules: ColumnRule[];
            error: boolean;
        };
    }
    | {
        type: 'dynamic-hybrid-array';
        props: {
            value: (string | bigint | undefined)[];
            minLength: number;
            maxLength: number;
            allColRules: ColumnRule[];
            onChange: (values: (string | bigint | undefined)[]) => void;
            error: boolean;
        };
    }
    | {
        type: 'matrix';
        props: {
            cols: number;
            minCols: number;
            maxCols: number;
            columnHeaders?: string[];
            value?: (string | bigint | undefined)[][];
            onChange: (value: (string | bigint | undefined)[][]) => void;
            error: boolean;
            colRules: ColumnRule[];
            maxRows?: number;
            renderCellComponent?: CellRendererFn;
        };
    }
    | {
        type: 'object';
        props: {
            config: FormElement[];
            onChange: (elementKey: string, newValue: unknown, parentKey?: string) => void;
            parentKey: string;
            options: RenderFormElementOptions;
            effectiveStyles: any;
            error: boolean;
        };
    };

/**
 * Parse a form element and return a specification for how it should be rendered.
 * This function analyzes the element's validation rules and determines the appropriate
 * component type and props without actually rendering anything.
 * 
 * @param element - The form element to parse
 * @param currentValue - The current value of the element
 * @param onChange - Callback function when the element's value changes
 * @param parentKey - Optional parent key for nested form elements
 * @param options - Optional configuration including custom styles
 * @returns A FormComponentSpec describing how to render the component
 */
function parseFormElement(
    element: FormElement,
    currentValue: unknown,
    onChange: (elementKey: string, newValue: unknown, parentKey?: string) => void,
    parentKey: string | undefined,
    options: RenderFormElementOptions
): FormComponentSpec {
    const effectiveStyles = options?.customStyles || styles;

    switch (element.type) {
        case 'Flag': {
            const flagElement = element as FlagFormElement;
            const isChecked = flagElement.setValue ?? flagElement.defaultValue ?? false;
            return {
                type: 'checkbox',
                props: {
                    label: element.key,
                    checked: isChecked ?? false,
                    onChange: (e: React.SyntheticEvent) => {
                        const target = e.target as HTMLInputElement;
                        onChange(element.key, target.checked, parentKey);
                    },
                    error: element.error !== undefined
                }
            };
        }

        case 'Generic': {
            const genericElement = element as GenericFormElement;
            /**
             * Do we have custom props?
             */
            if(isCustomProperty(element)){
                return {
                    type: 'text',
                    props: {
                        value: String(currentValue ?? ''),
                        onInput: (e) => {
                            onChange(element.key, (e.target as HTMLInputElement).value)
                        },
                        error: element.error !== undefined
                    }
                }
            }
            else if (isCustomPropertyFlag(element)) {
                return {
                    type: 'checkbox',
                    props: {
                        label: element.key,
                        checked: currentValue ? true: false,
                        onChange: (e: React.SyntheticEvent) => {
                            const target = e.target as HTMLInputElement;
                            onChange(element.key, target.checked, parentKey);
                        },
                        error: element.error !== undefined
                    }
                }
            }



            const validationType = genericElement.validationType;

            if (genericElement.inputType === 'dropdown' && validationType && validationType.type === 'DropdownValidation') {
                return {
                    type: 'dropdown',
                    props: {
                        value: String(currentValue ?? ''),
                        onChange: (e: Event) => {
                            const component = e.target as any;
                            const newValue = (component?.value ?? String(currentValue ?? '')) || undefined;
                            const originalValue = validationType.list.find((v: string | boolean | bigint) => String(v) === newValue);
                            onChange(element.key, originalValue !== undefined ? originalValue : newValue, parentKey);
                        },
                        options: validationType.list,
                        error: element.error !== undefined
                    }
                };
            } else if (genericElement.inputType === 'number') {
                const numValidation = validationType && validationType.type === 'NumericRangeValidation'
                    ? validationType as NumericRangeValidation
                    : undefined;
                return {
                    type: 'number',
                    props: {
                        min: numValidation?.minValue,
                        max: numValidation?.maxValue,
                        value: String(currentValue ?? ''),
                        onInput: (e: React.SyntheticEvent) => {
                            const target = e.target as HTMLInputElement;
                            const numValue = target.value === '' ? undefined : BigInt(target.value);
                            onChange(element.key, numValue, parentKey);
                        },
                        error: element.error !== undefined
                    }
                };
            } else {
                return {
                    type: 'text',
                    props: {
                        value: String(currentValue ?? ''),
                        onInput: (e: React.SyntheticEvent) => {
                            const target = e.target as HTMLInputElement;
                            const textValue = target.value === '' ? undefined : target.value;
                            onChange(element.key, textValue, parentKey);
                        },
                        error: element.error !== undefined
                    }
                };
            }
        }

        case 'FormArray': {
            const arrayElement = element as FormArrayElement;

            let selectedValues: unknown[];
            if (Array.isArray(currentValue)) {
                selectedValues = currentValue;
            } else if (currentValue !== undefined && currentValue !== null && currentValue !== '') {
                selectedValues = [currentValue];
            } else {
                selectedValues = [];
            }

            if (isArrayHyperlinkValidation(arrayElement.validationType)) {
                return {
                    type: 'array-hyperlink-dropdown',
                    props: {
                        items: arrayElement.validationType.enum || [],
                        value: selectedValues.length > 0 ? String(selectedValues[0]) : '',
                        onChange: (value: string | undefined) => onChange(element.key, value ? [value] : undefined, parentKey),
                        error: arrayElement.error !== undefined,
                        onGoTo: options?.onGoTo
                    }
                };
            }

            if (isArrayMixedTypeValidation(arrayElement.validationType)) {
                const rules: ColumnRule[] = [];
                const totalItems = arrayElement.validationType.prefixItems.length;
                const minItems = arrayElement.validationType.minPrefixItems;
                const maxItems = arrayElement.validationType.maxPrefixItems;

                for(let i = 0; i < totalItems; i++) {
                    const nthItem = arrayElement.validationType.prefixItems[i];
                    if (isMixedArrayNumberList(nthItem)) {
                        rules.push({
                            type: "dropdown",
                            values: toOrAsArray(nthItem.enum).map(v => String(v)),
                            convertToNum: true
                        });
                    }
                    else if (isMixedArrayStringList(nthItem)) {
                        rules.push({
                            type: "dropdown",
                            values: toOrAsArray(nthItem.enum).map(v => String(v))
                        });
                    }
                    else if (isMixedArrayNumber(nthItem)) {
                        rules.push({
                            type: "number",
                            min: nthItem.minValue,
                            max: nthItem.maxValue,
                            convertToNum: true
                        });
                    }
                }

                // If min and max are the same, use the fixed-length HybridArray
                if (minItems === maxItems) {
                    return {
                        type: 'hybrid-array',
                        props: {
                            value: selectedValues as (string | bigint)[],
                            length: minItems,
                            onChange: (e: any) => onChange((element as any).key, e, parentKey),
                            colRules: rules,
                            error: arrayElement.error !== undefined
                        }
                    };
                }

                // Otherwise, use the dynamic component that supports add/remove
                return {
                    type: 'dynamic-hybrid-array',
                    props: {
                        value: selectedValues as (string | bigint | undefined)[],
                        minLength: minItems,
                        maxLength: maxItems,
                        allColRules: rules,
                        onChange: (e: any) => onChange((element as any).key, e, parentKey),
                        error: arrayElement.error !== undefined
                    }
                };
            } else {
                // Check if it's a single select case
                if (isArrayStringValidation(arrayElement.validationType) &&
                    arrayElement.validationType.enum != undefined && arrayElement.validationType.enum.length > 0) {
                        
                    const rawValues = arrayElement.validationType.enum;
                    const enumValues = toOrAsArray(arrayElement.validationType.enum).map((v) => Array.isArray(v) ? v.join(";") :v);
                    if (arrayElement.validationType.maxLength === 1 &&
                        arrayElement.validationType.minLength === 1) {
                        return {
                            type: 'array-single-select-dropdown',
                            props: {
                                value: String(rawValues.indexOf(String(selectedValues ?? ''))),
                                onChange: (e: Event) => {
                                    const component = e.target as any;
                                    const selectedValue = Number(component?.value);
                                    // -1 = None selected
                                    if(selectedValue === -1) {
                                        onChange(element.key, undefined, parentKey);
                                        return;
                                    }
                                    const targetValue = rawValues[selectedValue];
                                    if (Array.isArray(targetValue)) {
                                        onChange(element.key, targetValue, parentKey);
                                    }
                                    else {
                                        onChange(element.key, [targetValue], parentKey);
                                    }
                                },
                                enumValues: enumValues,
                                error: arrayElement.error !== undefined
                            }
                        };
                    }
                }

                // Multi-select dropdown for array enums
                const enumValues = isArrayStringValidation(arrayElement.validationType)
                    ? toOrAsArray(arrayElement.validationType.enum ?? [])
                    : [];

                return {
                    type: 'multi-select-dropdown',
                    props: {
                        options: enumValues,
                        value: selectedValues.map(val => String(val)),
                        onChange: (values: unknown[]) => onChange(element.key, values, parentKey),
                        allowMultiple: true,
                        placeholder: "Select options...",
                        createable: (enumValues.length === 0),
                        error: arrayElement.error !== undefined
                    }
                };
            }
        }

        case 'FormObject': {
            const objectElement = element as FormObjectElement;
            return {
                type: 'object',
                props: {
                    config: objectElement.config,
                    onChange,
                    parentKey: element.key,
                    options,
                    effectiveStyles,
                    error: element.error !== undefined
                }
            };
        }

        case 'FormMatrix': {
            let numCols = 0;
            let minCols: number | undefined = undefined;
            let maxCols: number | undefined = undefined;

            const validation = element.validationType! as MatrixValidation;
            const colHeaderProps: ColumnRule[] = [];
            const val = validation.definition;
            if (isArrayStringValidation(val)) {
                numCols = val.maxLength ?? 0;

                
                for (let i = 0; i < numCols; i++) {
                    colHeaderProps.push({
                        type: val.enum ? "dropdown" : "text",
                        values: val.enum ? toOrAsArray(val.enum).map(v => String(v)) : []
                    });
                }
            }
            else if (isArrayNumberValidation(val)) {
                numCols = val.maxLength ?? 0;

                for (let i = 0; i < numCols; i++) {
                    colHeaderProps.push({
                        type: "number",
                        min: val.minValue,
                        max: val.maxValue
                    });
                }
            }
            else if (isArrayMixedTypeValidation(val)) {
                numCols = val.prefixItems.length ?? 0;
                minCols = val.minPrefixItems;
                maxCols = val.maxPrefixItems;


                for (let i = 0; i < numCols; i++) {
                    const nthItem = val.prefixItems[i];
                    if (isMixedArrayNumberList(nthItem)) {
                        colHeaderProps.push({
                            type: "dropdown",
                            values: toOrAsArray(nthItem.enum).map(v => String(v)),
                            convertToNum: true
                        });
                    }
                    else if (isMixedArrayStringList(nthItem)) {
                        colHeaderProps.push({
                            type: "dropdown",
                            values: toOrAsArray(nthItem.enum).map(v => String(v))
                        });
                    }
                    else if (isMixedArrayNumber(nthItem)) {
                        colHeaderProps.push({
                            type: "number",
                            min: nthItem.minValue,
                            max: nthItem.maxValue
                        });
                    }
                }

            }

            // Special case: 1x1 matrix - render as simple form element with wrapping onChange
            if (numCols === 1 && validation.maxRows === 1) {
                const colRule = colHeaderProps[0];
                // Extract the single cell value from the matrix
                const matrixValue = currentValue as (string | bigint | undefined)[][] | undefined;
                const singleValue = matrixValue?.[0]?.[0];

                // Create onChange wrapper that wraps value into [[value]]
                const wrapOnChange = (newValue: unknown) => {
                    let val = newValue
                    // In case of undefined, do not wrap
                    if(colRule.convertToNum && newValue){
                        val = Number(newValue)
                    }
                    // Simple falsy check excludes 0 which is a valid setValue
                    const shouldWrap = val !== undefined && val !== null;
                    onChange(element.key, shouldWrap?[[val]]:val, parentKey);
                };

                // Render based on column rule type
                if (colRule?.type === "dropdown" && colRule.values && colRule.values.length > 0) {
                    return {
                        type: 'dropdown',
                        props: {
                            value: String(singleValue ?? ''),
                            options: colRule.values,
                            onChange: (e: Event) => {
                                const component = e.target as any;
                                const newValue = component?.value;
                                // Handle "None" option - empty string becomes undefined
                                if (newValue === "" || newValue == undefined) {
                                    wrapOnChange(undefined);
                                } else {
                                    // Parse as bigint if convertToNum is set
                                    const finalValue = colRule.convertToNum ? BigInt(newValue) : newValue;
                                    wrapOnChange(finalValue);
                                }
                            },
                            error: element.error !== undefined
                        }
                    };
                } else if (colRule?.type === "number") {
                    return {
                        type: 'number',
                        props: {
                            value: String(singleValue ?? ''),
                            min: colRule.min,
                            max: colRule.max,
                            onInput: (e: React.SyntheticEvent) => {
                                const target = e.target as HTMLInputElement;
                                const numValue = target.value === '' ? undefined : BigInt(target.value);
                                wrapOnChange(numValue);
                            },
                            error: element.error !== undefined
                        }
                    };
                } else {
                    // Default to text input
                    return {
                        type: 'text',
                        props: {
                            value: String(singleValue ?? ''),
                            onInput: (e: React.SyntheticEvent) => {
                                const target = e.target as HTMLInputElement;
                                const textValue = target.value === '' ? undefined : target.value;
                                wrapOnChange(textValue);
                            },
                            error: element.error !== undefined
                        }
                    };
                }
            }

            // Normal matrix rendering
            return {
                type: 'matrix',
                props: {
                    cols: numCols,
                    minCols: minCols ?? numCols,
                    maxCols: maxCols ?? numCols,
                    value: currentValue as (string | bigint | undefined)[][] | undefined,
                    onChange: (value: any) => onChange(element.key, value, parentKey),
                    error: element.error !== undefined,
                    colRules: colHeaderProps,
                    maxRows: validation.maxRows,
                }
            };
        }

        default: {
            // Fallback to text input - should never happen with proper typing
            const fallbackElement = element as any;
            return {
                type: 'text',
                props: {
                    value: String(currentValue ?? ''),
                    onInput: (e: React.SyntheticEvent) => {
                        const target = e.target as HTMLInputElement;
                        const textValue = target.value === '' ? undefined : target.value;
                        onChange(fallbackElement.key, textValue, parentKey);
                    },
                    error: fallbackElement.error !== undefined
                }
            };
        }
    }
}

/**
 * Render a component based on the provided specification.
 * This function takes a FormComponentSpec and returns the appropriate React component.
 *
 * @param spec - The specification describing what component to render
 * @returns React node representing the rendered component
 */
function renderFormComponent(spec: FormComponentSpec): React.ReactNode {
    switch (spec.type) {
        case 'checkbox':
            return <CheckboxField {...spec.props} />;

        case 'dropdown':
            return <DropdownField {...spec.props} />;

        case 'number':
            return <NumberField {...spec.props} />;

        case 'text':
            return <TextField {...spec.props} />;

        case 'array-single-select-dropdown':
            return <ArraySingleSelectDropdown {...spec.props} />;

        case 'multi-select-dropdown':
            return <MultiSelectDropdown {...spec.props} />;
            
        case 'dynamic-hybrid-array':
            return <DynamicHybridArray {...spec.props} />;
            
        case 'array-hyperlink-dropdown':
            return <ArrayHyperlink {...spec.props} />;

        case 'hybrid-array':
            return <HybridArray {...spec.props} />;

        case 'matrix':
            return <Matrix {...spec.props} renderCellComponent={renderFormComponent as CellRendererFn} />;

        case 'object':
            return (
                <FormObjectContainer
                    {...spec.props}
                    renderFormElement={renderFormElement}
                />
            );
    }
}

function isGenericFormElement(element: FormElement): element is GenericFormElement {
    return element.type === "Generic"
}

function isFormElementCustom(element: GenericFormElement) {
    return element.inputType === "custom" ||
        element.inputType === "custom-flag" ||
        element.inputType === "custom-number" ||
        element.inputType === "custom-phandle";
}

/**
 * Recursively renders a form element based on its type
 * 
 * @param element - The form element to render
 * @param onChange - Callback function when the element's value changes
 * @param parentKey - Optional parent key for nested form elements
 * @param options - Optional configuration including custom styles
 * @returns React node representing the rendered form element
 */
export function renderFormElement(
    element: FormElement,
    onChange: (elementKey: string, newValue: unknown, parentKey?: string) => void,
    parentKey: string | undefined,
    options: RenderFormElementOptions
): React.ReactNode {
    const effectiveStyles = options?.customStyles || styles;
    //const deleteCustomProperty = useDeviceInstanceStore((state) => state.deleteCustomProperty);

    if (options && options.recursively === false && element.type === 'FormObject') {
        return null;
    }

    // Get current value: use setValue if available, otherwise undefined
    // The dropdown component handles defaultValue internally to track user changes
    const getCurrentValue = (elem: FormElement): unknown => {
        if ('setValue' in elem && elem.setValue !== undefined) {
            return elem.setValue;
        }

        return undefined;
    };

    const currentValue = getCurrentValue(element);

    // Parse the element to get rendering specification
    const componentSpec = parseFormElement(element, currentValue, onChange, parentKey, options);

    // Render the component based on the specification
    const inputComponent = renderFormComponent(componentSpec);

    const handleDeleteProperty = (name: string) => {
        options.deleteCustomPropsHandler(name)
    }

    if (inputComponent === null) {
        return null;
    }

    return (
        <div key={element.key} className={effectiveStyles.fieldContainer}>
            <div className={effectiveStyles.fieldLabelGroup}>
                <div className={styles.descriptionLabelContainer}>
                    <VscodeLabel>
                        {element.key}
                    </VscodeLabel>
                    {element.description && (
                        <Tooltip
                            className={styles.tooltip}
                            label={element.description}
                            position="top"
                        >
                            <VscodeIcon name="info" />
                        </Tooltip>
                    )}
                </div>
                <div className={effectiveStyles.badgeContainer}>
                    {isGenericFormElement(element) && isFormElementCustom(element) ? (
                        <span className={`${styles.customBadge} ${effectiveStyles.optionalBadge}`}><GhostButton icon="trash" onClick={() => handleDeleteProperty(element.key)} /> Custom </span>          
                    ): !element.required && (
                        <span className={effectiveStyles.optionalBadge}>Optional</span>
                    )}
                </div>
            </div>

            {inputComponent}

            {element.error && (
                <span className={effectiveStyles.errorBadge} title={element.error.message}>
                    {capitalize(element.error.message)}
                </span>
            )}
        </div>
    );
}
