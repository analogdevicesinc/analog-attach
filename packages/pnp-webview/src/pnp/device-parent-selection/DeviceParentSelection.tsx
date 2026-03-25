import styles from './DeviceParentSelection.module.scss';
import { VscodeButton } from 'hds-react';
import { useEffect } from 'react';
import { useParentNodeStore } from '../../store/useParentNodeStore';
import { useDeviceInstanceStore, useVscodeStore } from '@/store';
import { DeviceCommands, ParentNode, SetParentNodeResponse } from 'extension-protocol';

export default function DeviceParentSelection({ onFinish, connectingNode }: { onFinish: () => void, connectingNode: string }) {
	const getParentNodes = useParentNodeStore((state) => state.getParentNodes);
	const isLoading = useParentNodeStore((state) => state.isLoading);
	const error = useParentNodeStore((state) => state.error);
	const loadParentNodes = useParentNodeStore((state) => state.loadParentNodes);
	const { loadDeviceInstances, loadDeviceConfiguration } = useDeviceInstanceStore();
	const { sendRequest } = useVscodeStore();

	const parentNodes = getParentNodes(connectingNode);

	const handleParentNodeClick = async (parentNode: ParentNode) => {
		const response = await sendRequest<SetParentNodeResponse>({
			command: DeviceCommands.setParentNode,
			payload: {
				deviceId: connectingNode,
				parentNode: parentNode,
			},
		});

		if (response.status === "success" && response.payload?.deviceUID) {
			await loadDeviceInstances();
			await loadDeviceConfiguration(response.payload.deviceUID);
		} else {
			await loadDeviceInstances();
		}
		onFinish();
	};

	useEffect(() => {
		loadParentNodes(connectingNode);
	}, [connectingNode, loadParentNodes]);

	return (
		<div className={styles.container}>
			<div className={styles.backContainer}>
				<VscodeButton onClick={onFinish} icon="chevron-left" variant="tertiary" size="small">Back</VscodeButton>
			</div>
			<div className={styles.titleContainer}>
				Connect {connectingNode} to:
			</div>
			{isLoading && <div>Loading parent nodes...</div>}
			{error && <div>Error: {error}</div>}
			{!isLoading && !error && (
				<div className={styles.selectionContainer}>
					{parentNodes.length > 0 ? (
						parentNodes.map((node) => (
							<div className={styles.selectionCard} key={node.uuid} onClick={() => handleParentNodeClick(node)}>
								<span>
									{node.name}
								</span>
							</div>
						))
					) : (
						<div>No parent nodes available</div>
					)}
				</div>
			)}
		</div>
	);
}