import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-table-row
 *
 * @cssprop [--vscode-editorGroup-border=rgba(255, 255, 255, 0.09)]
 */
export declare class VscodeTableRow extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    role: string;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-table-row': VscodeTableRow;
    }
}
//# sourceMappingURL=vscode-table-row.d.ts.map