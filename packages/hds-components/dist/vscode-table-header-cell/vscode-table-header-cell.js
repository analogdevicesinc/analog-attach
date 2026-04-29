var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-table-header-cell.styles.js';
/**
 * @tag vscode-table-header-cell
 *
 * @fires {CustomEvent<sortDirection>} vsc-table-header-cell-sort - Emitted when the header cell sort icon is clicked.
 *
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 */
let VscodeTableHeaderCell = class VscodeTableHeaderCell extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'columnheader';
        this.alignment = 'left';
        this.sortable = false;
        this.sortDirection = 'none';
    }
    _handleSort() {
        this.sortDirection =
            this.sortDirection === 'none'
                ? 'desc'
                : this.sortDirection === 'desc'
                    ? 'asc'
                    : 'none';
        this.dispatchEvent(new CustomEvent('vsc-table-header-cell-sort', {
            detail: this.sortDirection,
        }));
        this.requestUpdate();
    }
    render() {
        return html `
      <div class="wrapper ${this.sortable ? 'sortable' : ''}">
        <slot></slot>
        ${this.sortable ? this.renderSortButton() : ''}
      </div>
    `;
    }
    renderSortButton() {
        return html `<vscode-icon
      class="sort-icon"
      @click=${this._handleSort}
      name=${this.sortDirection === 'none'
            ? 'chevron-down'
            : this.sortDirection === 'asc'
                ? 'triangle-up'
                : 'triangle-down'}
    ></vscode-icon>`;
    }
};
VscodeTableHeaderCell.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeTableHeaderCell.prototype, "role", void 0);
__decorate([
    property({ reflect: true })
], VscodeTableHeaderCell.prototype, "alignment", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTableHeaderCell.prototype, "sortable", void 0);
__decorate([
    property({ type: String, reflect: true })
], VscodeTableHeaderCell.prototype, "sortDirection", void 0);
VscodeTableHeaderCell = __decorate([
    customElement('vscode-table-header-cell')
], VscodeTableHeaderCell);
export { VscodeTableHeaderCell };
//# sourceMappingURL=vscode-table-header-cell.js.map