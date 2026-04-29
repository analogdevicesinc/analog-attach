var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var VscodeSplitLayout_1;
import { html } from 'lit';
import { property, query, queryAssignedElements, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-split-layout.styles.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
const DEFAULT_INITIAL_POSITION = '50%';
const DEFAULT_HANDLE_SIZE = 4;
export const parseValue = (raw) => {
    if (!raw) {
        return { value: 0, unit: 'pixel' };
    }
    let unit;
    let rawVal;
    if (raw.endsWith('%')) {
        unit = 'percent';
        rawVal = +raw.substring(0, raw.length - 1);
    }
    else if (raw.endsWith('px')) {
        unit = 'pixel';
        rawVal = +raw.substring(0, raw.length - 2);
    }
    else {
        unit = 'pixel';
        rawVal = +raw;
    }
    const value = isNaN(rawVal) ? 0 : rawVal;
    return { unit, value };
};
// Returns a percentage between 0 and 100
export const pxToPercent = (current, max) => {
    return max === 0 ? 0 : Math.min(100, (current / max) * 100);
};
export const percentToPx = (current, max) => {
    return max * (current / 100);
};
/**
 * @tag vscode-split-layout
 *
 * @prop {'start' | 'end' | 'none'} fixedPane
 *
 * @cssprop [--separator-border=#454545]
 * @cssprop [--vscode-editorWidget-border=#454545]
 * @cssprop [--vscode-sash-hoverBorder=#0078d4]
 */
let VscodeSplitLayout = VscodeSplitLayout_1 = class VscodeSplitLayout extends VscElement {
    /**
     * Direction of the divider.
     */
    set split(newVal) {
        if (this._split === newVal) {
            return;
        }
        this._split = newVal;
        this.resetHandlePosition();
    }
    get split() {
        return this._split;
    }
    /**
     * Set the handle position programmatically. The value must include a unit,
     * either `%` or `px`. If no unit is specified, the value is interpreted as
     * `px`.
     */
    set handlePosition(newVal) {
        this._rawHandlePosition = newVal;
        this._handlePositionPropChanged();
    }
    get handlePosition() {
        return this._rawHandlePosition;
    }
    /**
     * The size of the fixed pane will not change when the component is resized.
     */
    set fixedPane(newVal) {
        this._fixedPane = newVal;
        this._fixedPanePropChanged();
    }
    get fixedPane() {
        return this._fixedPane;
    }
    constructor() {
        super();
        this._split = 'vertical';
        /**
         * Controls whether the handle position should reset to the value set in the
         * `initialHandlePosition` when it is double-clicked.
         */
        this.resetOnDblClick = false;
        /**
         * Controls the draggable area size in pixels. it is intended to use the value
         * of `workbench.sash.size`.
         */
        this.handleSize = 4;
        /**
         * The handler position will reset to this position when it is double-clicked,
         * or the `resetHandlePosition()` is called.
         */
        this.initialHandlePosition = DEFAULT_INITIAL_POSITION;
        this._fixedPane = 'none';
        this._handlePosition = 0;
        this._isDragActive = false;
        this._hover = false;
        this._hide = false;
        this._boundRect = new DOMRect();
        this._handleOffset = 0;
        this._wrapperObserved = false;
        this._fixedPaneSize = 0;
        this._handleResize = (entries) => {
            const rect = entries[0].contentRect;
            const { width, height } = rect;
            this._boundRect = rect;
            const max = this.split === 'vertical' ? width : height;
            if (this.fixedPane === 'start') {
                this._handlePosition = this._fixedPaneSize;
            }
            if (this.fixedPane === 'end') {
                this._handlePosition = max - this._fixedPaneSize;
            }
        };
        this._handleMouseUp = (ev) => {
            this._isDragActive = false;
            if (ev.target !== this) {
                this._hover = false;
                this._hide = true;
            }
            window.removeEventListener('mouseup', this._handleMouseUp);
            window.removeEventListener('mousemove', this._handleMouseMove);
            const { width, height } = this._boundRect;
            const max = this.split === 'vertical' ? width : height;
            const positionInPercentage = pxToPercent(this._handlePosition, max);
            this.dispatchEvent(new CustomEvent('vsc-split-layout-change', {
                detail: {
                    position: this._handlePosition,
                    positionInPercentage,
                },
                composed: true,
            }));
        };
        this._handleMouseMove = (event) => {
            const { clientX, clientY } = event;
            const { left, top, height, width } = this._boundRect;
            const vert = this.split === 'vertical';
            const maxPos = vert ? width : height;
            const mousePos = vert ? clientX - left : clientY - top;
            this._handlePosition = Math.max(0, Math.min(mousePos - this._handleOffset + this.handleSize / 2, maxPos));
            if (this.fixedPane === 'start') {
                this._fixedPaneSize = this._handlePosition;
            }
            if (this.fixedPane === 'end') {
                this._fixedPaneSize = maxPos - this._handlePosition;
            }
        };
        this._resizeObserver = new ResizeObserver(this._handleResize);
    }
    /**
     * Sets the handle position to the value specified in the `initialHandlePosition` property.
     */
    resetHandlePosition() {
        if (!this._wrapperEl) {
            this._handlePosition = 0;
            return;
        }
        const { width, height } = this._wrapperEl.getBoundingClientRect();
        const max = this.split === 'vertical' ? width : height;
        const { value, unit } = parseValue(this.initialHandlePosition ?? DEFAULT_INITIAL_POSITION);
        if (unit === 'percent') {
            this._handlePosition = percentToPx(value, max);
        }
        else {
            this._handlePosition = value;
        }
    }
    connectedCallback() {
        super.connectedCallback();
    }
    firstUpdated(_changedProperties) {
        if (this.fixedPane !== 'none') {
            this._resizeObserver.observe(this._wrapperEl);
            this._wrapperObserved = true;
        }
        this._boundRect = this._wrapperEl.getBoundingClientRect();
        const { value, unit } = this.handlePosition
            ? parseValue(this.handlePosition)
            : parseValue(this.initialHandlePosition);
        this._setPosition(value, unit);
        this._initFixedPane();
    }
    _handlePositionPropChanged() {
        if (this.handlePosition && this._wrapperEl) {
            this._boundRect = this._wrapperEl.getBoundingClientRect();
            const { value, unit } = parseValue(this.handlePosition);
            this._setPosition(value, unit);
        }
    }
    _fixedPanePropChanged() {
        if (!this._wrapperEl) {
            return;
        }
        this._initFixedPane();
    }
    _initFixedPane() {
        if (this.fixedPane === 'none') {
            if (this._wrapperObserved) {
                this._resizeObserver.unobserve(this._wrapperEl);
                this._wrapperObserved = false;
            }
        }
        else {
            const { width, height } = this._boundRect;
            const max = this.split === 'vertical' ? width : height;
            this._fixedPaneSize =
                this.fixedPane === 'start'
                    ? this._handlePosition
                    : max - this._handlePosition;
            if (!this._wrapperObserved) {
                this._resizeObserver.observe(this._wrapperEl);
                this._wrapperObserved = true;
            }
        }
    }
    _setPosition(value, unit) {
        const { width, height } = this._boundRect;
        const max = this.split === 'vertical' ? width : height;
        this._handlePosition = unit === 'percent' ? percentToPx(value, max) : value;
    }
    _handleMouseOver() {
        this._hover = true;
        this._hide = false;
    }
    _handleMouseOut(event) {
        if (event.buttons !== 1) {
            this._hover = false;
            this._hide = true;
        }
    }
    _handleMouseDown(event) {
        event.stopPropagation();
        event.preventDefault();
        this._boundRect = this._wrapperEl.getBoundingClientRect();
        const { left, top } = this._boundRect;
        const { left: handleLeft, top: handleTop } = this._handleEl.getBoundingClientRect();
        const mouseXLocal = event.clientX - left;
        const mouseYLocal = event.clientY - top;
        if (this.split === 'vertical') {
            this._handleOffset = mouseXLocal - (handleLeft - left);
        }
        if (this.split === 'horizontal') {
            this._handleOffset = mouseYLocal - (handleTop - top);
        }
        this._isDragActive = true;
        window.addEventListener('mouseup', this._handleMouseUp);
        window.addEventListener('mousemove', this._handleMouseMove);
    }
    _handleDblClick() {
        if (!this.resetOnDblClick) {
            return;
        }
        this.resetHandlePosition();
    }
    _handleSlotChange() {
        const nestedLayouts = [
            ...this._nestedLayoutsAtStart,
            ...this._nestedLayoutsAtEnd,
        ];
        nestedLayouts.forEach((e) => {
            if (e instanceof VscodeSplitLayout_1) {
                e.resetHandlePosition();
            }
        });
    }
    render() {
        const { width, height } = this._boundRect;
        const maxPos = this.split === 'vertical' ? width : height;
        const handlePosCss = this.fixedPane !== 'none'
            ? `${this._handlePosition}px`
            : `${pxToPercent(this._handlePosition, maxPos)}%`;
        let startPaneSize = '';
        if (this.fixedPane === 'start') {
            startPaneSize = `0 0 ${this._fixedPaneSize}px`;
        }
        else {
            startPaneSize = `1 1 ${pxToPercent(this._handlePosition, maxPos)}%`;
        }
        let endPaneSize = '';
        if (this.fixedPane === 'end') {
            endPaneSize = `0 0 ${this._fixedPaneSize}px`;
        }
        else {
            endPaneSize = `1 1 ${pxToPercent(maxPos - this._handlePosition, maxPos)}%`;
        }
        const handleStylesPropObj = {
            left: this.split === 'vertical' ? handlePosCss : '0',
            top: this.split === 'vertical' ? '0' : handlePosCss,
        };
        const handleSize = this.handleSize ?? DEFAULT_HANDLE_SIZE;
        if (this.split === 'vertical') {
            handleStylesPropObj.marginLeft = `${0 - handleSize / 2}px`;
            handleStylesPropObj.width = `${handleSize}px`;
        }
        if (this.split === 'horizontal') {
            handleStylesPropObj.height = `${handleSize}px`;
            handleStylesPropObj.marginTop = `${0 - handleSize / 2}px`;
        }
        const handleOverlayClasses = classMap({
            'handle-overlay': true,
            active: this._isDragActive,
            'split-vertical': this.split === 'vertical',
            'split-horizontal': this.split === 'horizontal',
        });
        const handleClasses = classMap({
            handle: true,
            hover: this._hover,
            hide: this._hide,
            'split-vertical': this.split === 'vertical',
            'split-horizontal': this.split === 'horizontal',
        });
        const wrapperClasses = {
            wrapper: true,
            horizontal: this.split === 'horizontal',
        };
        return html `
      <div class=${classMap(wrapperClasses)}>
        <div class="start" .style=${stylePropertyMap({ flex: startPaneSize })}>
          <slot name="start" @slotchange=${this._handleSlotChange}></slot>
        </div>
        <div class="end" .style=${stylePropertyMap({ flex: endPaneSize })}>
          <slot name="end" @slotchange=${this._handleSlotChange}></slot>
        </div>
        <div class=${handleOverlayClasses}></div>
        <div
          class=${handleClasses}
          .style=${stylePropertyMap(handleStylesPropObj)}
          @mouseover=${this._handleMouseOver}
          @mouseout=${this._handleMouseOut}
          @mousedown=${this._handleMouseDown}
          @dblclick=${this._handleDblClick}
        ></div>
      </div>
    `;
    }
};
VscodeSplitLayout.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeSplitLayout.prototype, "split", null);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'reset-on-dbl-click' })
], VscodeSplitLayout.prototype, "resetOnDblClick", void 0);
__decorate([
    property({ type: Number, reflect: true, attribute: 'handle-size' })
], VscodeSplitLayout.prototype, "handleSize", void 0);
__decorate([
    property({ reflect: true, attribute: 'initial-handle-position' })
], VscodeSplitLayout.prototype, "initialHandlePosition", void 0);
__decorate([
    property({ attribute: 'handle-position' })
], VscodeSplitLayout.prototype, "handlePosition", null);
__decorate([
    property({ attribute: 'fixed-pane' })
], VscodeSplitLayout.prototype, "fixedPane", null);
__decorate([
    state()
], VscodeSplitLayout.prototype, "_handlePosition", void 0);
__decorate([
    state()
], VscodeSplitLayout.prototype, "_isDragActive", void 0);
__decorate([
    state()
], VscodeSplitLayout.prototype, "_hover", void 0);
__decorate([
    state()
], VscodeSplitLayout.prototype, "_hide", void 0);
__decorate([
    query('.wrapper')
], VscodeSplitLayout.prototype, "_wrapperEl", void 0);
__decorate([
    query('.handle')
], VscodeSplitLayout.prototype, "_handleEl", void 0);
__decorate([
    queryAssignedElements({ slot: 'start', selector: 'vscode-split-layout' })
], VscodeSplitLayout.prototype, "_nestedLayoutsAtStart", void 0);
__decorate([
    queryAssignedElements({ slot: 'end', selector: 'vscode-split-layout' })
], VscodeSplitLayout.prototype, "_nestedLayoutsAtEnd", void 0);
VscodeSplitLayout = VscodeSplitLayout_1 = __decorate([
    customElement('vscode-split-layout')
], VscodeSplitLayout);
export { VscodeSplitLayout };
//# sourceMappingURL=vscode-split-layout.js.map