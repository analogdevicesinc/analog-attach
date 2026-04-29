import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * Arranges a group of checkboxes horizontally or vertically.
 *
 * @tag vscode-checkbox-group
 */
export declare class VscodeCheckboxGroup extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    role: string;
    variant: 'horizontal' | 'vertical';
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-checkbox-group': VscodeCheckboxGroup;
    }
}
//# sourceMappingURL=vscode-checkbox-group.d.ts.map