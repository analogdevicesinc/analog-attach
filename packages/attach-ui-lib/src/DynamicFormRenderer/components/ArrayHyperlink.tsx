import { HyperlinkItem } from "extension-protocol";
import { Tooltip, VscodeOption, VscodeSingleSelect } from "hds-react";
import GhostButton from "../../GhostButton/GhostButton";

interface ArrayHyperlinkProps {
    items: HyperlinkItem[];
    value: string;
    onChange: (value: string | undefined) => void;
    onGoTo?: (gotoUID: string) => void;
    error: boolean;
}

export function ArrayHyperlink({ value, items, onChange, onGoTo, error }: ArrayHyperlinkProps) {
    const selectedItem = items.find(item => item.name === value);
    const onValueChange = (e: Event) => {
        const target = e.target as any;
        if (target.value != -1) {
            onChange(target.value);
            return;
        }

        onChange(undefined);
    }
    return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <VscodeSingleSelect value={value?.length > 0 ? value : "-1"} onChange={onValueChange} invalid={error}>
            <VscodeOption key="none" value={"-1"}> None </VscodeOption>
            {items.map((v, i: number) => (
                <VscodeOption key={v.name + `_${i}`} value={String(v.name)}>
                    {String(v.name)}
                </VscodeOption>
            ))}
        </VscodeSingleSelect>
            {onGoTo &&
            <Tooltip tooltip={`Go to ${selectedItem?.name ?? ''}`} position="bottom">
                <GhostButton
                    onClick={() => onGoTo?.(selectedItem?.gotoUID!)}
                    size="large"
                    variant="secondary"
                    disabled={selectedItem == undefined}
                    icon="link-external"
                />
            </Tooltip>
            }
        </div>
    );
}

