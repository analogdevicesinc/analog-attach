import { useDeviceConfigurationStore } from "@/store/useDeviceConfigurationStore";
import { useNodesStore } from "@/store/useNodesStore";
import {
    CreatePropertyToggle,
    renderFormElement,
    isValidAlias,
} from "attach-ui-lib";
import { FormObjectElement, type GenericFormElement } from "extension-protocol";
import React, { useState } from "react";
import styles from "./ConfigForm.module.scss";

export default function ConfigForm() {
    const { selectedNode, selectNode, findNodeByDeviceUID } = useNodesStore();
    const { configuration, updateFormElementValue, updateDeviceAlias, updateCustomProperty, deleteCustomProperty } = useDeviceConfigurationStore();

    const formObject = selectedNode?.data as FormObjectElement;

    const formElements = configuration?.config ?? formObject.config ?? [selectedNode?.data];

    const handleFormElementChange = async (elementKey: string, newValue: unknown, parentKey?: string) => {
        updateFormElementValue(elementKey, newValue, parentKey);
    };

    const [aliasError, setAliasError] = useState(false);

    const handleAliasChange = async (newAlias?: string) => {
        if (!isValidAlias(newAlias ?? '')) {
            setAliasError(true);
            return;
        }
        setAliasError(false);
        await updateDeviceAlias(newAlias || '');
    };

    const handleAddCustomProperty = (propertyName: string, propertyValue: string | boolean) => {
        updateCustomProperty(undefined, propertyName, propertyValue);
    };

    return (
        <div className={styles.mainFrame}>
            <div className={styles.content}>
                <div className={styles.fields}>
                    {formObject.deviceUID &&
                        renderFormElement({
                            key: 'alias',
                            type: 'Generic',
                            inputType: 'text',
                            setValue: configuration?.alias,
                            required: false,
                            description: 'Alias for this device',
                            error: aliasError ? { code: 'INVALID_ALIAS', message: 'Alias must start with a letter and contain only alphanumeric characters' } : undefined,
                        }, (_key, value) => handleAliasChange(value as string), undefined, { customStyles: styles, recursively: false, deleteCustomPropsHandler: deleteCustomProperty})
                    }
                    {formElements.map((element, index) => {
                        const genericElement = element as GenericFormElement;
                        const uniqueKey = `${genericElement.key}-${index}`;
                        return (
                            <React.Fragment key={uniqueKey}>
                                {renderFormElement(element, handleFormElementChange, undefined, {
                                    customStyles: styles,
                                    recursively: false,
                                    deleteCustomPropsHandler: deleteCustomProperty,
                                    onGoTo: (gotoUID: string) => {
                                        const node = findNodeByDeviceUID(gotoUID);
                                        if (node) {
                                            selectNode(node);
                                        }
                                    }
                                })}
                            </React.Fragment>
                        );
                    })}

                    {formObject.deviceUID &&
                        <CreatePropertyToggle onSave={handleAddCustomProperty} mode="tree-view"/>
                    }
                </div>
            </div>
        </div>
    )
}
