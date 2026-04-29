import { useNodesStore } from "@/store/useNodesStore";
import styles from './ConfigView.module.scss';
import { Tooltip, VscodeCheckbox, VscodeIcon, VscodeLabel } from "hds-react";
import { Breadcrumb } from "../breadcrumb/Breadcrumb";
import ErrorDisplay from "../components/ErrorDisplay";
import { useUIStore } from "@/store/useUIStore";
import { GhostButton } from "attach-ui-lib";
import { FormObjectElement } from "extension-protocol";
import ConfigForm from "./ConfigForm";
import { useDeviceConfigurationStore } from "@/store/useDeviceConfigurationStore";
import { useEffect } from "react";

function ConfigView() {
    const { selectedNode, error } = useNodesStore();

    useEffect(() => {
        const formObject = selectedNode?.data as FormObjectElement;
        const deviceUID = formObject?.deviceUID;

        if (deviceUID) {
            useDeviceConfigurationStore.getState().getConfiguration(deviceUID);
        } else {
            // Clear configuration if no device is selected
            useDeviceConfigurationStore.getState().clearConfiguration();
        }
    }, [selectedNode]);


    if (error) {
        return (
            <div className={styles.configView}>
                <div className={styles.container} >
                    <Header />
                    <div className={styles.nodeConfig}>
                        <div className={styles.centered}>
                            <ErrorDisplay message={error} />
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.configView}>
            <div className={styles.container} >
                <Header />
                {selectedNode ? (
                    <div className={styles.nodeConfig}>
                        <div className={styles.centered}>
                            <ConfigForm />
                        </div>
                    </div>
                ) : (
                    <EmptyState />
                )}
            </div>
        </div>
    );
}


function Header() {
    const { selectedNode, loadNodes } = useNodesStore();
    const { configuration, setDeviceActive } = useDeviceConfigurationStore();
    const { setView, setDeviceToDelete } = useUIStore();

    const formObjectData = selectedNode?.data as FormObjectElement;
    const deviceUID = formObjectData?.deviceUID;

    const isActive = configuration?.active ?? formObjectData?.active ?? false; // Fallback to node's active state if configuration is not loaded yet
    if (!selectedNode) {
        return null;
    }

    const handleToggleEnabled = async () => {
        // update the device configuration active state
        if (deviceUID) {
            await setDeviceActive(deviceUID, !isActive);
            await loadNodes(); // Refresh the tree to reflect changes
        }
    }

    return (
        <div className={`${styles.header} ${styles.centered}`}>
            <Breadcrumb truncationLimit={3} />

            <div className={styles.headerToolbar}>
                <h2 className={styles.headerTitle}>{selectedNode.label}</h2>

                <div className={styles.headerControls}>

                    <Tooltip tooltip={deviceUID ? "Enable/ Disable Node" : "Cannot disable current node"} position="bottom">
                        <VscodeCheckbox
                            toggle
                            className={styles.toggleCheckbox}
                            checked={isActive}
                            onChange={handleToggleEnabled}
                            disabled={!deviceUID}
                        />
                    </Tooltip>

                    <Tooltip tooltip={deviceUID ? "Add Child Node" : "Cannot add child node to this node"} position="bottom">
                        <GhostButton
                            icon='add'
                            onClick={() => setView('add-node')}
                            disabled={!deviceUID}
                        />
                    </Tooltip>

                    <Tooltip tooltip={deviceUID ? "Delete Node" : "Cannot delete this node."} position='bottom'>
                        <GhostButton icon="trash" onClick={() => setDeviceToDelete(selectedNode)} disabled={!deviceUID} />
                    </Tooltip>
                </div>
            </div>
            {selectedNode.hasErrors && (
                <ErrorDisplay message={`2 error${2 > 1 ? 's' : ''}`} />
            )}
        </div>
    )
}

function EmptyState() {
    return (
        <div className={`${styles.emptyState} ${styles.centered}`}>
            <VscodeIcon name="info" className={styles.infoIcon} />
            <VscodeLabel className={styles.emptyStateLabel}>Add or Select a Node to Configure</VscodeLabel>
            <p className={styles.emptyStateText}>To configure a node, it must first be added to or selected from the list.</p>
        </div>
    );
}
// Render the path with clickable links

export default ConfigView;