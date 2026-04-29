var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-tab-header.styles.js';
/**
 * @tag vscode-tab-header
 *
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-panelTitle-activeBorder=#0078d4]
 * @cssprop [--vscode-panelTitle-activeForeground=#cccccc]
 * @cssprop [--vscode-panelTitle-inactiveForeground=#9d9d9d]
 */
let VscodeTabHeader = class VscodeTabHeader extends VscElement {
    constructor() {
        super(...arguments);
        this.active = false;
        /** @internal */
        this.ariaControls = '';
        /**
         * Panel-like look
         */
        this.panel = false;
        /** @internal */
        this.role = 'tab';
        /** @internal */
        this.tabId = -1;
    }
    attributeChangedCallback(name, old, value) {
        super.attributeChangedCallback(name, old, value);
        if (name === 'active') {
            const active = value !== null;
            this.ariaSelected = active ? 'true' : 'false';
            this.tabIndex = active ? 0 : -1;
        }
    }
    render() {
        return html `
      <div
        class=${classMap({
            wrapper: true,
            active: this.active,
            panel: this.panel,
        })}
      >
        <div class="before"><slot name="content-before"></slot></div>
        <div class="main"><slot></slot></div>
        <div class="after"><slot name="content-after"></slot></div>
        <span
          class=${classMap({
            'active-indicator': true,
            active: this.active,
            panel: this.panel,
        })}
        ></span>
      </div>
    `;
    }
};
VscodeTabHeader.styles = styles;
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTabHeader.prototype, "active", void 0);
__decorate([
    property({ reflect: true, attribute: 'aria-controls' })
], VscodeTabHeader.prototype, "ariaControls", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTabHeader.prototype, "panel", void 0);
__decorate([
    property({ reflect: true })
], VscodeTabHeader.prototype, "role", void 0);
__decorate([
    property({ type: Number, reflect: true, attribute: 'tab-id' })
], VscodeTabHeader.prototype, "tabId", void 0);
VscodeTabHeader = __decorate([
    customElement('vscode-tab-header')
], VscodeTabHeader);
export { VscodeTabHeader };
//# sourceMappingURL=vscode-tab-header.js.map