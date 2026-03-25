import { useState } from "react";
import { useDeviceInstanceStore } from "../../../store/useDeviceInstanceStore";
import { VscodeTextfield, VscodeSingleSelect, VscodeOption, VscodeLabel, VscodeTooltip } from "hds-react";
import styles from "./DetailsSection.module.scss";
import { useParentNodeStore } from "@/store";
import { isValidAlias } from "attach-ui-lib";

export default function DetailsSection() {
	const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
	const deviceInstances = useDeviceInstanceStore((state) => state.deviceInstances);
	const updateDeviceConfiguration = useDeviceInstanceStore((state) => state.updateDeviceConfiguration);

	if (!EditableDeviceInstance) {
		return undefined;
	}

	const deviceInstance = deviceInstances.find((di) => di.deviceUID === EditableDeviceInstance.deviceUID);
	const parentNodeID = deviceInstance?.parentNode?.uuid || "";

	const getParentNodes = useParentNodeStore((state) => state.getParentNodes);
	const parentNodeOptions = deviceInstance ? getParentNodes(deviceInstance.compatible) : [];

	// Get alias from EditableDeviceInstance payload config, fallback to deviceInstance
	const alias = EditableDeviceInstance.payload.config.alias ?? deviceInstance?.alias ?? "";
	const [aliasError, setAliasError] = useState(!isValidAlias(alias));

	const handleAliasChange = (event: React.FormEvent) => {
		const target = event.target as HTMLInputElement;
		const newAlias = target.value;

		if (!isValidAlias(newAlias)) {
			setAliasError(true);
			return;
		}
		setAliasError(false);

		// Update the alias in EditableDeviceInstance
		const updatedConfig = {
			...EditableDeviceInstance.payload.config,
			alias: newAlias,
		};

		// Update the store
		useDeviceInstanceStore.getState().setEditableDeviceInstance({
			...EditableDeviceInstance,
			payload: {
				...EditableDeviceInstance.payload,
				config: updatedConfig,
			},
		});

		// Trigger immediate update (no longer debounced here - can be added if needed)
		void updateDeviceConfiguration(updatedConfig);
	};

	const handleParentNodeChange = (event: Event) => {
		// For Web Components, e.target is the component itself
		const component = event.target as any;
		const newParentNodeID = component?.value ?? "";

		// Find the parentNode from parentNodeOptions based on the ID
		const newParentNode = parentNodeOptions.find((option) => option.uuid === newParentNodeID);

		if (!newParentNode) {
			console.warn('Parent node not found for ID:', newParentNodeID);
			return;
		}

		// Update the parentNode in EditableDeviceInstance
		useDeviceInstanceStore.getState().setEditableDeviceInstance({
			...EditableDeviceInstance,
			payload: {
				...EditableDeviceInstance.payload,
				config: {
					...EditableDeviceInstance.payload.config,
					parentNode: newParentNode,
				},
			},
		});

		// Get the updated config from the store
		const updatedEditableInstance = useDeviceInstanceStore.getState().EditableDeviceInstance;
		if (updatedEditableInstance) {
			// Trigger immediate update
			void updateDeviceConfiguration(updatedEditableInstance.payload.config);
		}
	};

	return (
		<div className={styles.container}>
			<div className={styles.content}>
				<div className={styles.field}>
					<div className={styles.fieldLabelGroup}>
						<VscodeLabel>Connected to</VscodeLabel>
					</div>
					<VscodeSingleSelect value={parentNodeID} onInput={handleParentNodeChange}>
						{parentNodeOptions.map((option) => (
							<VscodeOption key={option.uuid} value={option.uuid}>
								{option.name}
							</VscodeOption>
						))}
					</VscodeSingleSelect>
				</div>
				<div className={styles.field}>
					<div className={styles.fieldLabelGroup}>
						<VscodeLabel>Alias</VscodeLabel>
						<div className={styles.optionalBadge}>Optional</div>
					</div>
					<VscodeTooltip label="The node alias allows properties to reference the node as a phandle reference." position="bottom">
						<VscodeTextfield
							type="text"
							value={alias}
							placeholder="Enter alias"
							onInput={handleAliasChange}
							invalid={aliasError}
						/>
						{aliasError && (
							<div className={styles.errorBadge}>
								Alias must start with a letter and contain only alphanumeric characters
							</div>
						)}
					</VscodeTooltip>
				</div>
			</div>
		</div>
	);
}
