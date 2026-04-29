var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property, query, queryAll, queryAssignedElements, state, } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
import '../vscode-scrollable/index.js';
import { rawValueToPercentage } from './helpers.js';
import styles from './vscode-table.styles.js';
const COMPONENT_WIDTH_PERCENTAGE = 100;
/**
 * @tag vscode-table
 *
 * @cssprop [--vscode-editorGroup-border=rgba(255, 255, 255, 0.09)]
 * @cssprop [--vscode-keybindingTable-rowsBackground=rgba(204, 204, 204, 0.04)]
 * @cssprop [--vscode-sash-hoverBorder=#0078d4]
 */
let VscodeTable = class VscodeTable extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'table';
        this.resizable = false;
        this.responsive = false;
        /**
         * Both rows and columns are separated by borders.
         */
        this.bordered = false;
        /**
         * Columns are separated by borders.
         */
        this.borderedColumns = false;
        /**
         * Rows are separated by borders.
         */
        this.borderedRows = true;
        this.breakpoint = 300;
        /**
         * Minimum column width. Valid values are:
         * - number
         * - string-type number (ex.: "100")
         * - px value (ex.: "100px")
         * - percentage value (ex.: "50%")
         * - percentage value (ex.: "50%")
         * - "auto" keyword
         */
        this.minColumnWidth = '50px';
        this.delayedResizing = false;
        /**
         * @internal
         */
        this.compact = false;
        /**
         * Condensed view, rows have less height and padding.
         */
        this.condensed = false;
        /**
         * Zebra stripes, even rows are tinted.
         */
        this.zebra = false;
        /**
         * Zebra stripes, odd rows are tinted.
         */
        this.zebraOdd = false;
        /**
         * Sash positions in percentage
         */
        this._sashPositions = [];
        this._isDragging = false;
        /**
         * Sash hover state flags, used in the render.
         */
        this._sashHovers = [];
        this._columns = [];
        this._activeSashElementIndex = -1;
        this._activeSashCursorOffset = 0;
        this._componentX = 0;
        this._componentH = 0;
        this._componentW = 0;
        /**
         * Cached querySelectorAll result. Updated when the header slot changes.
         * It shouldn't be used directly, check the "_getHeaderCells" function.
         */
        this._headerCells = [];
        /**
         * Cached querySelectorAll result. Updated when the body slot changes.
         * It shouldn't be used directly, check the "_getCellsOfFirstRow" function.
         */
        this._cellsOfFirstRow = [];
        this._prevHeaderHeight = 0;
        this._prevComponentHeight = 0;
        this._componentResizeObserverCallback = () => {
            this._memoizeComponentDimensions();
            this._updateResizeHandlersSize();
            if (this.responsive) {
                this._toggleCompactView();
            }
            this._resizeTableBody();
        };
        this._headerResizeObserverCallback = () => {
            this._updateResizeHandlersSize();
        };
        this._bodyResizeObserverCallback = () => {
            this._resizeTableBody();
        };
        this._onResizingMouseMove = (event) => {
            event.stopPropagation();
            this._updateActiveSashPosition(event.pageX);
            if (!this.delayedResizing) {
                this._resizeColumns(true);
            }
            else {
                this._resizeColumns(false);
            }
        };
        this._onResizingMouseUp = (event) => {
            this._resizeColumns(true);
            this._updateActiveSashPosition(event.pageX);
            this._sashHovers[this._activeSashElementIndex] = false;
            this._isDragging = false;
            this._activeSashElementIndex = -1;
            document.removeEventListener('mousemove', this._onResizingMouseMove);
            document.removeEventListener('mouseup', this._onResizingMouseUp);
        };
    }
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
    set columns(val) {
        this._columns = val;
        if (this.isConnected) {
            this._initDefaultColumnSizes();
        }
    }
    get columns() {
        return this._columns;
    }
    connectedCallback() {
        super.connectedCallback();
        this._memoizeComponentDimensions();
        this._initDefaultColumnSizes();
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this._componentResizeObserver?.unobserve(this);
        this._componentResizeObserver?.disconnect();
        this._bodyResizeObserver?.disconnect();
    }
    _px2Percent(px) {
        return (px / this._componentW) * 100;
    }
    _percent2Px(percent) {
        return (this._componentW * percent) / 100;
    }
    _memoizeComponentDimensions() {
        const cr = this.getBoundingClientRect();
        this._componentH = cr.height;
        this._componentW = cr.width;
        this._componentX = cr.x;
    }
    _queryHeaderCells() {
        const headers = this._assignedHeaderElements;
        if (!(headers && headers[0])) {
            return [];
        }
        return Array.from(headers[0].querySelectorAll('vscode-table-header-cell'));
    }
    /**
     * Get cached header cells
     */
    _getHeaderCells() {
        if (!this._headerCells.length) {
            this._headerCells = this._queryHeaderCells();
        }
        return this._headerCells;
    }
    _queryCellsOfFirstRow() {
        const assignedBodyElements = this._assignedBodyElements;
        if (!(assignedBodyElements && assignedBodyElements[0])) {
            return [];
        }
        return Array.from(assignedBodyElements[0].querySelectorAll('vscode-table-row:first-child vscode-table-cell'));
    }
    /**
     * Get cached cells of first row
     */
    _getCellsOfFirstRow() {
        if (!this._cellsOfFirstRow.length) {
            this._cellsOfFirstRow = this._queryCellsOfFirstRow();
        }
        return this._cellsOfFirstRow;
    }
    _resizeTableBody() {
        let headerHeight = 0;
        let tbodyHeight = 0;
        const tableHeight = this.getBoundingClientRect().height;
        if (this._assignedHeaderElements && this._assignedHeaderElements.length) {
            headerHeight =
                this._assignedHeaderElements[0].getBoundingClientRect().height;
        }
        if (this._assignedBodyElements && this._assignedBodyElements.length) {
            tbodyHeight =
                this._assignedBodyElements[0].getBoundingClientRect().height;
        }
        const overflownContentHeight = tbodyHeight - headerHeight - tableHeight;
        this._scrollableElement.style.height =
            overflownContentHeight > 0 ? `${tableHeight - headerHeight}px` : 'auto';
    }
    _initResizeObserver() {
        this._componentResizeObserver = new ResizeObserver(this._componentResizeObserverCallback);
        this._componentResizeObserver.observe(this);
        this._headerResizeObserver = new ResizeObserver(this._headerResizeObserverCallback);
        this._headerResizeObserver.observe(this._headerElement);
    }
    _calcColWidthPercentages() {
        const numCols = this._getHeaderCells().length;
        let cols = this.columns.slice(0, numCols);
        const numAutoCols = cols.filter((c) => c === 'auto').length + numCols - cols.length;
        let availablePercent = 100;
        cols = cols.map((col) => {
            const percentage = rawValueToPercentage(col, this._componentW);
            if (percentage === null) {
                return 'auto';
            }
            availablePercent -= percentage;
            return percentage;
        });
        if (cols.length < numCols) {
            for (let i = cols.length; i < numCols; i++) {
                cols.push('auto');
            }
        }
        cols = cols.map((col) => {
            if (col === 'auto') {
                return availablePercent / numAutoCols;
            }
            return col;
        });
        return cols;
    }
    _initHeaderCellSizes(colWidths) {
        this._getHeaderCells().forEach((cell, index) => {
            cell.style.width = `${colWidths[index]}%`;
        });
    }
    _initBodyColumnSizes(colWidths) {
        this._getCellsOfFirstRow().forEach((cell, index) => {
            cell.style.width = `${colWidths[index]}%`;
        });
    }
    _initSashes(colWidths) {
        const l = colWidths.length;
        let prevHandlerPos = 0;
        this._sashPositions = [];
        colWidths.forEach((collW, index) => {
            if (index < l - 1) {
                const pos = prevHandlerPos + collW;
                this._sashPositions.push(pos);
                prevHandlerPos = pos;
            }
        });
    }
    _initDefaultColumnSizes() {
        const colWidths = this._calcColWidthPercentages();
        this._initHeaderCellSizes(colWidths);
        this._initBodyColumnSizes(colWidths);
        this._initSashes(colWidths);
    }
    _updateResizeHandlersSize() {
        const headerCr = this._headerElement.getBoundingClientRect();
        if (headerCr.height === this._prevHeaderHeight &&
            this._componentH === this._prevComponentHeight) {
            return;
        }
        this._prevHeaderHeight = headerCr.height;
        this._prevComponentHeight = this._componentH;
        const bodyHeight = this._componentH - headerCr.height;
        this._sashVisibleElements.forEach((el) => {
            el.style.height = `${bodyHeight}px`;
            el.style.top = `${headerCr.height}px`;
        });
    }
    _applyCompactViewColumnLabels() {
        const headerCells = this._getHeaderCells();
        const labels = headerCells.map((c) => c.innerText);
        const rows = this.querySelectorAll('vscode-table-row');
        rows.forEach((r) => {
            const cells = r.querySelectorAll('vscode-table-cell');
            cells.forEach((c, i) => {
                c.columnLabel = labels[i];
                c.compact = true;
            });
        });
    }
    _clearCompactViewColumnLabels() {
        this.querySelectorAll('vscode-table-cell').forEach((c) => {
            c.columnLabel = '';
            c.compact = false;
        });
    }
    _toggleCompactView() {
        const cr = this.getBoundingClientRect();
        const nextCompactView = cr.width < this.breakpoint;
        if (this.compact !== nextCompactView) {
            this.compact = nextCompactView;
            if (nextCompactView) {
                this._applyCompactViewColumnLabels();
            }
            else {
                this._clearCompactViewColumnLabels();
            }
        }
    }
    _onDefaultSlotChange() {
        this._assignedElements.forEach((el) => {
            if (el.tagName.toLowerCase() === 'vscode-table-header') {
                el.slot = 'header';
                return;
            }
            if (el.tagName.toLowerCase() === 'vscode-table-body') {
                el.slot = 'body';
                return;
            }
        });
    }
    _onHeaderSlotChange() {
        this._headerCells = this._queryHeaderCells();
    }
    _onBodySlotChange() {
        this._initDefaultColumnSizes();
        this._initResizeObserver();
        this._updateResizeHandlersSize();
        if (!this._bodyResizeObserver) {
            const tbody = this._assignedBodyElements[0] ?? null;
            if (tbody) {
                this._bodyResizeObserver = new ResizeObserver(this._bodyResizeObserverCallback);
                this._bodyResizeObserver.observe(tbody);
            }
        }
    }
    _onSashMouseOver(event) {
        if (this._isDragging) {
            return;
        }
        const target = event.currentTarget;
        const index = Number(target.dataset.index);
        this._sashHovers[index] = true;
        this.requestUpdate();
    }
    _onSashMouseOut(event) {
        event.stopPropagation();
        if (this._isDragging) {
            return;
        }
        const target = event.currentTarget;
        const index = Number(target.dataset.index);
        this._sashHovers[index] = false;
        this.requestUpdate();
    }
    _onSashMouseDown(event) {
        event.stopPropagation();
        const { pageX, currentTarget } = event;
        const el = currentTarget;
        const index = Number(el.dataset.index);
        const cr = el.getBoundingClientRect();
        const elX = cr.x;
        this._isDragging = true;
        this._activeSashElementIndex = index;
        this._sashHovers[this._activeSashElementIndex] = true;
        this._activeSashCursorOffset = this._px2Percent(pageX - elX);
        const headerCells = this._getHeaderCells();
        this._headerCellsToResize = [];
        this._headerCellsToResize.push(headerCells[index]);
        if (headerCells[index + 1]) {
            this._headerCellsToResize[1] = headerCells[index + 1];
        }
        const tbody = this._bodySlot.assignedElements()[0];
        const cells = tbody.querySelectorAll('vscode-table-row:first-child > vscode-table-cell');
        this._cellsToResize = [];
        this._cellsToResize.push(cells[index]);
        if (cells[index + 1]) {
            this._cellsToResize.push(cells[index + 1]);
        }
        document.addEventListener('mousemove', this._onResizingMouseMove);
        document.addEventListener('mouseup', this._onResizingMouseUp);
    }
    _updateActiveSashPosition(mouseX) {
        const { prevSashPos, nextSashPos } = this._getSashPositions();
        let minColumnWidth = rawValueToPercentage(this.minColumnWidth, this._componentW);
        if (minColumnWidth === null) {
            minColumnWidth = 0;
        }
        const minX = prevSashPos ? prevSashPos + minColumnWidth : minColumnWidth;
        const maxX = nextSashPos
            ? nextSashPos - minColumnWidth
            : COMPONENT_WIDTH_PERCENTAGE - minColumnWidth;
        let newX = this._px2Percent(mouseX - this._componentX - this._percent2Px(this._activeSashCursorOffset));
        newX = Math.max(newX, minX);
        newX = Math.min(newX, maxX);
        this._sashPositions[this._activeSashElementIndex] = newX;
        this.requestUpdate();
    }
    _getSashPositions() {
        const sashPos = this._sashPositions[this._activeSashElementIndex];
        const prevSashPos = this._sashPositions[this._activeSashElementIndex - 1] || 0;
        const nextSashPos = this._sashPositions[this._activeSashElementIndex + 1] ||
            COMPONENT_WIDTH_PERCENTAGE;
        return {
            sashPos,
            prevSashPos,
            nextSashPos,
        };
    }
    _resizeColumns(resizeBodyCells = true) {
        const { sashPos, prevSashPos, nextSashPos } = this._getSashPositions();
        const prevColW = sashPos - prevSashPos;
        const nextColW = nextSashPos - sashPos;
        const prevColCss = `${prevColW}%`;
        const nextColCss = `${nextColW}%`;
        this._headerCellsToResize[0].style.width = prevColCss;
        if (this._headerCellsToResize[1]) {
            this._headerCellsToResize[1].style.width = nextColCss;
        }
        if (resizeBodyCells && this._cellsToResize[0]) {
            this._cellsToResize[0].style.width = prevColCss;
            if (this._cellsToResize[1]) {
                this._cellsToResize[1].style.width = nextColCss;
            }
        }
    }
    render() {
        const sashes = this._sashPositions.map((val, index) => {
            const classes = classMap({
                sash: true,
                hover: this._sashHovers[index],
                resizable: this.resizable,
            });
            const left = `${val}%`;
            return this.resizable
                ? html `
            <div
              class=${classes}
              data-index=${index}
              .style=${stylePropertyMap({ left })}
              @mousedown=${this._onSashMouseDown}
              @mouseover=${this._onSashMouseOver}
              @mouseout=${this._onSashMouseOut}
            >
              <div class="sash-visible"></div>
              <div class="sash-clickable"></div>
            </div>
          `
                : html `<div
            class=${classes}
            data-index=${index}
            .style=${stylePropertyMap({ left })}
          >
            <div class="sash-visible"></div>
          </div>`;
        });
        const wrapperClasses = classMap({
            wrapper: true,
            'select-disabled': this._isDragging,
            'resize-cursor': this._isDragging,
            'compact-view': this.compact,
        });
        return html `
      <div class=${wrapperClasses}>
        <div class="header">
          <slot name="caption"></slot>
          <div class="header-slot-wrapper">
            <slot name="header" @slotchange=${this._onHeaderSlotChange}></slot>
          </div>
        </div>
        <vscode-scrollable class="scrollable">
          <div>
            <slot name="body" @slotchange=${this._onBodySlotChange}></slot>
          </div>
        </vscode-scrollable>
        ${sashes}
        <slot @slotchange=${this._onDefaultSlotChange}></slot>
      </div>
    `;
    }
};
VscodeTable.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeTable.prototype, "role", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTable.prototype, "resizable", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTable.prototype, "responsive", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTable.prototype, "bordered", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'bordered-columns' })
], VscodeTable.prototype, "borderedColumns", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'bordered-rows' })
], VscodeTable.prototype, "borderedRows", void 0);
__decorate([
    property({ type: Number })
], VscodeTable.prototype, "breakpoint", void 0);
__decorate([
    property({ type: Array })
], VscodeTable.prototype, "columns", null);
__decorate([
    property({ attribute: 'min-column-width' })
], VscodeTable.prototype, "minColumnWidth", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'delayed-resizing' })
], VscodeTable.prototype, "delayedResizing", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTable.prototype, "compact", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'condensed' })
], VscodeTable.prototype, "condensed", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTable.prototype, "zebra", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'zebra-odd' })
], VscodeTable.prototype, "zebraOdd", void 0);
__decorate([
    query('slot[name="body"]')
], VscodeTable.prototype, "_bodySlot", void 0);
__decorate([
    query('.header')
], VscodeTable.prototype, "_headerElement", void 0);
__decorate([
    query('.scrollable')
], VscodeTable.prototype, "_scrollableElement", void 0);
__decorate([
    queryAll('.sash-visible')
], VscodeTable.prototype, "_sashVisibleElements", void 0);
__decorate([
    queryAssignedElements({
        flatten: true,
        selector: 'vscode-table-header, vscode-table-body',
    })
], VscodeTable.prototype, "_assignedElements", void 0);
__decorate([
    queryAssignedElements({
        slot: 'header',
        flatten: true,
        selector: 'vscode-table-header',
    })
], VscodeTable.prototype, "_assignedHeaderElements", void 0);
__decorate([
    queryAssignedElements({
        slot: 'body',
        flatten: true,
        selector: 'vscode-table-body',
    })
], VscodeTable.prototype, "_assignedBodyElements", void 0);
__decorate([
    state()
], VscodeTable.prototype, "_sashPositions", void 0);
__decorate([
    state()
], VscodeTable.prototype, "_isDragging", void 0);
VscodeTable = __decorate([
    customElement('vscode-table')
], VscodeTable);
export { VscodeTable };
//# sourceMappingURL=vscode-table.js.map