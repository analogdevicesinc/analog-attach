import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-tab-header
 *
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-panelTitle-activeBorder=#0078d4]
 * @cssprop [--vscode-panelTitle-activeForeground=#cccccc]
 * @cssprop [--vscode-panelTitle-inactiveForeground=#9d9d9d]
 */
export declare class VscodeTabHeader extends VscElement {
    static styles: import("lit").CSSResultGroup;
    active: boolean;
    /** @internal */
    ariaControls: string;
    /**
     * Panel-like look
     */
    panel: boolean;
    /** @internal */
    role: string;
    /** @internal */
    tabId: number;
    attributeChangedCallback(name: string, old: string | null, value: string | null): void;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-tab-header': VscodeTabHeader;
    }
}
//# sourceMappingURL=vscode-tab-header.d.ts.map