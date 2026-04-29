import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-tab-panel
 *
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-panel--background=#181818]
 */
export declare class VscodeTabPanel extends VscElement {
    static styles: import("lit").CSSResultGroup;
    hidden: boolean;
    /** @internal */
    ariaLabelledby: string;
    /**
     * Panel-like look
     */
    panel: boolean;
    /** @internal */
    role: string;
    /** @internal */
    tabIndex: number;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-tab-panel': VscodeTabPanel;
    }
}
//# sourceMappingURL=vscode-tab-panel.d.ts.map