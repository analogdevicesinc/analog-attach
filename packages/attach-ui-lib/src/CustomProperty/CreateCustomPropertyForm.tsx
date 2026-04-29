import { VscodeButton, VscodeButtonGroup, VscodeCheckbox, VscodeTextfield } from 'hds-react';
import React, { useEffect, useState } from 'react';
import GhostButton from '../GhostButton/GhostButton';
import styles from './CustomProperty.module.scss';

interface CreateCustomPropertyFormProps {
	/** Callback when the new property is saved */
	onSave: (propertyName: string, propertyValue: string | boolean) => void | Promise<void>;
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
	const [isFlag, setIsFlag] = useState(false);
	const [propertyStringValue, setPropertyStringValue] = useState<string>('');
	const [propertyBooleanValue, setPropertyBooleanValue] = useState<boolean>(false);

	const formRef = React.useRef<HTMLDivElement>(null);

	useEffect(() => {
		setTimeout(() => {
			formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
		}, 50);
	}, []);

	const handleSaveProperty = async () => {
		if (propertyName.trim()) {
			if (onSave) {
				await onSave(propertyName, isFlag ? propertyBooleanValue:propertyStringValue);
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
				<VscodeButton variant={isFlag?"secondary":"primary"} onClick={() => setIsFlag(false)}>Text</VscodeButton>
				<VscodeButton variant={isFlag?"primary":"secondary"} onClick={() => setIsFlag(true)}>Flag</VscodeButton>
			</VscodeButtonGroup>
			<div className={styles.propertyValueContainer}>
				<label className={styles.propertyValueLabel}>Property Value</label>
			
				{isFlag && (
					<VscodeCheckbox
						className={styles.propertyField}
						label='Enabled'
						checked={propertyBooleanValue}
						onChange={() => setPropertyBooleanValue(!propertyBooleanValue)}
					/>
				) }
				{!isFlag && (
					<VscodeTextfield
						placeholder="Start typing..."
						className={styles.propertyField}
						value={propertyStringValue}
						onInput={(e) => setPropertyStringValue((e.target as HTMLInputElement).value)}
					/>
				) }
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
