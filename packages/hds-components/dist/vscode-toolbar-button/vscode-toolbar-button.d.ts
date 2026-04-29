import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import '../vscode-icon/vscode-icon.js';
/**
 * Toolbar button
 *
 * @tag vscode-toolbar-button
 */
export declare class VscodeToolbarButton extends VscElement {
    static styles: import("lit").CSSResultGroup;
    icon: string;
    label: string | undefined;
    toggleable: boolean;
    checked: boolean;
    private _isSlotEmpty;
    private _assignedNodes;
    private _handleSlotChange;
    private _handleButtonClick;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-toolbar-button': VscodeToolbarButton;
    }
}
//# sourceMappingURL=vscode-toolbar-button.d.ts.map