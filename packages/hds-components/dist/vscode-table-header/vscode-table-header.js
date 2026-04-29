var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-table-header.styles.js';
/**
 * @tag vscode-table-header
 *
 * @cssprop [--vscode-keybindingTable-headerBackground=rgba(204, 204, 204, 0.04)] - Table header background
 */
let VscodeTableHeader = class VscodeTableHeader extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'rowgroup';
    }
    render() {
        return html ` <slot></slot> `;
    }
};
VscodeTableHeader.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeTableHeader.prototype, "role", void 0);
VscodeTableHeader = __decorate([
    customElement('vscode-table-header')
], VscodeTableHeader);
export { VscodeTableHeader };
//# sourceMappingURL=vscode-table-header.js.map