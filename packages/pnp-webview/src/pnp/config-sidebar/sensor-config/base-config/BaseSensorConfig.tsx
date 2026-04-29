import {
    CreatePropertyToggle,
    renderFormElement
} from "attach-ui-lib";
import React from "react";
import { useDeviceInstanceStore } from "../../../../store/useDeviceInstanceStore";

import type { FormElement, FormObjectElement, GenericFormElement } from "extension-protocol";
import styles from "./BaseSensorConfig.module.scss";

export default function BaseSensorConfig() {
    const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
    const editingChannelName = useDeviceInstanceStore((state) => state.editingChannelName);
    const updateFormElementValue = useDeviceInstanceStore((state) => state.updateFormElementValue);
    const updateCustomProperty = useDeviceInstanceStore((state) => state.updateCustomProperty);
    const deleteCustomProperty = useDeviceInstanceStore((state) => state.deleteCustomProperty);

    if (!EditableDeviceInstance) {
        return undefined;
    }

    let formElements: FormElement[];

    if (editingChannelName) {
        // Channel edit mode: Find the channel FormObjectElement and render its config array
        const channelElement = EditableDeviceInstance.payload.config.config.find(
            (element) => element.type === "FormObject" && (element as FormObjectElement).channelName === editingChannelName
        ) as FormObjectElement | undefined;

        formElements = channelElement?.config || [];
    } else {
        // Device edit mode: Filter out channel FormObjectElements
        formElements = EditableDeviceInstance.payload.config.config.filter(
            (element) => element.type !== "FormObject" || !(element as FormObjectElement).channelName
        );
    }

    const handleFormElementChange = (elementKey: string, newValue: unknown, parentKey?: string) => {
        // If we're editing a channel, pass the channel name as the parent key
        // so the update happens within the channel's FormObjectElement
        const effectiveParentKey = editingChannelName ?? parentKey;

        // Update the form element value in the store
        // Note: updateFormElementValue now automatically triggers debounced update
        updateFormElementValue(elementKey, newValue, effectiveParentKey);
    };

    const handleAddCustomProperty = async (propertyName: string, propertyValue: string | boolean) => {
        updateCustomProperty(undefined, propertyName, propertyValue);
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.title}>CONFIGURATION</div>
            </div>
            <div className={styles.content}>
                {formElements.length > 0 && (
                    <div className={styles.fields}>
                        {formElements.map((element, index) => {
                            const genericElement = element as GenericFormElement;
                            const uniqueKey = `${genericElement.key}-${index}`;
                            return (
                                <React.Fragment key={uniqueKey}>
                                    {renderFormElement(element, handleFormElementChange, undefined, { customStyles: styles, deleteCustomPropsHandler:  deleteCustomProperty})}
                                </React.Fragment>
                            );
                        })}
                    </div>
                )}
                {!editingChannelName && EditableDeviceInstance.deviceUID && (
                    <CreatePropertyToggle onSave={handleAddCustomProperty} mode="pnp"/>
                )}
            </div>
        </div>
    );
}