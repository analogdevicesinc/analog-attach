import { VscodeIcon } from "hds-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import styles from "./MultiSelectDropdown.module.scss";

export interface MultiSelectDropdownProps {
	/** Array of available options */
	options: string[];
	/** Currently selected values (in order) */
	value?: string[];
	/** Default value if no value is provided */
	defaultValue?: string[];
	/** Callback when selection changes */
	onChange: (values: string[]) => void;
	/** Allow selecting the same option multiple times */
	allowMultiple?: boolean;
	/** Optional label for the dropdown */
	label?: string;
	/** Optional placeholder when no items selected */
	placeholder?: string;
	/** Disabled state */
	disabled?: boolean;
	/** Error state. If true, shows red border */
	error?: boolean;
	/** Minimum number of elements that must be selected */
	minElements?: number;
	/** Maximum number of elements that can be selected */
	maxElements?: number;
	/** Allow users to create new items */
	createable?: boolean;
	/** Callback when a new item is created (only used when createable is true) */
	onCreate?: (newValue: string) => void;
}


function MultiSelectDropdown({
	options,
	value,
	defaultValue = [],
	onChange,
	allowMultiple = false,
	label,
	placeholder = "Type to search or create...",
	disabled = false,
	error,
	minElements,
	maxElements,
	createable = false,
	onCreate,
}: MultiSelectDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const [isFocused, setIsFocused] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	
	// Use controlled value or fallback to default value
	const selectedValues = value !== undefined ? value : defaultValue;
	
	// Check if max elements reached
	const isMaxReached = maxElements !== undefined && selectedValues.length >= maxElements;
	
	// Merge options with selected values to ensure manually created values appear in the dropdown
	// Only add selected values that aren't already in options
	const allOptions = [...options];
	selectedValues.forEach(selectedValue => {
		if (!allOptions.includes(selectedValue)) {
			allOptions.push(selectedValue);
		}
	});
	
	// Filter options based on input value
	const filteredOptions = inputValue.trim()
		? allOptions.filter((option) => {
				// Filter based on allowMultiple setting
				const matchesSearch = option.toLowerCase().includes(inputValue.toLowerCase());
				if (allowMultiple) {
					return matchesSearch;
				}
				return matchesSearch && !selectedValues.includes(option);
		  })
		: (allowMultiple ? allOptions : allOptions.filter((option) => !selectedValues.includes(option)));

	// Check if we should show "Create" option
	const showCreateOption = createable && 
		inputValue.trim() !== "" && 
		!filteredOptions.some(opt => opt.toLowerCase() === inputValue.toLowerCase()) &&
		!isMaxReached;

	const handleContainerClick = useCallback(() => {
		if (!disabled) {
			setIsFocused(true);
			setIsOpen(true);
			// Use setTimeout to ensure the input is rendered before focusing
			setTimeout(() => {
				inputRef.current?.focus();
			}, 0);
		}
	}, [disabled]);

	const handleOptionClick = useCallback(
		(option: string) => {
			// Check max elements limit
			if (isMaxReached) {
				return;
			}
			
			let newValues: string[];
			
			if (allowMultiple) {
				newValues = [...selectedValues, option];
			} else {
				if (selectedValues.includes(option)) {
					return;
				}
				newValues = [...selectedValues, option];
			}
			
			onChange(newValues);
			setInputValue("");
			inputRef.current?.focus();
		},
		[selectedValues, allowMultiple, onChange, isMaxReached]
	);

	const handleRemoveValue = useCallback(
		(indexToRemove: number) => {
			// Check min elements limit
			if (minElements !== undefined && selectedValues.length <= minElements) {
				return;
			}
			
			const newValues = selectedValues.filter((_, index) => index !== indexToRemove);
			onChange(newValues);
		},
		[selectedValues, onChange, minElements]
	);

	const handleClearAll = useCallback(() => {
		// Check min elements limit
		if (minElements !== undefined && minElements > 0) {
			return;
		}
		
		onChange([]);
		setInputValue("");
		inputRef.current?.focus();
	}, [onChange, minElements]);

	const handleCreateItem = useCallback((newItem: string) => {
		const trimmedValue = newItem.trim();
		
		if (!trimmedValue || isMaxReached) {
			return;
		}

		// Check if value already exists (unless allowMultiple is true)
		if (!allowMultiple && selectedValues.includes(trimmedValue)) {
			setInputValue("");
			return;
		}

		// Add to selected values
		const newValues = [...selectedValues, trimmedValue];
		onChange(newValues);

		// Call onCreate callback if provided
		if (onCreate) {
			onCreate(trimmedValue);
		}

		// Clear input
		setInputValue("");
		inputRef.current?.focus();
	}, [selectedValues, onChange, onCreate, isMaxReached, allowMultiple]);

	const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
		if (!isOpen) {
			setIsOpen(true);
		}
	}, [isOpen]);

	const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (showCreateOption) {
				handleCreateItem(inputValue);
			} else if (filteredOptions.length > 0) {
				handleOptionClick(filteredOptions[0]);
			}
		} else if (e.key === 'Backspace' && inputValue === '' && selectedValues.length > 0) {
			// Remove last item on backspace if input is empty
			const canRemove = minElements === undefined || selectedValues.length > minElements;
			if (canRemove) {
				handleRemoveValue(selectedValues.length - 1);
			}
		} else if (e.key === 'Escape') {
			setIsOpen(false);
			setInputValue("");
		}
	}, [inputValue, showCreateOption, filteredOptions, selectedValues, minElements, handleCreateItem, handleOptionClick, handleRemoveValue]);

	const handleInputFocus = useCallback(() => {
		setIsOpen(true);
		setIsFocused(true);
	}, []);

	const handleChevronClick = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		if (!disabled) {
			setIsOpen((prev) => !prev);
			inputRef.current?.focus();
		}
	}, [disabled]);

	// Close dropdown when clicking outside
	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			if (containerRef.current && !containerRef.current.contains(target)) {
				setIsOpen(false);
				setInputValue("");
				setIsFocused(false);
			}
		};

		// Use setTimeout to avoid immediate closure on the same click that opened it
		const timeoutId = setTimeout(() => {
			document.addEventListener('click', handleClickOutside, true);
		}, 0);
		
		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener('click', handleClickOutside, true);
		};
	}, [isOpen]);

	const canClearAll = selectedValues.length > 0 && (minElements === undefined || minElements === 0);

	return (
		<div className={styles.container} ref={containerRef}>
			{label && <div className={styles.label}>{label}</div>}
			
			<div 
				className={`${styles.mainWidget} ${disabled ? styles.disabled : ''} ${error ? styles.error : ''}`}
				onClick={handleContainerClick}
			>
				<div className={styles.content}>
					{selectedValues.map((selectedValue, index) => {
						const canRemove = minElements === undefined || selectedValues.length > minElements;
						return (
							<div key={`${selectedValue}-${index}`} className={styles.badge}>
								<span className={styles.badgeText}>{selectedValue}</span>
								{!disabled && canRemove && (
									<button
										type="button"
										className={styles.removeButton}
										onClick={(e) => {
											e.stopPropagation();
											handleRemoveValue(index);
										}}
										aria-label={`Remove ${selectedValue}`}
									>
										<VscodeIcon name="close" />
									</button>
								)}
							</div>
						);
					})}
					
					{(isFocused || isOpen) && (
						<input
							ref={inputRef}
							type="text"
							className={styles.inlineInput}
							value={inputValue}
							onChange={handleInputChange}
							onKeyDown={handleInputKeyDown}
							onFocus={handleInputFocus}
							placeholder={selectedValues.length === 0 ? placeholder : ""}
							disabled={disabled || isMaxReached}
						/>
					)}
				</div>
				
				<div className={styles.actions}>
					{!disabled && canClearAll && (
						<button
							type="button"
							className={styles.clearButton}
							onClick={(e) => {
								e.stopPropagation();
								handleClearAll();
							}}
							aria-label="Clear all"
						>
							<VscodeIcon name="close" />
						</button>
					)}
					<button
						type="button"
						className={styles.chevronButton}
						onClick={handleChevronClick}
						disabled={disabled}
						aria-label="Toggle dropdown"
						aria-expanded={isOpen}
					>
						<VscodeIcon name={isOpen ? "chevron-up" : "chevron-down"} />
					</button>
				</div>
			</div>

			{isOpen && (
				<div className={styles.dropdown}>
					{showCreateOption && (
						<div 
							className={`${styles.option} ${styles.createOption}`}
							onClick={() => handleCreateItem(inputValue)}
						>
							<VscodeIcon name="add" />
							<span>Create "{inputValue}"</span>
						</div>
					)}
					
					{filteredOptions.length > 0 ? (
						<ul className={styles.optionList}>
							{filteredOptions.map((option, index) => (
								<li
									key={`${option}-${index}`}
									className={`${styles.option} ${isMaxReached ? styles.disabled : ''}`}
									onClick={() => !isMaxReached && handleOptionClick(option)}
								>
									{option}
								</li>
							))}
						</ul>
					) : !showCreateOption ? (
						<div className={styles.emptyMessage}>
							{createable ? "Start typing to create a new option." : "No options found."}
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

export default memo(MultiSelectDropdown);
