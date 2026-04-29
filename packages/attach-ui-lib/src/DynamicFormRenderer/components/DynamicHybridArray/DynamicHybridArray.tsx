import { VscodeIcon, VscodeOption, VscodeSingleSelect, VscodeTextfield } from "hds-react";
import { memo, useCallback, useEffect, useState } from "react";
import { NumberField } from "../NumberField";
import type { ColumnRule } from "../Matrix/Matrix";
import styles from "./DynamicHybridArray.module.scss";
import GhostButton from "../../../GhostButton/GhostButton";

export interface DynamicHybridArrayProps {
	/** Minimum number of fields to display (from minPrefixItems) */
	minLength: number;
	/** Maximum number of fields that can be added (from maxPrefixItems) */
	maxLength: number;
	/** Column rules for ALL possible fields (one per prefixItem) */
	allColRules: ColumnRule[];
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
 * DynamicHybridArray component displays a variable-length array of values vertically
 * with different input types per field. Starts with minLength fields and allows adding
 * more up to maxLength. Each field type is determined by its corresponding column rule.
 */
function DynamicHybridArray({
	minLength,
	maxLength,
	allColRules,
	value = [],
	defaultValue = [],
	onChange,
	label,
	disabled = false,
	error = false,
	placeholder = "",
}: DynamicHybridArrayProps) {
	// Determine visible count: at least minLength, at most maxLength,
	// but also account for existing values
	const [visibleCount, setVisibleCount] = useState(() =>
		Math.min(maxLength, Math.max(minLength, value.length || defaultValue.length))
	);

	// Sync visibleCount when external value changes (e.g., device switch)
	useEffect(() => {
		const inferredCount = Math.min(maxLength, Math.max(minLength, value.length));
		if (inferredCount !== visibleCount) {
			setVisibleCount(inferredCount);
		}
	}, [value.length, minLength, maxLength]);

	// Use provided value or default value, ensure it has the correct length
	const arrayValues = value.length > 0 ? value : defaultValue;
	const paddedValues = Array.from({ length: visibleCount }, (_, i) => arrayValues[i] ?? "");

	const isMaxReached = visibleCount >= maxLength;
	const canRemove = visibleCount > minLength;

	const handleFieldChange = useCallback(
		(index: number, newValue: string) => {
			const rule = allColRules[index];
			let processedValue: string | number | bigint | undefined = newValue;

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
		[paddedValues, onChange, allColRules]
	);

	const handleAddField = useCallback(() => {
		if (isMaxReached || disabled) {
			return;
		}

		const newCount = visibleCount + 1;
		setVisibleCount(newCount);

		// Create default value based on the rule for the new field
		const rule = allColRules[visibleCount];
		const defaultVal: string | bigint = (rule?.convertToNum || rule?.type === "number") ? 0n : String(rule.values?.[0]) ?? "";

		onChange([...paddedValues, defaultVal]);
	}, [visibleCount, paddedValues, allColRules, isMaxReached, disabled, onChange]);

	const handleRemoveLast = useCallback(() => {
		if (!canRemove || disabled) {
			return;
		}

		const newCount = visibleCount - 1;
		setVisibleCount(newCount);
		onChange(paddedValues.slice(0, newCount));
	}, [visibleCount, paddedValues, canRemove, disabled, onChange]);

	const renderField = useCallback(
		(fieldValue: string | number | bigint, index: number) => {
			const rule = allColRules[index];
			const fieldValueStr = String(fieldValue);
			const isRemovable = canRemove && index === visibleCount - 1;

			// Render dropdown
			if (rule?.type === "dropdown" && rule.values) {
				return (
					<div key={`field-${index}`} className={styles.fieldRow}>
						<div className={styles.field}>
							<VscodeSingleSelect
								className={styles.fieldInput}
								value={fieldValueStr}
								onChange={(e: any) => handleFieldChange(index, e.target.value)}
								disabled={disabled}
							>
                                {/* Disalllow none, as it will send undefined causing an offset in the array. */}
								{index == 0 && <VscodeOption key="none" value=""> None </VscodeOption>}
								{rule.values.map((option, idx) => (
									<VscodeOption key={`option-${idx}`} value={option}>
										{option}
									</VscodeOption>
								))}
							</VscodeSingleSelect>
						</div>
						{isRemovable && (
							<button
								type="button"
								className={styles.removeButton}
								onClick={handleRemoveLast}
								disabled={disabled}
								aria-label="Remove last field"
								title="Remove last field"
							>
								<VscodeIcon name="trash" />
							</button>
						)}
					</div>
				);
			}

			// Render number input
			if (rule?.type === "number" || rule?.convertToNum) {
				return (
					<div key={`field-${index}`} className={styles.fieldRow}>
						<div className={styles.field}>
							<NumberField
								value={fieldValueStr}
								onInput={(e: any) => handleFieldChange(index, e.target.value)}
								error={false}
								min={rule.min}
								max={rule.max}
							/>
						</div>
						{isRemovable && (
							<GhostButton
								onClick={handleRemoveLast}
								disabled={disabled}
								title="Remove last field"
							>
								<VscodeIcon name="trash" />
							</GhostButton>
						)}
					</div>
				);
			}

			// Render text input (default)
			return (
				<div key={`field-${index}`} className={styles.fieldRow}>
					<div className={styles.field}>
						<VscodeTextfield
							type="text"
							className={styles.fieldInput}
							value={fieldValueStr}
							onInput={(e: any) => handleFieldChange(index, e.target.value)}
							placeholder={placeholder}
							disabled={disabled}
						/>
					</div>
					{isRemovable && (
						<button
							type="button"
							className={styles.removeButton}
							onClick={handleRemoveLast}
							disabled={disabled}
							aria-label="Remove last field"
							title="Remove last field"
						>
							<VscodeIcon name="trash" />
						</button>
					)}
				</div>
			);
		},
		[allColRules, disabled, placeholder, handleFieldChange, handleRemoveLast, canRemove, visibleCount]
	);

	return (
		<div className={styles.container}>
			{label && <div className={styles.label}>{label}</div>}

			<div className={`${styles.array} ${disabled ? styles.disabled : ''} ${error ? styles.error : ''}`}>
				<div className={styles.fields}>
					{paddedValues.map((fieldValue, index) => renderField(fieldValue, index))}
				</div>

				{/* Add Field Button */}
				<div className={styles.addFieldContainer}>
					<button
						type="button"
						className={styles.addButton}
						onClick={handleAddField}
						disabled={disabled || isMaxReached}
						aria-label="Add field"
						title={isMaxReached ? `Maximum ${maxLength} fields allowed` : "Add field"}
					>
						<VscodeIcon name="add" />
						<span>Add Field</span>
					</button>
					<span className={styles.fieldCount}>
						{visibleCount} / {maxLength} fields
					</span>
				</div>
			</div>
		</div>
	);
}

export default memo(DynamicHybridArray);
