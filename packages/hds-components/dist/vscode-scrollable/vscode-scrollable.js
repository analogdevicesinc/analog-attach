var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property, query, queryAssignedElements, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
import styles from './vscode-scrollable.styles.js';
/**
 * @tag vscode-scrollable
 *
 * @cssprop [--vscode-scrollbar-shadow=#000000]
 * @cssprop [--vscode-scrollbarSlider-background=rgba(121, 121, 121, 0.4)]
 * @cssprop [--vscode-scrollbarSlider-hoverBackground=rgba(100, 100, 100, 0.7)]
 * @cssprop [--vscode-scrollbarSlider-activeBackground=rgba(191, 191, 191, 0.4)]
 */
let VscodeScrollable = class VscodeScrollable extends VscElement {
    /**
     * Scroll position.
     */
    set scrollPos(val) {
        this._scrollPos = this._limitScrollPos(val);
        this._updateScrollbar();
        this._updateThumbPosition();
        this.requestUpdate();
    }
    get scrollPos() {
        return this._scrollPos;
    }
    /**
     * The maximum amount of the `scrollPos`.
     */
    get scrollMax() {
        if (!this._scrollableContainer) {
            return 0;
        }
        return (this._scrollableContainer.scrollHeight -
            this._scrollableContainer.clientHeight);
    }
    //#region lifecycle methods
    constructor() {
        super();
        /**
         * By default, the scrollbar appears only when the cursor hovers over the
         * component. With this option, the scrollbar will always be visible.
         */
        this.alwaysVisible = false;
        /**
         * Scrolling speed multiplier when pressing `Alt`. This property is designed to use the value of
         * `editor.fastScrollSensitivity`, `workbench.list.fastScrollSensitivity` or
         * `terminal.integrated.fastScrollSensitivity` depending on the context.
         */
        this.fastScrollSensitivity = 5;
        /**
         * This setting defines the scrollbar's minimum size when the component contains a large amount of content.
         */
        this.minThumbSize = 20;
        /**
         * A multiplier to be used on the `deltaY` of the mouse wheel scroll events. This property is
         * designed to use the value of `editor.mouseWheelScrollSensitivity`,
         * `workbench.list.mouseWheelScrollSensitivity` or
         * `terminal.integrated.mouseWheelScrollSensitivity` depending on the context.
         */
        this.mouseWheelScrollSensitivity = 1;
        /**
         * Controls shadow visibility when content overflows.
         */
        this.shadow = true;
        /**
         * It's true when `scrollPos` greater than 0
         */
        this.scrolled = false;
        this._scrollPos = 0;
        this._isDragging = false;
        this._thumbHeight = 0;
        this._thumbY = 0;
        this._thumbVisible = false;
        this._thumbFade = false;
        this._thumbActive = false;
        this._componentHeight = 0;
        this._contentHeight = 0;
        this._scrollThumbStartY = 0;
        this._mouseStartY = 0;
        this._scrollbarVisible = true;
        this._scrollbarTrackZ = 0;
        //#endregion
        this._resizeObserverCallback = () => {
            this._componentHeight = this.offsetHeight;
            this._contentHeight = this._contentElement.offsetHeight;
            this._updateScrollbar();
            this._updateThumbPosition();
        };
        //#region event handlers
        this._handleSlotChange = () => {
            this._updateScrollbar();
            this._updateThumbPosition();
            this._zIndexFix();
        };
        this._handleScrollThumbMouseMove = (event) => {
            const rawThumbPos = this._scrollThumbStartY + (event.screenY - this._mouseStartY);
            this._thumbY = this._limitThumbPos(rawThumbPos);
            this.scrollPos = this._calculateScrollPosFromThumbPos(this._thumbY);
            this.dispatchEvent(new CustomEvent('vsc-scrollable-scroll', {
                detail: this.scrollPos,
            }));
        };
        this._handleScrollThumbMouseUp = (event) => {
            this._isDragging = false;
            this._thumbActive = false;
            const cr = this.getBoundingClientRect();
            const { x, y, width, height } = cr;
            const { pageX, pageY } = event;
            if (pageX > x + width || pageX < x || pageY > y + height || pageY < y) {
                this._thumbFade = true;
                this._thumbVisible = false;
            }
            document.removeEventListener('mousemove', this._handleScrollThumbMouseMove);
            document.removeEventListener('mouseup', this._handleScrollThumbMouseUp);
        };
        this._handleComponentMouseOver = () => {
            this._thumbVisible = true;
            this._thumbFade = false;
        };
        this._handleComponentMouseOut = () => {
            if (!this._thumbActive) {
                this._thumbVisible = false;
                this._thumbFade = true;
            }
        };
        this._handleComponentWheel = (ev) => {
            if (this._contentHeight <= this._componentHeight) {
                return;
            }
            ev.preventDefault();
            const multiplier = ev.altKey
                ? this.mouseWheelScrollSensitivity * this.fastScrollSensitivity
                : this.mouseWheelScrollSensitivity;
            this.scrollPos = this._limitScrollPos(this.scrollPos + ev.deltaY * multiplier);
            this.dispatchEvent(new CustomEvent('vsc-scrollable-scroll', {
                detail: this.scrollPos,
            }));
        };
        this._handleScrollableContainerScroll = (ev) => {
            if (ev.currentTarget) {
                this.scrollPos = ev.currentTarget.scrollTop;
            }
        };
        this.addEventListener('mouseover', this._handleComponentMouseOver);
        this.addEventListener('mouseout', this._handleComponentMouseOut);
        this.addEventListener('wheel', this._handleComponentWheel);
    }
    connectedCallback() {
        super.connectedCallback();
        this._hostResizeObserver = new ResizeObserver(this._resizeObserverCallback);
        this._contentResizeObserver = new ResizeObserver(this._resizeObserverCallback);
        this.requestUpdate();
        this.updateComplete.then(() => {
            this._hostResizeObserver.observe(this);
            this._contentResizeObserver.observe(this._contentElement);
            this._updateThumbPosition();
        });
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this._hostResizeObserver.unobserve(this);
        this._hostResizeObserver.disconnect();
        this._contentResizeObserver.unobserve(this._contentElement);
        this._contentResizeObserver.disconnect();
    }
    firstUpdated(_changedProperties) {
        this._updateThumbPosition();
    }
    _calcThumbHeight() {
        const componentHeight = this.offsetHeight;
        const contentHeight = this._contentElement?.offsetHeight ?? 0;
        const proposedSize = componentHeight * (componentHeight / contentHeight);
        return Math.max(this.minThumbSize, proposedSize);
    }
    _updateScrollbar() {
        const contentHeight = this._contentElement?.offsetHeight ?? 0;
        const componentHeight = this.offsetHeight;
        if (componentHeight >= contentHeight) {
            this._scrollbarVisible = false;
        }
        else {
            this._scrollbarVisible = true;
            this._thumbHeight = this._calcThumbHeight();
        }
        this.requestUpdate();
    }
    _zIndexFix() {
        let highestZ = 0;
        this._assignedElements.forEach((n) => {
            if ('style' in n) {
                const computedZIndex = window.getComputedStyle(n).zIndex;
                const isNumber = /([0-9-])+/g.test(computedZIndex);
                if (isNumber) {
                    highestZ =
                        Number(computedZIndex) > highestZ
                            ? Number(computedZIndex)
                            : highestZ;
                }
            }
        });
        this._scrollbarTrackZ = highestZ + 1;
        this.requestUpdate();
    }
    _updateThumbPosition() {
        if (!this._scrollableContainer) {
            return;
        }
        this.scrolled = this.scrollPos > 0;
        const componentH = this.offsetHeight;
        const thumbH = this._thumbHeight;
        const contentH = this._contentElement.offsetHeight;
        const overflown = contentH - componentH;
        const ratio = this.scrollPos / overflown;
        const thumbYMax = componentH - thumbH;
        this._thumbY = Math.min(ratio * (componentH - thumbH), thumbYMax);
    }
    _calculateScrollPosFromThumbPos(scrollPos) {
        const cmpH = this.getBoundingClientRect().height;
        const thumbH = this._scrollThumbElement.getBoundingClientRect().height;
        const contentH = this._contentElement.getBoundingClientRect().height;
        const rawScrollPos = (scrollPos / (cmpH - thumbH)) * (contentH - cmpH);
        return this._limitScrollPos(rawScrollPos);
    }
    _limitScrollPos(newPos) {
        if (newPos < 0) {
            return 0;
        }
        else if (newPos > this.scrollMax) {
            return this.scrollMax;
        }
        else {
            return newPos;
        }
    }
    _limitThumbPos(newPos) {
        const cmpH = this.getBoundingClientRect().height;
        const thumbH = this._scrollThumbElement.getBoundingClientRect().height;
        if (newPos < 0) {
            return 0;
        }
        else if (newPos > cmpH - thumbH) {
            return cmpH - thumbH;
        }
        else {
            return newPos;
        }
    }
    _handleScrollThumbMouseDown(event) {
        const cmpCr = this.getBoundingClientRect();
        const thCr = this._scrollThumbElement.getBoundingClientRect();
        this._mouseStartY = event.screenY;
        this._scrollThumbStartY = thCr.top - cmpCr.top;
        this._isDragging = true;
        this._thumbActive = true;
        document.addEventListener('mousemove', this._handleScrollThumbMouseMove);
        document.addEventListener('mouseup', this._handleScrollThumbMouseUp);
    }
    _handleScrollbarTrackPress(ev) {
        if (ev.target !== ev.currentTarget) {
            return;
        }
        this._thumbY = ev.offsetY - this._thumbHeight / 2;
        this.scrollPos = this._calculateScrollPosFromThumbPos(this._thumbY);
    }
    //#endregion
    render() {
        return html `
      <div
        class="scrollable-container"
        .style=${stylePropertyMap({
            userSelect: this._isDragging ? 'none' : 'auto',
        })}
        .scrollTop=${this.scrollPos}
        @scroll=${this._handleScrollableContainerScroll}
      >
        <div
          class=${classMap({ shadow: true, visible: this.scrolled })}
          .style=${stylePropertyMap({
            zIndex: String(this._scrollbarTrackZ),
        })}
        ></div>
        ${this._isDragging
            ? html `<div class="prevent-interaction"></div>`
            : nothing}
        <div
          class=${classMap({
            'scrollbar-track': true,
            hidden: !this._scrollbarVisible,
        })}
          @mousedown=${this._handleScrollbarTrackPress}
        >
          <div
            class=${classMap({
            'scrollbar-thumb': true,
            visible: this.alwaysVisible ? true : this._thumbVisible,
            fade: this.alwaysVisible ? false : this._thumbFade,
            active: this._thumbActive,
        })}
            .style=${stylePropertyMap({
            height: `${this._thumbHeight}px`,
            top: `${this._thumbY}px`,
        })}
            @mousedown=${this._handleScrollThumbMouseDown}
          ></div>
        </div>
        <div class="content">
          <slot @slotchange=${this._handleSlotChange}></slot>
        </div>
      </div>
    `;
    }
};
VscodeScrollable.styles = styles;
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'always-visible' })
], VscodeScrollable.prototype, "alwaysVisible", void 0);
__decorate([
    property({ type: Number, attribute: 'fast-scroll-sensitivity' })
], VscodeScrollable.prototype, "fastScrollSensitivity", void 0);
__decorate([
    property({ type: Number, attribute: 'min-thumb-size' })
], VscodeScrollable.prototype, "minThumbSize", void 0);
__decorate([
    property({ type: Number, attribute: 'mouse-wheel-scroll-sensitivity' })
], VscodeScrollable.prototype, "mouseWheelScrollSensitivity", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeScrollable.prototype, "shadow", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeScrollable.prototype, "scrolled", void 0);
__decorate([
    property({ type: Number, attribute: 'scroll-pos' })
], VscodeScrollable.prototype, "scrollPos", null);
__decorate([
    state()
], VscodeScrollable.prototype, "_isDragging", void 0);
__decorate([
    state()
], VscodeScrollable.prototype, "_thumbHeight", void 0);
__decorate([
    state()
], VscodeScrollable.prototype, "_thumbY", void 0);
__decorate([
    state()
], VscodeScrollable.prototype, "_thumbVisible", void 0);
__decorate([
    state()
], VscodeScrollable.prototype, "_thumbFade", void 0);
__decorate([
    state()
], VscodeScrollable.prototype, "_thumbActive", void 0);
__decorate([
    query('.content')
], VscodeScrollable.prototype, "_contentElement", void 0);
__decorate([
    query('.scrollbar-thumb', true)
], VscodeScrollable.prototype, "_scrollThumbElement", void 0);
__decorate([
    query('.scrollable-container')
], VscodeScrollable.prototype, "_scrollableContainer", void 0);
__decorate([
    queryAssignedElements()
], VscodeScrollable.prototype, "_assignedElements", void 0);
VscodeScrollable = __decorate([
    customElement('vscode-scrollable')
], VscodeScrollable);
export { VscodeScrollable };
//# sourceMappingURL=vscode-scrollable.js.map