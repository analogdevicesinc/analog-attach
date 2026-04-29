import { useDeviceInstanceStore } from "../../../store/useDeviceInstanceStore";
import { VscodeTextfield, VscodeLabel } from "hds-react";
import type { FormObjectElement } from "extension-protocol";
import styles from "./ChannelDetailsSection.module.scss";

export default function ChannelDetailsSection() {
    const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
    const editingChannelName = useDeviceInstanceStore((state) => state.editingChannelName);
    const updateChannelAlias = useDeviceInstanceStore((state) => state.updateChannelAlias);

    if (!EditableDeviceInstance || !editingChannelName) {
        return undefined;
    }

    // Find the channel FormObjectElement
    const channelElement = EditableDeviceInstance.payload.config.config.find(
        (element) => element.type === "FormObject" && (element as FormObjectElement).channelName === editingChannelName
    ) as FormObjectElement | undefined;

    const handleAliasChange = (event: React.FormEvent) => {
        const target = event.target as HTMLInputElement;
        const newAlias = target.value;

        // Update the alias in the FormObjectElement
        // Note: updateChannelAlias now triggers automatic debounced update
        updateChannelAlias(editingChannelName, newAlias);
    };

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <div className={styles.field}>
                    <div className={styles.fieldLabelGroup}>
                        <div className={styles.labelWithIcon}>
                            <VscodeLabel>Channel Name</VscodeLabel>
                        </div>
                    </div>
                    <VscodeTextfield
                        type="text"
                        value={editingChannelName}
                        disabled
                    />
                </div>

                <div className={styles.field}>
                    <div className={styles.fieldLabelGroup}>
                        <VscodeLabel>Alias</VscodeLabel>
                        <div className={styles.optionalBadge}>Optional</div>
                    </div>
                    <VscodeTextfield
                        type="text"
                        value={channelElement?.alias || ''}
                        placeholder="Enter alias"
                        onInput={handleAliasChange}
                    />
                </div>
            </div>
        </div>
    );
}

