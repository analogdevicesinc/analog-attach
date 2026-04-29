var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-tab-panel.styles.js';
/**
 * @tag vscode-tab-panel
 *
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-panel--background=#181818]
 */
let VscodeTabPanel = class VscodeTabPanel extends VscElement {
    constructor() {
        super(...arguments);
        this.hidden = false;
        /** @internal */
        this.ariaLabelledby = '';
        /**
         * Panel-like look
         */
        this.panel = false;
        /** @internal */
        this.role = 'tabpanel';
        /** @internal */
        this.tabIndex = 0;
    }
    render() {
        return html ` <slot></slot> `;
    }
};
VscodeTabPanel.styles = styles;
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTabPanel.prototype, "hidden", void 0);
__decorate([
    property({ reflect: true, attribute: 'aria-labelledby' })
], VscodeTabPanel.prototype, "ariaLabelledby", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTabPanel.prototype, "panel", void 0);
__decorate([
    property({ reflect: true })
], VscodeTabPanel.prototype, "role", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeTabPanel.prototype, "tabIndex", void 0);
VscodeTabPanel = __decorate([
    customElement('vscode-tab-panel')
], VscodeTabPanel);
export { VscodeTabPanel };
//# sourceMappingURL=vscode-tab-panel.js.map