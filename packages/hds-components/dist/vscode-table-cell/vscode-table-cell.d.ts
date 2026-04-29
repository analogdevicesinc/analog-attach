import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-table-cell
 *
 * @cssprop [--vscode-editorGroup-border=rgba(255, 255, 255, 0.09)]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 */
export declare class VscodeTableCell extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    role: string;
    /**
     * Cell label in the compact view of the responsive mode. For internal use only.
     */
    columnLabel: string;
    alignment: 'left' | 'center' | 'right';
    /**
     * Enable compact view in the responsive mode. For internal use only.
     */
    compact: boolean;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-table-cell': VscodeTableCell;
    }
}
//# sourceMappingURL=vscode-table-cell.d.ts.map