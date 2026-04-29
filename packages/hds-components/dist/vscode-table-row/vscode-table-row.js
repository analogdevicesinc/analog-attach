var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-table-row.styles.js';
/**
 * @tag vscode-table-row
 *
 * @cssprop [--vscode-editorGroup-border=rgba(255, 255, 255, 0.09)]
 */
let VscodeTableRow = class VscodeTableRow extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'row';
    }
    render() {
        return html ` <slot></slot> `;
    }
};
VscodeTableRow.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeTableRow.prototype, "role", void 0);
VscodeTableRow = __decorate([
    customElement('vscode-table-row')
], VscodeTableRow);
export { VscodeTableRow };
//# sourceMappingURL=vscode-table-row.js.map