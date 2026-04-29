import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-table-header
 *
 * @cssprop [--vscode-keybindingTable-headerBackground=rgba(204, 204, 204, 0.04)] - Table header background
 */
export declare class VscodeTableHeader extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    role: string;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-table-header': VscodeTableHeader;
    }
}
//# sourceMappingURL=vscode-table-header.d.ts.map