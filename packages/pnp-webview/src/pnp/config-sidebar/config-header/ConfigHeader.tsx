import { useState } from "react";
import { VscodeIcon } from "hds-react";
import { GhostButton } from "attach-ui-lib";
import { useDeviceInstanceStore } from "../../../store/useDeviceInstanceStore";
import { useErrorStore } from "../../../store/useErrorStore";
import type { FormObjectElement } from "extension-protocol";
import styles from "./ConfigHeader.module.scss";

export default function ConfigHeader() {
	const [genericErrorsExpanded, setGenericErrorsExpanded] = useState(false);
	const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
	const deviceInstances = useDeviceInstanceStore((state) => state.deviceInstances);
	const error = useDeviceInstanceStore((state) => state.error);
	const isCreatingChannel = useDeviceInstanceStore((state) => state.isCreatingChannel);
	const editingChannelName = useDeviceInstanceStore((state) => state.editingChannelName);
    const genericErrors = useDeviceInstanceStore((state) => state.EditableDeviceInstance?.payload.config.genericErrors) ?? [];

	const deviceInstance = EditableDeviceInstance
		? deviceInstances.find((di) => di.deviceUID === EditableDeviceInstance.deviceUID)
		: undefined; 

	let	errorCount = useErrorStore((state) =>
			deviceInstance ? state.getDeviceErrors(deviceInstance.deviceUID) : 0) + genericErrors.length; // count device errors + generic config errors

	let displayName: string;
	let secondaryName: string;

	if (isCreatingChannel) {
		// Channel creation mode
		displayName = "Add Channel";
		secondaryName = deviceInstance ? (deviceInstance.alias || deviceInstance.name) : "Unknown Device";
		errorCount = 0; // no errors in creation mode
	} else if (editingChannelName) {
		// Channel edit mode
		const channelElement = EditableDeviceInstance?.payload.config.config.find(
			(element) => element.type === "FormObject" && (element as FormObjectElement).channelName === editingChannelName
		) as FormObjectElement | undefined;

		displayName = channelElement?.alias || editingChannelName || 'Unknown Channel';
		secondaryName = channelElement?.alias ? (editingChannelName ?? "Unknown Channel") : '';

		errorCount = channelElement?.config.filter(element => element.error).length ?? 0; // count all the channel errors
	} else {
		// Normal device edit mode
		displayName = deviceInstance ? (deviceInstance.alias || deviceInstance.name) : "Unknown Device";
		secondaryName = (deviceInstance?.alias && deviceInstance.alias.trim() !== '') ? deviceInstance.name : "Analog Attach";
	}

	const handleClose = () => {
		useDeviceInstanceStore.getState().setEditableDeviceInstance(undefined);
		useDeviceInstanceStore.getState().setError(undefined);
		// Also clear channel-related state
		useDeviceInstanceStore.setState({
			isCreatingChannel: false,
			editingChannelName: undefined,
			channelParentDeviceUID: undefined
		});
	};

	return (
		<div className={styles.SidesheetHeader}>
			<div className={styles.content}>
				<div className={styles.labelGroup}>
					<span className={styles.primaryName}>{displayName}</span>
					<GhostButton icon="close" onClick={handleClose} />
				</div>
				<div className={styles.secondaryName}>{secondaryName}</div>
				<div className={styles.infoContainer}>
					{error && (
						<div className={styles.detailsContainer}>
							<VscodeIcon size={16} name="error" className={styles.errorIcon} />
							<span className={styles.infoMessage} title={error}>{error}</span>
						</div>
					)}
					{errorCount > 0 && (
						<div className={genericErrors.length > 0 && genericErrorsExpanded ? styles.detailsContainerColumn : styles.detailsContainer}>
							<div className={styles.inlineDetails}>
								<VscodeIcon size={16} name="error" className={styles.errorIcon} />
								<span className={styles.infoMessage}>{errorCount} {errorCount === 1 ? 'error' : 'errors'}</span>
								{genericErrors.length > 0 && (
									<GhostButton
										size="small"
										icon={genericErrorsExpanded ? 'chevron-down' : 'chevron-right'}
										onClick={() => setGenericErrorsExpanded(!genericErrorsExpanded)}
									/>
								)}
							</div>
							{genericErrors.length > 0 && genericErrorsExpanded && (
									<div className={styles.genericErrorList}>
										{genericErrors.map((error_, index) => (
										<div key={index} className={styles.genericErrorItem}>
											<span className={styles.genericErrorMessage}>{error_.message}</span>
											{error_.details && <span className={styles.genericErrorDetails}>{error_.details}</span>}
										</div>
									))}
								</div>
							)}
						</div>
					)}
					{deviceInstance && !deviceInstance.active && (
						<div className={styles.detailsContainer}>
							<VscodeIcon size={16} name="info" className={styles.infoIcon} />
							<span className={styles.infoMessage}>Disabled</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
