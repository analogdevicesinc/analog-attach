var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-table-cell.styles.js';
/**
 * @tag vscode-table-cell
 *
 * @cssprop [--vscode-editorGroup-border=rgba(255, 255, 255, 0.09)]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 */
let VscodeTableCell = class VscodeTableCell extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'cell';
        /**
         * Cell label in the compact view of the responsive mode. For internal use only.
         */
        this.columnLabel = '';
        this.alignment = 'left';
        /**
         * Enable compact view in the responsive mode. For internal use only.
         */
        this.compact = false;
    }
    render() {
        const columnLabelElement = this.columnLabel
            ? html `<div class="column-label" role="presentation">
          ${this.columnLabel}
        </div>`
            : nothing;
        return html `
      <div class="wrapper">
        ${columnLabelElement}
        <slot></slot>
      </div>
    `;
    }
};
VscodeTableCell.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeTableCell.prototype, "role", void 0);
__decorate([
    property({ attribute: 'column-label' })
], VscodeTableCell.prototype, "columnLabel", void 0);
__decorate([
    property({ reflect: true })
], VscodeTableCell.prototype, "alignment", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTableCell.prototype, "compact", void 0);
VscodeTableCell = __decorate([
    customElement('vscode-table-cell')
], VscodeTableCell);
export { VscodeTableCell };
//# sourceMappingURL=vscode-table-cell.js.map