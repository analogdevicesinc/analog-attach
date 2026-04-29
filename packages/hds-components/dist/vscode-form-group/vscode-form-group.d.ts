import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
export type FormGroupVariant = 'horizontal' | 'vertical' | 'settings-group';
/**
 * @tag vscode-form-group
 *
 * @cssprop [--label-width=150px] - The width of the label in horizontal mode
 * @cssprop [--label-right-margin=14px] - The right margin of the label in horizontal mode
 */
export declare class VscodeFormGroup extends VscElement {
    static styles: import("lit").CSSResultGroup;
    variant: FormGroupVariant;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-form-group': VscodeFormGroup;
    }
}
//# sourceMappingURL=vscode-form-group.d.ts.map