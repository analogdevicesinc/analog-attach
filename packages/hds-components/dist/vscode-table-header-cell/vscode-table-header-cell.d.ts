import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
export type SortDirection = 'asc' | 'desc' | 'none';
/**
 * @tag vscode-table-header-cell
 *
 * @fires {CustomEvent<sortDirection>} vsc-table-header-cell-sort - Emitted when the header cell sort icon is clicked.
 *
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 */
export declare class VscodeTableHeaderCell extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    role: string;
    alignment: 'left' | 'center' | 'right';
    sortable: boolean;
    sortDirection: SortDirection;
    private _handleSort;
    render(): TemplateResult;
    private renderSortButton;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-table-header-cell': VscodeTableHeaderCell;
    }
}
//# sourceMappingURL=vscode-table-header-cell.d.ts.map