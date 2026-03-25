import { useState } from "react";
import { useDeviceInstanceStore } from "../../../store/useDeviceInstanceStore";
import {
    VscodeTextfield,
    VscodeLabel,
    VscodeButton
} from "hds-react";
import { ChannelNameInput, isValidAlias } from "attach-ui-lib";
import styles from "./ChannelCreateForm.module.scss";
import { FormObjectElement } from "extension-protocol";

export default function ChannelCreateForm() {
    const [channelName, setChannelName] = useState('');
    const [isValid, setIsValid] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const [alias, setAlias] = useState('');
    const [aliasError, setAliasError] = useState<string | undefined>(undefined);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const EditableDeviceInstance = useDeviceInstanceStore((state) => state.EditableDeviceInstance);
    const addChannelToDevice = useDeviceInstanceStore((state) => state.addChannelToDevice);

    const channels = EditableDeviceInstance?.payload.config.config.filter(element => element.type === 'FormObject' && element.channelName);
    const channelNames = channels?.map(element => (element as FormObjectElement).channelName);
    const channelRegexes = EditableDeviceInstance?.payload.config.channelRegexes || [];
    const generatedChannelRegexEntries = EditableDeviceInstance?.payload.config.generatedChannelRegexEntries?.filter(element => !channelNames?.includes(element)) || [];

    const validateChannelName = (name: string): boolean => {
        if (!name.trim()) {
            return false;
        }

        // Must match at least one channelRegex
        return channelRegexes.some(pattern => {
            try {
                const regex = new RegExp(pattern);
                return regex.test(name);
            } catch {
                return false;
            }
        });
    };

    const handleChannelNameChange = (value: string, isValid: boolean) => {
        setChannelName(value);
        setIsValid(isValid);
    };

    const handleAliasChange = (event: React.FormEvent) => {
        setAliasError(undefined);
        setIsValid(true);
        const target = event.target as HTMLInputElement;
        setAlias(target.value);

        if(target.value.trim() === '') {
            setAliasError(undefined); // Alias is optional, so empty value is valid
            setAlias('');
            return;
        }
        
        if (!isValidAlias(target.value)) {
            setAliasError('Alias can only contain letters, numbers, underscores, and hyphens');
            setIsValid(false);
            return;
        }
    };

    const handleAdd = async () => {
        if (!validateChannelName(channelName)) {
            setError(`Channel name must match one of: ${channelRegexes.join(', ')}`);
            return;
        }

        if (!EditableDeviceInstance) {
            setError('No device configuration loaded');
            return;
        }

        setIsSubmitting(true);
        setError(undefined);

        try {
            await addChannelToDevice(
                EditableDeviceInstance.deviceUID,
                channelName,
                alias || undefined
            );
            // Success - store will handle transition to edit mode
        } catch (error_) {
            setError(error_ instanceof Error ? error_.message : 'Failed to create channel');
            setIsSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <ChannelNameInput
                    channelRegexes={channelRegexes}
                    generatedChannelNames={generatedChannelRegexEntries}
                    value={channelName}
                    onChange={handleChannelNameChange}
                    disabled={isSubmitting}
                />

                <div className={styles.field}>
                    <div className={styles.fieldLabelGroup}>
                        <VscodeLabel>Alias</VscodeLabel>
                        <div className={styles.optionalBadge}>Optional</div>
                    </div>
                    <>
                        <VscodeTextfield
                            type="text"
                            value={alias}
                            placeholder="Enter alias"
                            onInput={handleAliasChange}
                            disabled={isSubmitting}
                            invalid={!!aliasError}
                        />
                        {aliasError && <span className={styles.errorBadge} title={aliasError}>
                            {aliasError}
                        </span>}
                    </>
                </div>

                {error && (
                    <div className={styles.errorMessage}>
                        {error}
                    </div>
                )}

                <div className={styles.buttonGroup}>
                    <VscodeButton
                        onClick={handleAdd}
                        disabled={!isValid || isSubmitting}
                        fixed
                    >
                        {isSubmitting ? 'Adding...' : 'Add Channel'}
                    </VscodeButton>
                </div>
            </div>
        </div>
    );
}

