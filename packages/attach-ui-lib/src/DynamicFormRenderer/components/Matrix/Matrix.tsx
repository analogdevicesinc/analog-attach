import { VscodeIcon } from "hds-react";
import type { ReactNode, SyntheticEvent, FormEvent } from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { DropdownField } from "../DropdownField";
import { NumberField } from "../NumberField";
import { TextField } from "../TextField";
import styles from "./Matrix.module.scss";

export interface ColumnRule {
	/** Input type for this column */
	type: "text" | "number" | "dropdown";
	/** Available values for dropdown type */
	values?: string[];
	/** Convert value to number before calling onChange */
	convertToNum?: boolean;
	/** Min and max values for number type */
	min?: bigint;
	max?: bigint;
}

/**
 * Spec for rendering a single matrix cell.
 * Mirrors a subset of FormComponentSpec (dropdown | number | text).
 * Defined here to avoid circular dependency: DynamicFormRenderer → Matrix → DynamicFormRenderer.
 */
export type CellComponentSpec =
	| {
		type: "dropdown";
		props: {
			value: string;
			options: (string | boolean | bigint)[];
			onChange: (e: Event) => void;
			error: boolean;
			disabled?: boolean;
		};
	}
	| {
		type: "number";
		props: {
			value: string;
			min?: bigint;
			max?: bigint;
			onInput: (e: SyntheticEvent) => void;
			error: boolean;
		};
	}
	| {
		type: "text";
		props: {
			value: string;
			onInput: (e: FormEvent) => void;
			error: boolean;
			disabled?: boolean;
			placeholder?: string;
		};
	};

/**
 * Renders a single cell from its spec.
 * Injected by DynamicFormRenderer to reuse its rendering pipeline.
 */
export type CellRendererFn = (spec: CellComponentSpec) => ReactNode;

export interface MatrixProps {
	/** Total possible columns (from schema) */
	cols: number;
	/** Minimum visible columns */
	minCols: number;
	/** Maximum visible columns */
	maxCols: number;
	/** Column headers (must match cols length) */
	columnHeaders?: string[];
	/** Column rules (must match cols length if provided) */
	colRules?: ColumnRule[];
	/** Current matrix values */
	value?: (string | bigint | undefined)[][];
	/** Default value when no value is provided */
	defaultValue?: (string | bigint | undefined)[][];
	/** Callback when values change */
	onChange: (values: (string | bigint | undefined)[][]) => void;
	/** Minimum number of rows */
	minRows?: number;
	/** Maximum number of rows */
	maxRows?: number;
	/** Label for the matrix */
	label?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Error state — shows red border */
	error?: boolean;
	/** Placeholder for empty cells */
	placeholder?: string;
	/**
	 * Cell renderer injected by parent (e.g. DynamicFormRenderer).
	 * Avoids circular import by passing renderFormComponent as a prop.
	 * Falls back to local DropdownField / NumberField / TextField when omitted.
	 */
	renderCellComponent?: CellRendererFn;
}

/** Default value for a new cell based on its column rule. */
function getDefaultCellValue(rule?: ColumnRule): string | bigint | undefined {
	if (!rule) return "";
	if (rule.type === "number" || rule.convertToNum) return 0n;
	return "";
}

/** Normalize rows to exactly `colCount` columns, cropping or filling as needed. */
function normalizeRows(
	rows: (string | bigint | undefined)[][],
	colCount: number,
	colRules?: ColumnRule[]
): (string | bigint | undefined)[][] {
	return rows.map(row => {
		const normalized = [...row.slice(0, colCount)];
		for (let i = normalized.length; i < colCount; i++) {
			normalized.push(getDefaultCellValue(colRules?.[i]));
		}
		return normalized;
	});
}

/** Fallback renderer when no renderCellComponent prop is provided. */
function defaultRenderCell(spec: CellComponentSpec): ReactNode {
	switch (spec.type) {
		case "dropdown":
			return <DropdownField {...spec.props} />;
		case "number":
			return <NumberField {...spec.props} />;
		case "text":
			return <TextField {...spec.props} />;
	}
}

function Matrix({
	cols,
	minCols,
	maxCols,
	columnHeaders,
	colRules,
	value,
	defaultValue = [],
	onChange,
	minRows = 0,
	maxRows,
	label,
	disabled = false,
	error = false,
	placeholder = "",
	renderCellComponent,
}: MatrixProps) {
	/** Currently visible column count. Users can add/remove within [minCols, maxCols]. */
	const [activeColCount, setActiveColCount] = useState(() => {
		const maxAvailable = Math.min(colRules?.length ?? cols, maxCols);
		return Math.max(minCols, Math.min(minCols, maxAvailable));
	});

	/** Internal rows — values may arrive cropped and need filling with defaults. */
	const [internalRows, setInternalRows] = useState<(string | bigint | undefined)[][]>(() =>
		normalizeRows(value ?? defaultValue, minCols, colRules)
	);

	/** Refs for stable access in callbacks (avoids stale closures). */
	const rowsRef = useRef(internalRows);
	rowsRef.current = internalRows;

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const colRulesRef = useRef(colRules);
	colRulesRef.current = colRules;

	/** Change-detection refs for the consolidated sync effect. */
	const prevValueRef = useRef(value);
	const prevColRulesLenRef = useRef(colRules?.length);
	const prevMinColsRef = useRef(minCols);
	const prevMaxColsRef = useRef(maxCols);

	/**
	 * Consolidated sync effect.
	 * Handles value changes, column-count clamping, and row re-normalisation in one place.
	 */
	const colRulesLength = colRules?.length ?? 0;

	useEffect(() => {
		const currentColRules = colRulesRef.current;
		const currentOnChange = onChangeRef.current;

		const valueChanged = value !== prevValueRef.current;
		const rulesLenChanged = colRulesLength !== (prevColRulesLenRef.current ?? 0);
		const boundsChanged =
			minCols !== prevMinColsRef.current || maxCols !== prevMaxColsRef.current;

		prevValueRef.current = value;
		prevColRulesLenRef.current = colRulesLength;
		prevMinColsRef.current = minCols;
		prevMaxColsRef.current = maxCols;

		/** Clamp column count within valid bounds. */
		const maxAvailable = Math.min(colRulesLength || cols, maxCols);
		const clampedColCount = Math.max(minCols, Math.min(activeColCount, maxAvailable));

		if (clampedColCount !== activeColCount) {
			setActiveColCount(clampedColCount);
		}

		if (valueChanged) {
			/** Parent provided a new value — normalise from it. */
			const source = value !== undefined ? value : [];
			setInternalRows(normalizeRows(source, clampedColCount, currentColRules));
		} else if (rulesLenChanged || boundsChanged || clampedColCount !== activeColCount) {
			/** Structural constraints changed — re-normalise and notify parent. */
			const normalized = normalizeRows(rowsRef.current, clampedColCount, currentColRules);
			setInternalRows(normalized);
			currentOnChange(normalized);
		}
	}, [value, colRulesLength, minCols, maxCols, cols, activeColCount]);

	/** Derived state. */
	const isMaxRowsReached = maxRows !== undefined && internalRows.length >= maxRows;
	const canDeleteRows = internalRows.length > minRows;
	const canAddColumn = activeColCount < maxCols;
	const canRemoveColumn = activeColCount > minCols;
	const showColumnControls = minCols !== maxCols;

	/** Update a single cell value. */
	const handleCellChange = useCallback(
		(rowIndex: number, colIndex: number, newValue: string) => {
			const rule = colRulesRef.current?.[colIndex];
			let processedValue: string | bigint | undefined = newValue;

			if (newValue === "") {
				processedValue = undefined;
			} else if (rule?.convertToNum) {
				try {
					processedValue = BigInt(newValue);
				} catch {
					processedValue = 0n;
				}
			}

			const currentRows = rowsRef.current;
			const newMatrix = currentRows.map((row, rIdx) =>
				rIdx === rowIndex
					? row.map((cell, cIdx) => (cIdx === colIndex ? processedValue : cell))
					: row
			);

			if (value === undefined) {
				setInternalRows(newMatrix);
			}
			onChangeRef.current(newMatrix);
		},
		[value]
	);

	/** Append a new row with default cell values. */
	const handleAddRow = useCallback(() => {
		if (disabled || isMaxRowsReached) return;

		const currentColRules = colRulesRef.current;
		const newRow = Array.from({ length: activeColCount }, (_, i) =>
			getDefaultCellValue(currentColRules?.[i])
		);

		const newMatrix = [...rowsRef.current, newRow];
		if (value === undefined) {
			setInternalRows(newMatrix);
		}
		onChangeRef.current(newMatrix);
	}, [activeColCount, disabled, isMaxRowsReached, value]);

	/** Delete a row by index. */
	const handleDeleteRow = useCallback(
		(rowIndex: number) => {
			if (disabled || !canDeleteRows) return;

			const newMatrix = rowsRef.current.filter((_, i) => i !== rowIndex);
			if (value === undefined) {
				setInternalRows(newMatrix);
			}
			onChangeRef.current(newMatrix);
		},
		[disabled, canDeleteRows, value]
	);

	/** Add a column (capped at maxCols). */
	const handleAddColumn = useCallback(() => {
		if (disabled || !canAddColumn) return;

		const newColCount = activeColCount + 1;
		setActiveColCount(newColCount);

		const rule = colRulesRef.current?.[activeColCount];
		const defaultVal = getDefaultCellValue(rule);
		const newMatrix = rowsRef.current.map(row => [...row, defaultVal]);

		if (value === undefined) {
			setInternalRows(newMatrix);
		}
		onChangeRef.current(newMatrix);
	}, [activeColCount, canAddColumn, disabled, value]);

	/** Remove the last column (floored at minCols). */
	const handleRemoveColumn = useCallback(() => {
		if (disabled || !canRemoveColumn) return;

		const newColCount = activeColCount - 1;
		setActiveColCount(newColCount);

		const newMatrix = rowsRef.current.map(row => row.slice(0, newColCount));
		if (value === undefined) {
			setInternalRows(newMatrix);
		}
		onChangeRef.current(newMatrix);
	}, [activeColCount, canRemoveColumn, disabled, value]);

	/** Build a CellComponentSpec per cell and delegate to the injected or fallback renderer. */
	const cellRenderer = renderCellComponent ?? defaultRenderCell;

	const renderCell = useCallback(
		(cell: string | bigint | undefined, rowIndex: number, colIndex: number) => {
			const rule = colRules?.[colIndex];
			const cellValue = String(cell ?? "");

			let spec: CellComponentSpec;

			if (rule?.type === "dropdown" && rule.values) {
				spec = {
					type: "dropdown",
					props: {
						value: cellValue,
						options: rule.values,
						onChange: (e: Event) => {
							const target = e.target as any;
							handleCellChange(rowIndex, colIndex, target.value ?? "");
						},
						error: false,
						disabled,
					},
				};
			} else if (rule?.type === "number" || rule?.convertToNum) {
				spec = {
					type: "number",
					props: {
						value: cellValue,
						min: rule.min,
						max: rule.max,
						onInput: (e: SyntheticEvent) => {
							const target = e.target as HTMLInputElement;
							handleCellChange(rowIndex, colIndex, target.value);
						},
						error: false,
					},
				};
			} else {
				spec = {
					type: "text",
					props: {
						value: cellValue,
						onInput: (e: FormEvent) => {
							const target = e.target as HTMLInputElement;
							handleCellChange(rowIndex, colIndex, target.value);
						},
						error: false,
						disabled,
						placeholder,
					},
				};
			}

			return cellRenderer(spec);
		},
		[colRules, disabled, placeholder, handleCellChange, cellRenderer]
	);

	const activeHeaders = columnHeaders?.slice(0, activeColCount);

	return (
		<div className={styles.container}>
			{label && <div className={styles.label}>{label}</div>}

			<div className={`${styles.matrix} ${disabled ? styles.disabled : ""} ${error ? styles.error : ""}`}>
				{/* Column Headers */}
				{activeHeaders && activeHeaders.length > 0 && (
					<div className={styles.headerRow}>
						{activeHeaders.map((header, index) => (
							<div key={`header-${index}`} className={styles.headerCell}>
								{header}
							</div>
						))}
						<div className={styles.headerCell} />
					</div>
				)}

				{/* Rows */}
				<div className={styles.rows}>
					{internalRows.length === 0 ? (
						<div className={styles.emptyMessage}>
							No rows yet. Click the + button to add a row.
						</div>
					) : (
						internalRows.map((row, rowIndex) => (
							<div key={`row-${rowIndex}`} className={styles.row}>
								{row.slice(0, activeColCount).map((cell, colIndex) => (
									<div key={`cell-${rowIndex}-${colIndex}`} className={styles.cell}>
										{renderCell(cell, rowIndex, colIndex)}
									</div>
								))}
								<div className={styles.actionCell}>
									<button
										type="button"
										className={styles.deleteButton}
										onClick={() => handleDeleteRow(rowIndex)}
										disabled={disabled || !canDeleteRows}
										aria-label={`Delete row ${rowIndex + 1}`}
										title={!canDeleteRows ? `Minimum ${minRows} row(s) required` : `Delete row ${rowIndex + 1}`}
									>
										<VscodeIcon name="trash" />
									</button>
								</div>
							</div>
						))
					)}
				</div>

				{/* Add Row */}
				<div className={styles.addRowContainer}>
					<button
						type="button"
						className={styles.addButton}
						onClick={handleAddRow}
						disabled={disabled || isMaxRowsReached}
						aria-label="Add row"
						title={isMaxRowsReached ? `Maximum ${maxRows} rows allowed` : "Add row"}
					>
						<VscodeIcon name="add" />
						<span>Add Row</span>
					</button>
					{maxRows !== undefined && (
						<span className={styles.rowCount}>
							{internalRows.length} / {maxRows} rows
						</span>
					)}
				</div>

				{/* Column Controls (shown when min !== max columns) */}
				{showColumnControls && (
					<div className={styles.addRowContainer}>
						<button
							type="button"
							className={styles.addButton}
							onClick={handleRemoveColumn}
							disabled={disabled || !canRemoveColumn}
							aria-label="Remove column"
							title={!canRemoveColumn ? `Minimum ${minCols} column(s) required` : "Remove last column"}
						>
							<VscodeIcon name="remove" />
							<span>Remove Column</span>
						</button>
						<button
							type="button"
							className={styles.addButton}
							onClick={handleAddColumn}
							disabled={disabled || !canAddColumn}
							aria-label="Add column"
							title={!canAddColumn ? `Maximum ${maxCols} columns allowed` : "Add column"}
						>
							<VscodeIcon name="add" />
							<span>Add Column</span>
						</button>
						<span className={styles.rowCount}>
							{activeColCount} / {maxCols} cols
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

export default memo(Matrix);
