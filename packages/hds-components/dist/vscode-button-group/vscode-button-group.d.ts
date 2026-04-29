import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * Shows a split button, including several components in a single button. Commonly used to show a button with a dropdown to the right.
 *
 * @tag vscode-button-group
 *
 * @cssprop [--vscode-button-background=#0078d4]
 * @cssprop [--vscode-button-foreground=#ffffff]
 * @cssprop [--vscode-button-border=var(--vscode-button-background, rgba(255, 255, 255, 0.07))]
 * @cssprop [--vscode-button-hoverBackground=#026ec1]
 * @cssprop [--vscode-font-family=sans-serif] - A sans-serif font type depends on the host OS.
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-button-secondaryForeground=#cccccc]
 * @cssprop [--vscode-button-secondaryBackground=#313131]
 * @cssprop [--vscode-button-secondaryHoverBackground=#3c3c3c]
 * @cssprop [--vscode-focusBorder=#0078d4]
 */
export declare class VscodeButtonGroup extends VscElement {
    static styles: import("lit").CSSResultGroup;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-button-group': VscodeButtonGroup;
    }
}
//# sourceMappingURL=vscode-button-group.d.ts.map