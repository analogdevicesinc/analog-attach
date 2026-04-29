import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import '../vscode-scrollable/index.js';
/**
 * @tag vscode-table
 *
 * @cssprop [--vscode-editorGroup-border=rgba(255, 255, 255, 0.09)]
 * @cssprop [--vscode-keybindingTable-rowsBackground=rgba(204, 204, 204, 0.04)]
 * @cssprop [--vscode-sash-hoverBorder=#0078d4]
 */
export declare class VscodeTable extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    role: string;
    resizable: boolean;
    responsive: boolean;
    /**
     * Both rows and columns are separated by borders.
     */
    bordered: boolean;
    /**
     * Columns are separated by borders.
     */
    borderedColumns: boolean;
    /**
     * Rows are separated by borders.
     */
    borderedRows: boolean;
    breakpoint: number;
    /**
     * Initial column sizes in a JSON-encoded array.
     * Accepted values are:
     * - number
     * - string-type number (ex.: "100")
     * - px value (ex.: "100px")
     * - percentage value (ex.: "50%")
     * - percentage value (ex.: "50%")
     * - "auto" keyword
     */
    set columns(val: string[]);
    get columns(): string[];
    /**
     * Minimum column width. Valid values are:
     * - number
     * - string-type number (ex.: "100")
     * - px value (ex.: "100px")
     * - percentage value (ex.: "50%")
     * - percentage value (ex.: "50%")
     * - "auto" keyword
     */
    minColumnWidth: string;
    delayedResizing: boolean;
    /**
     * @internal
     */
    compact: boolean;
    /**
     * Condensed view, rows have less height and padding.
     */
    condensed: boolean;
    /**
     * Zebra stripes, even rows are tinted.
     */
    zebra: boolean;
    /**
     * Zebra stripes, odd rows are tinted.
     */
    zebraOdd: boolean;
    private _bodySlot;
    private _headerElement;
    private _scrollableElement;
    private _sashVisibleElements;
    private _assignedElements;
    private _assignedHeaderElements;
    private _assignedBodyElements;
    /**
     * Sash positions in percentage
     */
    private _sashPositions;
    private _isDragging;
    /**
     * Sash hover state flags, used in the render.
     */
    private _sashHovers;
    private _columns;
    private _componentResizeObserver?;
    private _headerResizeObserver?;
    private _bodyResizeObserver?;
    private _activeSashElementIndex;
    private _activeSashCursorOffset;
    private _componentX;
    private _componentH;
    private _componentW;
    /**
     * Cached querySelectorAll result. Updated when the header slot changes.
     * It shouldn't be used directly, check the "_getHeaderCells" function.
     */
    private _headerCells;
    /**
     * Cached querySelectorAll result. Updated when the body slot changes.
     * It shouldn't be used directly, check the "_getCellsOfFirstRow" function.
     */
    private _cellsOfFirstRow;
    private _cellsToResize;
    private _headerCellsToResize;
    private _prevHeaderHeight;
    private _prevComponentHeight;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private _px2Percent;
    private _percent2Px;
    private _memoizeComponentDimensions;
    private _queryHeaderCells;
    /**
     * Get cached header cells
     */
    private _getHeaderCells;
    private _queryCellsOfFirstRow;
    /**
     * Get cached cells of first row
     */
    private _getCellsOfFirstRow;
    private _resizeTableBody;
    private _initResizeObserver;
    private _componentResizeObserverCallback;
    private _headerResizeObserverCallback;
    private _bodyResizeObserverCallback;
    private _calcColWidthPercentages;
    private _initHeaderCellSizes;
    private _initBodyColumnSizes;
    private _initSashes;
    private _initDefaultColumnSizes;
    private _updateResizeHandlersSize;
    private _applyCompactViewColumnLabels;
    private _clearCompactViewColumnLabels;
    private _toggleCompactView;
    private _onDefaultSlotChange;
    private _onHeaderSlotChange;
    private _onBodySlotChange;
    private _onSashMouseOver;
    private _onSashMouseOut;
    private _onSashMouseDown;
    private _updateActiveSashPosition;
    private _getSashPositions;
    private _resizeColumns;
    private _onResizingMouseMove;
    private _onResizingMouseUp;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-table': VscodeTable;
    }
}
//# sourceMappingURL=vscode-table.d.ts.map