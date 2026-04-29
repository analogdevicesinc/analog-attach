import { VscodeOption, VscodeSingleSelect, VscodeTextfield } from "hds-react";
import { memo, useCallback } from "react";
import { NumberField } from "../NumberField";
import styles from "./HybridArray.module.scss";

export interface HybridArrayColumnRule {
	/** Input type for this column */
	type: "text" | "number" | "dropdown";
	/** Available values for dropdown type */
	values?: string[];
	/** Convert value to number before calling onChange */
	convertToNum?: boolean;
	/** Label for this field */
	label?: string;
}

export interface HybridArrayProps {
	/** Number of elements (columns that become rows in vertical layout) */
	length: number;
	/** Column rules (one per element) */
	colRules?: HybridArrayColumnRule[];
	/** Current array values */
	value?: (string | bigint | undefined)[];
	/** Default value if no value is provided */
	defaultValue?: (string | bigint | undefined)[];
	/** Callback when values change */
	onChange: (values: (string | bigint | undefined)[]) => void;
	/** Optional label for the array */
	label?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Error state. If true, shows red border */
	error?: boolean;
	/** Placeholder for empty fields */
	placeholder?: string;
}

/**
 * HybridArray component displays an array of values vertically with different input types.
 * Similar to Matrix but with a single row displayed as a column.
 */
function HybridArray({
	length,
	colRules,
	value = [],
	defaultValue = [],
	onChange,
	label,
	disabled = false,
	error = false,
	placeholder = "",
}: HybridArrayProps) {
	// Use provided value or default value, ensure it has the correct length
	const arrayValues = value.length > 0 ? value : defaultValue;
	const paddedValues = Array.from({ length }, (_, i) => arrayValues[i] ?? "");

	const handleFieldChange = useCallback(
		(index: number, newValue: string) => {
			const rule = colRules?.[index];
			let processedValue: string | number | bigint | undefined = newValue;
			
			console.log('rule?.convertToNum', rule?.convertToNum);
			// Handle "None" selection (empty string)
			if (newValue === "") {
				processedValue = undefined;
			}
			// Convert to bigint if convertToNum is true
			else if (rule?.convertToNum) {
				try {
					processedValue = BigInt(newValue);
				} catch {
					processedValue = 0n;
				}
			}
			
			const newArray = paddedValues.map((val, idx) =>
				idx === index ? processedValue : val
			);
			
			onChange(newArray);
		},
		[paddedValues, onChange, colRules]
	);

	const renderField = useCallback(
		(fieldValue: string | number | bigint, index: number) => {
			const rule = colRules?.[index];
			const fieldValueStr = String(fieldValue);
			const fieldLabel = rule?.label;

			// Render dropdown
			if (rule?.type === "dropdown" && rule.values) {
				return (
					<div key={`field-${index}`} className={styles.field}>
						{fieldLabel && <label className={styles.fieldLabel}>{fieldLabel}</label>}
						<VscodeSingleSelect
							className={styles.fieldInput}
							value={fieldValueStr}
							onChange={(e: any) => handleFieldChange(index, e.target.value)}
							disabled={disabled}
						>
							<VscodeOption key="none" value=""> None </VscodeOption>
							{rule.values.map((option, idx) => (
								<VscodeOption key={`option-${idx}`} value={option}>
									{option}
								</VscodeOption>
							))}
						</VscodeSingleSelect>
					</div>
				);
			}

			// Render number input
			if (rule?.type === "number" || rule?.convertToNum) {
				return (
					<div key={`field-${index}`} className={styles.field}>
						{fieldLabel && <label className={styles.fieldLabel}>{fieldLabel}</label>}
						<NumberField
							value={fieldValueStr}
							onInput={(e: any) => handleFieldChange(index, e.target.value)}
							error={false}
						/>
					</div>
				);
			}

			// Render text input (default)
			return (
				<div key={`field-${index}`} className={styles.field}>
					<label className={styles.fieldLabel}>{fieldLabel}</label>
					<VscodeTextfield
						type="text"
						className={styles.fieldInput}
						value={fieldValueStr}
						onInput={(e: any) => handleFieldChange(index, e.target.value)}
						placeholder={placeholder}
						disabled={disabled}
					/>
				</div>
			);
		},
		[colRules, disabled, placeholder, handleFieldChange]
	);

	return (
		<div className={styles.container}>
			{label && <div className={styles.label}>{label}</div>}
			
			<div className={`${styles.array} ${disabled ? styles.disabled : ''} ${error ? styles.error : ''}`}>
				<div className={styles.fields}>
					{paddedValues.map((fieldValue, index) => renderField(fieldValue, index))}
				</div>
			</div>
		</div>
	);
}

export default memo(HybridArray);
