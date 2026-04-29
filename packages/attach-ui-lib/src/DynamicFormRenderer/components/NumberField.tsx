import { VscodeTextfield } from "hds-react";
import { useEffect, useState, type SyntheticEvent } from "react";
import styles from '../DynamicFormRenderer.module.scss'

function testHex(str: string): boolean {
    return /^[0-9a-fA-F]+$/. test(str);
}

function testDec(str: string): boolean {
    return /^[0-9]+$/. test(str);
}

function capitalize(str: string): string {
    if (!str) return str;
    return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Parse a string value (hex or decimal) to BigInt
 * @returns Object with { success: boolean, value?: bigint, error?: string }
 */
function parseNumberValue(inputValue: string): { success: boolean; value?: bigint; error?: string } {
    if (!inputValue) {
        return { success: false, error: 'Empty value' };
    }

    try {
        if (inputValue.startsWith('0x')) {
            const hexPart = inputValue.slice(2);
            if (!testHex(hexPart)) {
                return { success: false, error: 'Invalid hex value' };
            }
            return { success: true, value: BigInt(inputValue) };
        } else {
            if (!testDec(inputValue)) {
                return { success: false, error: 'Invalid decimal value' };
            }
            return { success: true, value: BigInt(inputValue) };
        }
    } catch {
        return { success: false, error: 'Invalid number format' };
    }
}

interface NumberFieldProps {
    value: string;
    min?: bigint;
    max?: bigint;
    onInput: (e: SyntheticEvent) => void;
    error: boolean;
}

export function NumberField({ value, min, max, onInput, error }: NumberFieldProps) {
    const [userValue, setUserValue] = useState(value);
    const [localError, setLocalError] = useState('');

    useEffect(() => {
        // When value prop changes from parent, check if it's numerically equal
        // to the current userValue. If so, preserve the user's format (hex/decimal).
        
        if (!value || !userValue) {
            setUserValue(value);
            return;
        }
        
        const incomingResult = parseNumberValue(value);
        const currentResult = parseNumberValue(userValue);
        
        // If either parsing failed, or values are numerically different, update
        if (!incomingResult.success || !currentResult.success) {
            setUserValue(value);
            return;
        }
        
        // If numerically different, update to new value
        // If numerically equal, keep user's format (do nothing)
        // This is because the backend may send the same value but in base 10.
        if (incomingResult.value !== currentResult.value) {
            setUserValue(value);
        }
        
        // Note: userValue is intentionally not in dependencies - we only want to react to prop changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    /**
     * Custom input handler that intercepts the input event,
     * validates hex/decimal values, and passes modified event to parent
     */
    function handleInput(e: SyntheticEvent) {
        const input = e.target as HTMLInputElement;
        const inputValue = input.value.trim();
        
        // Update local state
        setUserValue(inputValue);
        setLocalError('');
        
        // If empty, pass through
        if (!inputValue) {
            onInput(e);
            return;
        }
        
        // Parse the input value
        const parseResult = parseNumberValue(inputValue);
        
        if (!parseResult.success) {
            setLocalError(parseResult.error || 'Invalid number format');
            return;
        }
        
        const base10Value = parseResult.value!;
        
        // Validate min/max constraints
        if (min !== undefined && base10Value < min) {
            setLocalError(`Value is below required minimum ${min}`);
            return;
        }
        
        if (max !== undefined && base10Value > max) {
            setLocalError(`Value is above required maximum ${max}`);
            return;
        }
        
        // Create modified event with normalized decimal value
        // Important: Create a minimal event object to avoid BigInt serialization issues
        // when this data flows through VS Code's webview postMessage
        const normalizedValue = base10Value.toString();
        
        // Create a clean synthetic event without BigInt references
        const cleanEvent = {
            ...e,
            target: { value: normalizedValue } as HTMLInputElement,
            currentTarget: { value: normalizedValue } as HTMLInputElement
        };
        
        // Pass modified event to parent
        onInput(cleanEvent as SyntheticEvent);
    }
    
    return (
        <div style={{width: "100%"}}>
            <VscodeTextfield
                style={{width: "100%"}}
                invalid={error && (localError.length > 0)}
                type="text"
                value={userValue}
                onInput={handleInput}
            />
                {!error && (localError.length > 0) && (
                    <span className={styles.errorBadge} title={localError}>
                    {capitalize(localError)}
                </span>)}
        </div>
    );
}
