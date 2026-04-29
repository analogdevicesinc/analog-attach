import {
    VscodeIcon,
    VscodeLabel,
    VscodeOption,
    VscodeSingleSelect,
    VscodeTextfield,
    VscodeTooltip
} from "hds-react";
import { Fragment, useState } from "react";
import styles from "./ChannelNameInput.module.scss";

export interface ChannelNameInputProps {
    /**
     * Channel name regex patterns for validation
     */
    channelRegexes: string[];

    /**
     * Pre-generated channel names matching the regexes (optional)
     */
    generatedChannelNames?: string[];

    /**
     * Current channel name value
     */
    value: string;

    /**
     * Callback when the channel name changes
     */
    onChange: (channelName: string, valid: boolean) => void;

    /**
     * Whether the input is disabled
     */
    disabled?: boolean;
}

/**
 * Channel name input component with validation and optional dropdown.
 * Can be used standalone or as part of a larger form.
 */
export function ChannelNameInput({
    channelRegexes,
    generatedChannelNames = [],
    value,
    onChange,
    disabled = false
}: ChannelNameInputProps) {
    const [error, setError] = useState<string | null>(null);

    const validateChannelName = (name: string): boolean => {
        if(channelRegexes.length == 0) {
            return true; // If no regexes provided, skip validation (or could enforce non-empty)
        }

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


    const handleChannelNameChange = (event: any) => {
        const target = event.target as HTMLInputElement;
        const newName = target.value;
        setError(null); // Clear previous error

        let valid = validateChannelName(newName);
        if (!valid) {
            setError(`Channel name must match one of: ${channelRegexes.join(', ')}`);
        }

        onChange(newName, valid);
    };


    // Build tooltip content for regex patterns
    const regexTooltipContent = channelRegexes.length > 0 ? (
        <>
            Must match:
            <br />
            {channelRegexes.map((pattern, index) => (
                <Fragment key={index}>
                    {index > 0 && (
                        <>
                            <br />
                            or
                            <br />
                        </>
                    )}
                    {pattern}
                </Fragment>
            ))}
        </>
    ) : null;

    return (
        <>
            <div className={styles.field}>
                <div className={styles.fieldLabelGroup}>
                    <div className={styles.labelWithIcon}>
                        <VscodeLabel>Channel Name</VscodeLabel>
                        {channelRegexes.length > 0 && (
                            <VscodeTooltip position="left" className={styles.tooltipWrapper}>
                                <VscodeIcon name="info" size={16} className={styles.infoIcon} />
                                <div slot="tooltip" className={styles.tooltipContent}>
                                    {regexTooltipContent}
                                </div>
                            </VscodeTooltip>
                        )}
                    </div>
                </div>
                {generatedChannelNames.length > 0 ? (
                    <>
                        <VscodeSingleSelect
                            defaultValue={value}
                            disabled={disabled}
                            combobox={true}
                            creatable={true}
                            onChange={handleChannelNameChange}
                            invalid={!!error}
                        >
                            {generatedChannelNames.map((entry) => (
                                <VscodeOption key={entry} value={entry}>
                                    {entry}
                                </VscodeOption>
                            ))}
                        </VscodeSingleSelect>

                        {error && <span className={styles.errorBadge} title={error}>
                            {error}
                        </span>}
                    </>
                ) : (
                    <VscodeTextfield
                        type="text"
                        value={value}
                        placeholder="Enter channel name"
                        onInput={handleChannelNameChange}
                        disabled={disabled}
                    />
                )}
            </div>
        </>
    );
}
