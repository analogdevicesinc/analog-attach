import type { GenericFormElement } from 'extension-protocol';
import { VscodeButton } from 'hds-react';
import { useState } from 'react';
import { CreateCustomPropertyForm } from './CreateCustomPropertyForm';
import styles from './CustomProperty.module.scss';

/**
 * Helper function to check if an element is a custom property
 */
export function isCustomProperty(element: GenericFormElement): boolean {
	return element.inputType === 'custom';
}

/**
 * Helper function to check if an element is a custom property flag
 */
export function isCustomPropertyFlag(element: GenericFormElement): boolean {
	return element.inputType === 'custom-flag';
}

/* -------------------------------------------------------------------------- */
/*                             CustomProperty                                 */
/* -------------------------------------------------------------------------- */

interface CustomPropertyProps {
	/** Callback when property is saved/updated */
	onSave?: (propertyName: string, propertyValue: string | boolean) => void | Promise<void>;
	/** Callback when adding is cancelled or property is deleted */
	onCancel?: () => void | Promise<void>;
	mode?: "pnp" | "tree-view"
}

/**
 * Component that displays an "Add Custom Property" button,
 * which shows the CreateCustomPropertyForm when clicked
 */
export function CreatePropertyToggle({ onSave, onCancel, mode="pnp" }: CustomPropertyProps) {
	const [isAddingProperty, setIsAddingProperty] = useState(false);

	const handleSave = async (propertyName: string, propertyValue: string | boolean) => {
		if (onSave) {
			await onSave(propertyName, propertyValue);
		}
		setIsAddingProperty(false);
	};

	const handleCancel = async () => {
		if (onCancel) {
			await onCancel();
		}
		setIsAddingProperty(false);
	};

	return (
		<div className={`${styles.customPropertyContainer} ${isAddingProperty && (mode=="pnp"?styles.customPropertyPnp:styles.customPropertyTreeView)}`}>
			{isAddingProperty ? (
				<CreateCustomPropertyForm
					onSave={handleSave}
					onCancel={handleCancel}
					mode={mode}
				/>
			) : (
				<VscodeButton
					className={styles.addCustomPropertyButton}
					variant="secondary"
					size="large"
					onClick={() => setIsAddingProperty(true)}
				>
					Add Custom Property
				</VscodeButton>
			)}
		</div>
	);
}
