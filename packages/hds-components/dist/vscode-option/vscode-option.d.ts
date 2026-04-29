import { PropertyValues, TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import '../vscode-icon/index.js';
/**
 * @tag vscode-option
 */
export declare class VscodeOption extends VscElement {
    static styles: (import("lit").CSSResult | import("lit").CSSResult[])[];
    value?: string | undefined;
    description: string;
    icon: string;
    selected: boolean;
    disabled: boolean;
    private _initialized;
    connectedCallback(): void;
    protected willUpdate(changedProperties: PropertyValues): void;
    private _handleSlotChange;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-option': VscodeOption;
    }
}
//# sourceMappingURL=vscode-option.d.ts.map