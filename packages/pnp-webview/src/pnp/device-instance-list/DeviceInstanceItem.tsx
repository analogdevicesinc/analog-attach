import { useDeviceInstanceStore } from '@/store';
import { useErrorStore } from '@/store/useErrorStore';
import { GhostButton } from "attach-ui-lib";
import classnames from "classnames";
import { DeviceUID, type AttachedDeviceState } from "extension-protocol";
import {
	VscodeCheckbox,
	VscodeIcon,
	VscodeTooltip
} from "hds-react";
import { memo } from "react";
import styles from "./DeviceInstanceList.module.scss";

interface DeviceInstanceControlsProperties {
	deviceInstance: AttachedDeviceState;
}

/**
 * Renders the controls for a sensor, i.e the buttons/error status associated with the sensor
 * @param deviceInstance - The device instance to render the controls for
 * @returns A div containing the controls for the sensor
 */
function DeviceInstanceControls({ deviceInstance }: DeviceInstanceControlsProperties) {
 const { loadDeviceConfiguration, setDeviceToDelete } = useDeviceInstanceStore();
 const errorCount = useErrorStore((state) => state.getDeviceErrors(deviceInstance.deviceUID));
 const hasErrors = errorCount > 0;

 const handleConfigureClick = () => {
 	loadDeviceConfiguration(deviceInstance.deviceUID);
 };

 const handleDeleteClick = () => {
 	setDeviceToDelete(deviceInstance);
 };

 return (
 	<div className={styles.iconList}>
 		<VscodeIcon
 			className={classnames(styles.errorIcon, styles.fixedSizeIcon)}
 			name={hasErrors ? "error" : "empty"}
 		/>
			<VscodeTooltip label="Configure Sensor" position="bottom">
				<GhostButton icon="hds-settings-bars" size="medium" onClick={handleConfigureClick} />
			</VscodeTooltip>

			<VscodeTooltip label="Delete Sensor" position="bottom">
				<GhostButton icon="trash" size="medium" onClick={handleDeleteClick} />
			</VscodeTooltip>
		</div>
	);
}

/**
 * Renders a single channel item, with its data and controls
 * @param channel - The channel to render
 * @param deviceUID - The device UID that owns this channel
 * @returns 
 */
function ChannelItem({
	channel,
	deviceUID
}: {
	channel: AttachedDeviceState['channels'][number];
	deviceUID: DeviceUID;
}) {
	const { startEditingChannel, setChannelToDelete } = useDeviceInstanceStore();

	const handleConfigure = async () => {
		try {
			await startEditingChannel(deviceUID, channel.name);
		} catch (error) {
			console.error('Failed to load channel configuration:', error);
		}
	};

	const handleDelete = () => {
		setChannelToDelete({
			deviceUID,
			channelName: channel.name,
			channelAlias: channel.alias
		});
	};

	return (
		<div className={styles.channelBaseContainer}>
			<div className={styles.channelNameContainer}>
				<div className={styles.channelIndicator} />
				<div className={styles.channelContent}>
					<span className={styles.channelNamePrimary}>{channel.alias?.length ? channel.alias : channel.name}</span>
					{(channel.alias?.length > 0) && (
						<span className={styles.channelNameSecondary}>({channel.name})</span>
					)}
				</div>
			</div>
			<div className={styles.channelIcons}>
				<VscodeIcon className={classnames(styles.errorIcon, styles.fixedSizeIcon, styles.editorBGButton)} name={channel.hasErrors ? "error" : "empty"} />
				<VscodeTooltip label="Configure Channel" position="bottom">
					<GhostButton icon="hds-settings-bars" size="medium" className={styles.editorBGButton} onClick={handleConfigure} />
				</VscodeTooltip>
				<VscodeTooltip label="Delete Channel" position="bottom">
					<GhostButton icon="trash" size="medium" className={styles.editorBGButton} onClick={handleDelete} />
				</VscodeTooltip>
			</div>
		</div>
	);
}


interface DeviceInstanceItemProperties {
	deviceInstance: AttachedDeviceState;
	highlighted?: boolean;
}

function DeviceInstanceItemComponent({ deviceInstance, highlighted = false }: DeviceInstanceItemProperties) {
	const setDeviceActive = useDeviceInstanceStore((state) => state.setDeviceActive);
	const setIsExpanded = useDeviceInstanceStore((state) => state.setIsExpanded);
	const { startCreatingChannel } = useDeviceInstanceStore();
	const channelHasErrors = deviceInstance.channels.some(channel => channel.hasErrors);

	// Get maxChannels from EditableDeviceInstance only if it matches this device
	const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
	const maxChannels = EditableDeviceInstance?.deviceUID === deviceInstance.deviceUID
		? (EditableDeviceInstance.payload.config.generatedChannelRegexEntries ?? []).length
		: deviceInstance.maxChannels;

	const handleExpand = () => {
		setIsExpanded(deviceInstance.deviceUID, !deviceInstance.isExpanded);
	};

	const handleActiveToggle = () => {
		console.log('handleActiveToggle', deviceInstance.deviceUID, !deviceInstance.active);
		setDeviceActive(deviceInstance.deviceUID, !deviceInstance.active);
	};

	const handleAddChannel = (event: React.MouseEvent) => {
		event.stopPropagation();
		startCreatingChannel(deviceInstance.deviceUID);
	};

	return (
		<div className={classnames(styles.deviceInstanceItemContainer, { [styles.highlighted]: highlighted })}>
			<div className={styles.deviceInstanceCardHeader}>
				<div className={styles.deviceInstanceCardPrimaryHeader}>
					<span className={styles.deviceInstanceName}>
						{deviceInstance.alias || deviceInstance.name}
					</span>
					<div className={styles.deviceInstanceControls}>
						<div className={styles.tagContainer}>
							<span className={styles.tag}>{deviceInstance.parentNode.name}</span>
						</div>
						<VscodeTooltip label="Toggle Device" position="bottom">
							<VscodeCheckbox
								className={styles.toggleWrapper}
								toggle
								checked={deviceInstance.active}
								onChange={handleActiveToggle}
							/>
						</VscodeTooltip>
						<DeviceInstanceControls deviceInstance={deviceInstance} />
					</div>
				</div>
				{deviceInstance.alias && (
					<div className={styles.deviceInstanceCardSecondaryHeader}>
						<span className={styles.deviceInstanceNameSecondary}>{deviceInstance.name}</span>
					</div>
				)}
			</div>
			{deviceInstance.hasChannels && (
				<div className={styles.deviceInstanceCardFooter}>
					<div className={styles.channelSummary} tabIndex={0} onClick={handleExpand}>
						<GhostButton className={styles.chevronButton} icon={deviceInstance.isExpanded ? "chevron-down" : "chevron-right"} onClick={handleExpand} />
						<span className={styles.channelCount}>
							Channels: {deviceInstance.channels.length}{maxChannels ? `/${maxChannels}` : ''}
						</span>
						<div className={styles.iconList}>
							<VscodeIcon
								className={classnames(styles.errorIcon, styles.fixedSizeIcon)}
								name={channelHasErrors ? "error" : "empty"}
							/>
							<VscodeIcon className={styles.fixedSizeIcon} name="empty" />
							<VscodeTooltip label="Add Channel" position="bottom">
								<GhostButton 
									className={styles.editorBGButton} 
									icon="add" 
									size="medium" 
									onClick={handleAddChannel} 
									disabled={maxChannels ? deviceInstance.channels.length >= maxChannels : false}
								/>
							</VscodeTooltip>
						</div>
					</div>
					{deviceInstance.isExpanded && deviceInstance.channels.map((channel) => (
						<ChannelItem key={channel.name} channel={channel} deviceUID={deviceInstance.deviceUID} />
					))}
				</div>
			)}
		</div >
	);
}

export const DeviceInstanceItem = memo(DeviceInstanceItemComponent);
