import { VscodeButton, VscodeButtonGroup, VscodeCheckbox, VscodeTextfield } from 'hds-react';
import React, { useEffect, useState } from 'react';
import GhostButton from '../GhostButton/GhostButton';
import styles from './CustomProperty.module.scss';

export type CustomPropertyType = 'text' | 'flag' | 'number' | 'phandle';

interface CreateCustomPropertyFormProps {
	/** Callback when the new property is saved */
	onSave: (propertyName: string, propertyValue: string | boolean | number, propertyType: CustomPropertyType) => void | Promise<void>;
	/** Callback when creation is cancelled */
	onCancel?: () => void | Promise<void>;
	mode?: "pnp" | "tree-view"
}

/**
 * Form component for creating a brand-new custom property.
 * Starts with empty fields and auto-scrolls into view on mount.
 */
export function CreateCustomPropertyForm({
	onSave,
	onCancel,
	mode = "pnp"
}: CreateCustomPropertyFormProps) {
	const [propertyName, setPropertyName] = useState('');
	const [propertyType, setPropertyType] = useState<CustomPropertyType>('text');
	const [propertyStringValue, setPropertyStringValue] = useState<string>('');
	const [propertyBooleanValue, setPropertyBooleanValue] = useState<boolean>(false);
	const [propertyNumberValue, setPropertyNumberValue] = useState<number>(0);

	const formRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		setTimeout(() => {
			formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
		}, 50);
	}, []);

	const handleSaveProperty = async () => {
		if (propertyName.trim()) {
			if (onSave) {
				let value: string | boolean | number;
				switch (propertyType) {
					case 'flag':
						value = propertyBooleanValue;
						break;
					case 'number':
						value = propertyNumberValue;
						break;
					case 'text':
					case 'phandle':
					default:
						value = propertyStringValue;
						break;
				}
				await onSave(propertyName, value, propertyType);
			}
		}
	};

	const handleCancel = async () => {
		if (onCancel) {
			await onCancel();
		}
	};

	return (
		<div className={`${styles.customPropertyForm} ${mode == "tree-view" && styles.paddedElements}`} ref={formRef}>
			<div className={styles.propertyHeader}>
				<label className={styles.propertyNameLabel}>
					Property Name
				</label>
				<span className={styles.infoField}>
					<GhostButton icon="trash" onClick={handleCancel} /> Custom
				</span>
			</div>
			<VscodeTextfield
				placeholder="Enter Property Name"
				className={styles.propertyField}
				value={propertyName}
				onInput={(e) => setPropertyName((e.target as HTMLInputElement).value)}
			/>
			<VscodeButtonGroup style={{width: "100%"}}>
				<VscodeButton variant={propertyType === 'text' ? "primary" : "secondary"} onClick={() => setPropertyType('text')}>Text</VscodeButton>
				<VscodeButton variant={propertyType === 'flag' ? "primary" : "secondary"} onClick={() => setPropertyType('flag')}>Flag</VscodeButton>
				<VscodeButton variant={propertyType === 'number' ? "primary" : "secondary"} onClick={() => setPropertyType('number')}>Number</VscodeButton>
				<VscodeButton variant={propertyType === 'phandle' ? "primary" : "secondary"} onClick={() => setPropertyType('phandle')}>Phandle</VscodeButton>
			</VscodeButtonGroup>
			<div className={styles.propertyValueContainer}>
				<label className={styles.propertyValueLabel}>Property Value</label>

				{propertyType === 'flag' && (
					<VscodeCheckbox
						className={styles.propertyField}
						label='Enabled'
						checked={propertyBooleanValue}
						onChange={() => setPropertyBooleanValue(!propertyBooleanValue)}
					/>
				)}
				{propertyType === 'text' && (
					<VscodeTextfield
						placeholder="Start typing..."
						className={styles.propertyField}
						value={propertyStringValue}
						onInput={(e) => setPropertyStringValue((e.target as HTMLInputElement).value)}
					/>
				)}
				{propertyType === 'number' && (
					<VscodeTextfield
						placeholder="Enter a number..."
						className={styles.propertyField}
						type="number"
						value={String(propertyNumberValue)}
						onInput={(e) => setPropertyNumberValue(Number((e.target as HTMLInputElement).value))}
					/>
				)}
				{propertyType === 'phandle' && (
					<VscodeTextfield
						placeholder="e.g. gpio0"
						className={styles.propertyField}
						value={propertyStringValue}
						onInput={(e) => setPropertyStringValue((e.target as HTMLInputElement).value)}
					/>
				)}
			</div>
			<VscodeButton
				className={styles.saveCustomPropertyButton}
				variant="primary"
				size="large"
				onClick={handleSaveProperty}
				disabled={!propertyName.trim()}
			>
				Add Property
			</VscodeButton>
		</div>
	);
}
