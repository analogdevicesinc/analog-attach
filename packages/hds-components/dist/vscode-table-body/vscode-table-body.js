var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-table-body.styles.js';
/**
 * @tag vscode-table-body
 */
let VscodeTableBody = class VscodeTableBody extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'rowgroup';
    }
    render() {
        return html ` <slot></slot> `;
    }
};
VscodeTableBody.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeTableBody.prototype, "role", void 0);
VscodeTableBody = __decorate([
    customElement('vscode-table-body')
], VscodeTableBody);
export { VscodeTableBody };
//# sourceMappingURL=vscode-table-body.js.map