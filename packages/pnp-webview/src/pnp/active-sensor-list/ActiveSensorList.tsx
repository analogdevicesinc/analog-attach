/**
 *
 * Copyright (c) 2025 Analog Devices, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import { VscodeIcon } from 'hds-react';
import { useEffect } from 'react';
import { DeviceInstanceList } from '../device-instance-list/DeviceInstanceList';
import styles from './ActiveSensorList.module.scss';
import { ExpandButtons } from './expand-buttons/ExpandButtons';
import { DeleteSensorModal, DeletionModal } from "attach-ui-lib";
import { useDeviceInstanceStore, useVscodeStore } from '@/store';
import { DeleteDeviceRequest, DeviceCommands } from "extension-protocol";

function EmptyContainer() {
	return (
		<div className={styles.emptyContainer}>
			<VscodeIcon name='info' className={styles.emptyContainerIcon} />
			<div className={styles.emptyContainerTextContainer}>
				<span className={styles.emptyContainerTitle}>No Sensors Added Yet</span>
				<span className={styles.emptyContainerDescription}>Add and configure a sensor to get started</span>
			</div>
		</div>
	);
}

export function ActiveSensorList() {
	const { sendRequest } = useVscodeStore();
	const {
		loadDeviceInstances,
		deviceToDelete,
		setDeviceToDelete,
		channelToDelete,
		setChannelToDelete,
		deleteChannelFromDevice,
		loadDeviceConfiguration,
		setEditableDeviceInstance,
		deviceInstances
	} = useDeviceInstanceStore();
	const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);


	useEffect(() => {
		loadDeviceInstances();
	}, []); // intentional: run once on mount

	const handleCloseDeleteModal = () => {
		setDeviceToDelete(undefined);
	};

	const handleConfirmDelete = async () => {
		if (!deviceToDelete) {return;}

		try {
			const priorEditableUID = EditableDeviceInstance?.deviceUID;
			await sendRequest({
				command: DeviceCommands.delete,
				payload: {
					deviceUID: deviceToDelete.deviceUID,
				},
			} as DeleteDeviceRequest);

			// deselect current editable device if it has been deleted
			if (EditableDeviceInstance?.deviceUID === deviceToDelete.deviceUID) {
				setEditableDeviceInstance(undefined);
			}
			await loadDeviceInstances();
			// Refresh the next selected device
			const currentState = useDeviceInstanceStore.getState();
			const stillEditableUID = currentState.EditableDeviceInstance?.deviceUID;
			const fallbackUID = currentState.deviceInstances[0]?.deviceUID;
			const nextUID = stillEditableUID ?? (priorEditableUID && priorEditableUID !== deviceToDelete.deviceUID
				? priorEditableUID
				: fallbackUID);
			if (nextUID) {
				await loadDeviceConfiguration(nextUID);
			}
		} catch (error) {
			console.error('Failed to delete sensor:', error);
		} finally {
			handleCloseDeleteModal();
		}
	};

	const handleCloseChannelDeleteModal = () => {
		setChannelToDelete(undefined);
	};

	const handleConfirmChannelDelete = async () => {
		if (!channelToDelete) {return;}

		try {
			await deleteChannelFromDevice(channelToDelete.deviceUID, channelToDelete.channelName);
		} catch (error) {
			console.error('Failed to delete channel:', error);
		} finally {
			handleCloseChannelDeleteModal();
		}
	};

	return (
		<div className={styles.coreContainer}>
			{deviceToDelete &&
				<DeleteSensorModal
					isOpen={!!deviceToDelete}
					onClose={handleCloseDeleteModal}
					onDelete={handleConfirmDelete}
					sensorName={deviceToDelete?.name || ''}
					sensorAlias={deviceToDelete?.alias}
				/>
			}
			{channelToDelete &&
				<DeletionModal
					isOpen={!!channelToDelete}
					onClose={handleCloseChannelDeleteModal}
					onDelete={handleConfirmChannelDelete}
					itemName={channelToDelete.channelName}
					itemAlias={channelToDelete.channelAlias}
					itemType="channel"
				/>
			}
			<div className={styles.header}>
				<span className={styles.headerText}>Devices</span>
				<ExpandButtons />
			</div>
			<div className={styles.content}>
				{deviceInstances.length === 0 ? <EmptyContainer /> : <DeviceInstanceList deviceInstances={deviceInstances} />}
			</div>
		</div>
	);
}

