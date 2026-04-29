var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-context-menu-item.styles.js';
/**
 * @tag vscode-context-menu-item
 *
 * Child component of [ContextMenu](/components/context-menu/).
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-menu-background=#1f1f1f]
 * @cssprop [--vscode-menu-selectionBorder=transparent]
 * @cssprop [--vscode-menu-foreground=#cccccc]
 * @cssprop [--vscode-menu-selectionBackground=#0078d4]
 * @cssprop [--vscode-menu-selectionForeground=#ffffff]
 * @cssprop [--vscode-menu-separatorBackground=#454545]
 */
let VscodeContextMenuItem = class VscodeContextMenuItem extends VscElement {
    constructor() {
        super(...arguments);
        this.label = '';
        this.keybinding = '';
        this.value = '';
        this.separator = false;
        this.tabindex = 0;
    }
    onItemClick() {
        /** @internal */
        this.dispatchEvent(new CustomEvent('vsc-click', {
            detail: {
                label: this.label,
                keybinding: this.keybinding,
                value: this.value || this.label,
                separator: this.separator,
                tabindex: this.tabindex,
            },
            bubbles: true,
            composed: true,
        }));
    }
    render() {
        return html `
      ${this.separator
            ? html `
            <div class="context-menu-item separator">
              <span class="ruler"></span>
            </div>
          `
            : html `
            <div class="context-menu-item">
              <a @click=${this.onItemClick}>
                ${this.label
                ? html `<span class="label">${this.label}</span>`
                : nothing}
                ${this.keybinding
                ? html `<span class="keybinding">${this.keybinding}</span>`
                : nothing}
              </a>
            </div>
          `}
    `;
    }
};
VscodeContextMenuItem.styles = styles;
__decorate([
    property({ type: String })
], VscodeContextMenuItem.prototype, "label", void 0);
__decorate([
    property({ type: String })
], VscodeContextMenuItem.prototype, "keybinding", void 0);
__decorate([
    property({ type: String })
], VscodeContextMenuItem.prototype, "value", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeContextMenuItem.prototype, "separator", void 0);
__decorate([
    property({ type: Number })
], VscodeContextMenuItem.prototype, "tabindex", void 0);
VscodeContextMenuItem = __decorate([
    customElement('vscode-context-menu-item')
], VscodeContextMenuItem);
export { VscodeContextMenuItem };
//# sourceMappingURL=vscode-context-menu-item.js.map