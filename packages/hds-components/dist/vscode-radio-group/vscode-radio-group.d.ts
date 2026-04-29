import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-radio-group
 *
 * @fires {Event} change - Dispatched when a child radio button is changed.
 */
export declare class VscodeRadioGroup extends VscElement {
    static styles: import("lit").CSSResultGroup;
    variant: 'horizontal' | 'vertical';
    /** @internal */
    role: string;
    private _radios;
    private _focusedRadio;
    private _checkedRadio;
    private _firstContentLoaded;
    constructor();
    private _uncheckPreviousChecked;
    private _afterCheck;
    private _checkPrev;
    private _checkNext;
    private _handleKeyDown;
    private _handleChange;
    private _handleSlotChange;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-radio-group': VscodeRadioGroup;
    }
}
//# sourceMappingURL=vscode-radio-group.d.ts.map