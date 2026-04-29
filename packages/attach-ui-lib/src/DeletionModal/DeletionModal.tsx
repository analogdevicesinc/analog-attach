import { useEffect, useRef, useState } from 'react';
import styles from './DeletionModal.module.scss';
import { Modal, VscodeButton, VscodeCheckbox } from 'hds-react';
import { useVscodeStore } from '../store/useVscodeStore';
import { SettingsCommands, type GetSettingResponse, type UpdateSettingResponse } from 'extension-protocol';

const SKIP_SETTING_KEY = 'skipDeleteConfirmation';

type DeletionModalProps = {
	readonly isOpen: boolean;
	readonly itemName: string;
	readonly itemAlias?: string;
	readonly itemType: 'sensor' | 'channel';
	readonly onClose: () => void;
	readonly onDelete: () => void;
};

export function DeletionModal({
	isOpen,
	itemName,
	itemAlias,
	itemType,
	onClose,
	onDelete
}: DeletionModalProps) {
	const [dontShowAgain, setDontShowAgain] = useState(false);
	const [skipConfirmation, setSkipConfirmation] = useState<boolean | undefined>(undefined);
	const { sendRequest, isConnected } = useVscodeStore();
	const settingLoaded = useRef(false);
	const autoDeleteFired = useRef(false);

	// Reset cache when modal closes so the setting is re-fetched on next open
	useEffect(() => {
		if (!isOpen) {
			settingLoaded.current = false;
			autoDeleteFired.current = false;
			setSkipConfirmation(undefined);
		}
	}, [isOpen]);

	// Load the setting from VS Code configuration on each open
	useEffect(() => {
		if (!isOpen || settingLoaded.current || !isConnected) return;

		sendRequest<GetSettingResponse>({
			command: SettingsCommands.getSetting,
			payload: { key: SKIP_SETTING_KEY },
		}).then((response) => {
			if (response.status === 'success' && typeof response.payload.value === 'boolean') {
				setSkipConfirmation(response.payload.value);
			} else {
				setSkipConfirmation(false);
			}
			settingLoaded.current = true;
		}).catch(() => {
			setSkipConfirmation(false);
			settingLoaded.current = true;
		});
	}, [isOpen, isConnected, sendRequest]);

	// Auto-delete when setting is loaded and skip is enabled
	useEffect(() => {
		if (isOpen && skipConfirmation === true && !autoDeleteFired.current) {
			autoDeleteFired.current = true;
			onDelete();
		}
	}, [isOpen, skipConfirmation, onDelete]);

	const persistSkipSetting = async (value: boolean) => {
		try {
			await sendRequest<UpdateSettingResponse>({
				command: SettingsCommands.updateSetting,
				payload: { key: SKIP_SETTING_KEY, value },
			});
		} catch (error) {
			console.error('Failed to update skipDeleteConfirmation setting:', error);
		}
	};

	const handleDelete = async () => {
		if (dontShowAgain) {
			await persistSkipSetting(true);
		}
		onDelete();
		setDontShowAgain(false); // Reset for next time
	};

	const handleClose = () => {
		setDontShowAgain(false); // Reset checkbox state
		onClose();
	};

	// Don't render the modal when skip confirmation is enabled (or while loading)
	if (skipConfirmation !== false) {
		return null;
	}

	const itemLabel = itemType === 'sensor' ? 'Sensor' : 'Channel';
	const title = itemAlias
		? `Delete ${itemLabel} ${itemAlias} (${itemName})?`
		: `Delete ${itemName}?`;

	const message = itemType === 'sensor'
		? 'Deleting this sensor will remove any config options you have chosen.'
		: 'Deleting this channel will remove any config options you have chosen.';

	const handleCheckboxChange = () => {
		setDontShowAgain(!dontShowAgain);
	};

	return (
		<Modal
			isOpen={isOpen}
			title={title}
			handleModalClose={handleClose}
			footer={
				<div className={styles.footerButtons}>
					<VscodeButton variant="secondary" onClick={handleClose}>
						Cancel
					</VscodeButton>
					<VscodeButton variant="primary" onClick={handleDelete}>
						Delete
					</VscodeButton>
				</div>
			}
		>
			<div className={styles.deleteContent}>
				{message}
				<VscodeCheckbox checked={dontShowAgain} onChange={handleCheckboxChange}>
					Don't show this message again.
				</VscodeCheckbox>
			</div>
		</Modal>
	);
}

// Legacy export for backward compatibility
type DeleteSensorModalProps = {
	readonly isOpen: boolean;
	readonly sensorName: string;
	readonly sensorAlias?: string;
	readonly onClose: () => void;
	readonly onDelete: () => void;
};

export function DeleteSensorModal(props: DeleteSensorModalProps) {
	return (
		<DeletionModal
			isOpen={props.isOpen}
			itemName={props.sensorName}
			itemAlias={props.sensorAlias}
			itemType="sensor"
			onClose={props.onClose}
			onDelete={props.onDelete}
		/>
	);
}
