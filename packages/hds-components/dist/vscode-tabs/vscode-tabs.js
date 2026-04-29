var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property, queryAssignedElements } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import uniqueId from '../includes/uniqueId.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import { VscodeTabHeader } from '../vscode-tab-header/index.js';
import { VscodeTabPanel } from '../vscode-tab-panel/index.js';
import styles from './vscode-tabs.styles.js';
/**
 * @tag vscode-tabs
 *
 * @slot - Default slot. It is used for tab panels.
 * @slot header - Slot for tab headers.
 * @slot addons - Right aligned area in the header.
 *
 * @fires {VscTabSelectEvent} vsc-tabs-select - Dispatched when the active tab is changed
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-settings-headerBorder=#2b2b2b]
 * @cssprop [--vscode-panel-background=#181818]
 */
let VscodeTabs = class VscodeTabs extends VscElement {
    constructor() {
        super();
        /**
         * Panel-like look
         */
        this.panel = false;
        this.selectedIndex = 0;
        this._tabHeaders = [];
        this._tabPanels = [];
        this._componentId = '';
        this._tabFocus = 0;
        this._componentId = uniqueId();
    }
    attributeChangedCallback(name, old, value) {
        super.attributeChangedCallback(name, old, value);
        if (name === 'selected-index') {
            this._setActiveTab();
        }
        if (name === 'panel') {
            this._tabHeaders.forEach((h) => (h.panel = value !== null));
            this._tabPanels.forEach((p) => (p.panel = value !== null));
        }
    }
    _dispatchSelectEvent() {
        this.dispatchEvent(new CustomEvent('vsc-tabs-select', {
            detail: {
                selectedIndex: this.selectedIndex,
            },
            composed: true,
        }));
    }
    _setActiveTab() {
        this._tabFocus = this.selectedIndex;
        this._tabPanels.forEach((el, i) => {
            el.hidden = i !== this.selectedIndex;
        });
        this._tabHeaders.forEach((el, i) => {
            el.active = i === this.selectedIndex;
        });
    }
    _focusPrevTab() {
        if (this._tabFocus === 0) {
            this._tabFocus = this._tabHeaders.length - 1;
        }
        else {
            this._tabFocus -= 1;
        }
    }
    _focusNextTab() {
        if (this._tabFocus === this._tabHeaders.length - 1) {
            this._tabFocus = 0;
        }
        else {
            this._tabFocus += 1;
        }
    }
    _onHeaderKeyDown(ev) {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
            ev.preventDefault();
            this._tabHeaders[this._tabFocus].setAttribute('tabindex', '-1');
            if (ev.key === 'ArrowLeft') {
                this._focusPrevTab();
            }
            else if (ev.key === 'ArrowRight') {
                this._focusNextTab();
            }
            this._tabHeaders[this._tabFocus].setAttribute('tabindex', '0');
            this._tabHeaders[this._tabFocus].focus();
        }
        if (ev.key === 'Enter') {
            ev.preventDefault();
            this.selectedIndex = this._tabFocus;
            this._dispatchSelectEvent();
        }
    }
    _moveHeadersToHeaderSlot() {
        const headers = this._mainSlotElements.filter((el) => el instanceof VscodeTabHeader);
        if (headers.length > 0) {
            headers.forEach((h) => h.setAttribute('slot', 'header'));
        }
    }
    _onMainSlotChange() {
        this._moveHeadersToHeaderSlot();
        this._tabPanels = this._mainSlotElements.filter((el) => el instanceof VscodeTabPanel);
        this._tabPanels.forEach((el, i) => {
            el.ariaLabelledby = `t${this._componentId}-h${i}`;
            el.id = `t${this._componentId}-p${i}`;
            el.panel = this.panel;
        });
        this._setActiveTab();
    }
    _onHeaderSlotChange() {
        this._tabHeaders = this._headerSlotElements.filter((el) => el instanceof VscodeTabHeader);
        this._tabHeaders.forEach((el, i) => {
            el.tabId = i;
            el.id = `t${this._componentId}-h${i}`;
            el.ariaControls = `t${this._componentId}-p${i}`;
            el.panel = this.panel;
            el.active = i === this.selectedIndex;
        });
    }
    _onHeaderClick(event) {
        const path = event.composedPath();
        const headerEl = path.find((et) => et instanceof VscodeTabHeader);
        if (headerEl) {
            this.selectedIndex = headerEl.tabId;
            this._setActiveTab();
            this._dispatchSelectEvent();
        }
    }
    render() {
        return html `
      <div
        class=${classMap({ header: true, panel: this.panel })}
        @click=${this._onHeaderClick}
        @keydown=${this._onHeaderKeyDown}
      >
        <div role="tablist" class="tablist">
          <slot
            name="header"
            @slotchange=${this._onHeaderSlotChange}
            role="tablist"
          ></slot>
        </div>
        <slot name="addons"></slot>
      </div>
      <slot @slotchange=${this._onMainSlotChange}></slot>
    `;
    }
};
VscodeTabs.styles = styles;
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTabs.prototype, "panel", void 0);
__decorate([
    property({ type: Number, reflect: true, attribute: 'selected-index' })
], VscodeTabs.prototype, "selectedIndex", void 0);
__decorate([
    queryAssignedElements({ slot: 'header' })
], VscodeTabs.prototype, "_headerSlotElements", void 0);
__decorate([
    queryAssignedElements()
], VscodeTabs.prototype, "_mainSlotElements", void 0);
VscodeTabs = __decorate([
    customElement('vscode-tabs')
], VscodeTabs);
export { VscodeTabs };
//# sourceMappingURL=vscode-tabs.js.map