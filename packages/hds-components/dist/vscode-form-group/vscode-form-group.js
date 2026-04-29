var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-form-group.styles.js';
/**
 * @tag vscode-form-group
 *
 * @cssprop [--label-width=150px] - The width of the label in horizontal mode
 * @cssprop [--label-right-margin=14px] - The right margin of the label in horizontal mode
 */
let VscodeFormGroup = class VscodeFormGroup extends VscElement {
    constructor() {
        super(...arguments);
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
VscodeFormGroup.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeFormGroup.prototype, "variant", void 0);
VscodeFormGroup = __decorate([
    customElement('vscode-form-group')
], VscodeFormGroup);
export { VscodeFormGroup };
//# sourceMappingURL=vscode-form-group.js.map