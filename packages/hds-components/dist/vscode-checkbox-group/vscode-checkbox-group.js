var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-checkbox-group.styles.js';
/**
 * Arranges a group of checkboxes horizontally or vertically.
 *
 * @tag vscode-checkbox-group
 */
let VscodeCheckboxGroup = class VscodeCheckboxGroup extends VscElement {
    constructor() {
        super(...arguments);
        /** @internal */
        this.role = 'group';
        this.variant = 'horizontal';
    }
    render() {
        return html `
      <div class="wrapper">
        <slot></slot>
      </div>
    `;
    }
};
VscodeCheckboxGroup.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeCheckboxGroup.prototype, "role", void 0);
__decorate([
    property({ reflect: true })
], VscodeCheckboxGroup.prototype, "variant", void 0);
VscodeCheckboxGroup = __decorate([
    customElement('vscode-checkbox-group')
], VscodeCheckboxGroup);
export { VscodeCheckboxGroup };
//# sourceMappingURL=vscode-checkbox-group.js.map