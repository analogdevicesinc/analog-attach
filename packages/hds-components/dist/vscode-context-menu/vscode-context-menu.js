var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import '../vscode-context-menu-item/index.js';
import styles from './vscode-context-menu.styles.js';
/**
 * @tag vscode-context-menu
 *
 * @fires {VscMenuSelectEvent} vsc-menu-select - Emitted when a menu item is clicked
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-menu-background=#1f1f1f]
 * @cssprop [--vscode-menu-border=#454545]
 * @cssprop [--vscode-menu-foreground=#cccccc]
 * @cssprop [--vscode-widget-shadow=rgba(0, 0, 0, 0.36)]
 */
let VscodeContextMenu = class VscodeContextMenu extends VscElement {
    set data(data) {
        this._data = data;
        const indexes = [];
        data.forEach((v, i) => {
            if (!v.separator) {
                indexes.push(i);
            }
        });
        this._clickableItemIndexes = indexes;
    }
    get data() {
        return this._data;
    }
    set show(show) {
        this._show = show;
        this._selectedClickableItemIndex = -1;
        if (show) {
            this.updateComplete.then(() => {
                if (this._wrapperEl) {
                    this._wrapperEl.focus();
                }
                requestAnimationFrame(() => {
                    document.addEventListener('click', this._onClickOutsideBound, {
                        once: true,
                    });
                });
            });
        }
    }
    get show() {
        return this._show;
    }
    constructor() {
        super();
        /**
         * By default, the menu closes when an item is clicked. This attribute prevents the menu from closing.
         */
        this.preventClose = false;
        /** @internal */
        this.tabIndex = 0;
        /* connectedCallback(): void {
          super.connectedCallback();
          document.addEventListener('click', this._onClickOutsideBound);
        }
      
        disconnectedCallback(): void {
          super.disconnectedCallback();
          document.removeEventListener('click', this._onClickOutsideBound);
        } */
        this._selectedClickableItemIndex = -1;
        this._show = false;
        this._data = [];
        this._clickableItemIndexes = [];
        this._onClickOutsideBound = this._onClickOutside.bind(this);
        this.addEventListener('keydown', this._onKeyDown);
    }
    _onClickOutside(ev) {
        if (!ev.composedPath().includes(this)) {
            this.show = false;
        }
    }
    _onKeyDown(ev) {
        const { key } = ev;
        if (key === 'ArrowUp' ||
            key === 'ArrowDown' ||
            key === 'Escape' ||
            key === 'Enter') {
            ev.preventDefault();
        }
        switch (key) {
            case 'ArrowUp':
                this._handleArrowUp();
                break;
            case 'ArrowDown':
                this._handleArrowDown();
                break;
            case 'Escape':
                this._handleEscape();
                break;
            case 'Enter':
                this._handleEnter();
                break;
            default:
        }
    }
    _handleArrowUp() {
        if (this._selectedClickableItemIndex === 0) {
            this._selectedClickableItemIndex = this._clickableItemIndexes.length - 1;
        }
        else {
            this._selectedClickableItemIndex -= 1;
        }
    }
    _handleArrowDown() {
        if (this._selectedClickableItemIndex + 1 <
            this._clickableItemIndexes.length) {
            this._selectedClickableItemIndex += 1;
        }
        else {
            this._selectedClickableItemIndex = 0;
        }
    }
    _handleEscape() {
        this.show = false;
        document.removeEventListener('click', this._onClickOutsideBound);
    }
    _dispatchSelectEvent(selectedOption) {
        const { keybinding, label, value, separator, tabindex } = selectedOption;
        this.dispatchEvent(new CustomEvent('vsc-context-menu-select', {
            detail: {
                keybinding,
                label,
                separator,
                tabindex,
                value,
            },
        }));
    }
    _handleEnter() {
        if (this._selectedClickableItemIndex === -1) {
            return;
        }
        const realItemIndex = this._clickableItemIndexes[this._selectedClickableItemIndex];
        const options = this._wrapperEl.querySelectorAll('vscode-context-menu-item');
        const selectedOption = options[realItemIndex];
        this._dispatchSelectEvent(selectedOption);
        if (!this.preventClose) {
            this.show = false;
            document.removeEventListener('click', this._onClickOutsideBound);
        }
    }
    _onItemClick(event) {
        const et = event.currentTarget;
        this._dispatchSelectEvent(et);
        if (!this.preventClose) {
            this.show = false;
        }
    }
    _onItemMouseOver(event) {
        const el = event.target;
        const index = el.dataset.index ? +el.dataset.index : -1;
        const found = this._clickableItemIndexes.findIndex((item) => item === index);
        if (found !== -1) {
            this._selectedClickableItemIndex = found;
        }
    }
    _onItemMouseOut() {
        this._selectedClickableItemIndex = -1;
    }
    render() {
        if (!this._show) {
            return html `${nothing}`;
        }
        const selectedIndex = this._clickableItemIndexes[this._selectedClickableItemIndex];
        return html `
      <div class="context-menu" tabindex="0">
        ${this.data
            ? this.data.map(({ label = '', keybinding = '', value = '', separator = false, tabindex = 0, }, index) => html `
                <vscode-context-menu-item
                  label=${label}
                  keybinding=${keybinding}
                  value=${value}
                  ?separator=${separator}
                  ?selected=${index === selectedIndex}
                  tabindex=${tabindex}
                  @vsc-click=${this._onItemClick}
                  @mouseover=${this._onItemMouseOver}
                  @mouseout=${this._onItemMouseOut}
                  data-index=${index}
                ></vscode-context-menu-item>
              `)
            : html `<slot></slot>`}
      </div>
    `;
    }
};
VscodeContextMenu.styles = styles;
__decorate([
    property({ type: Array, attribute: false })
], VscodeContextMenu.prototype, "data", null);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'prevent-close' })
], VscodeContextMenu.prototype, "preventClose", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeContextMenu.prototype, "show", null);
__decorate([
    property({ type: Number, reflect: true })
], VscodeContextMenu.prototype, "tabIndex", void 0);
__decorate([
    state()
], VscodeContextMenu.prototype, "_selectedClickableItemIndex", void 0);
__decorate([
    state()
], VscodeContextMenu.prototype, "_show", void 0);
__decorate([
    query('.context-menu')
], VscodeContextMenu.prototype, "_wrapperEl", void 0);
VscodeContextMenu = __decorate([
    customElement('vscode-context-menu')
], VscodeContextMenu);
export { VscodeContextMenu };
//# sourceMappingURL=vscode-context-menu.js.map