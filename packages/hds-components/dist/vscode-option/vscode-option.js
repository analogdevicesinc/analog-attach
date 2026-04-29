var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-option.styles.js';
import '../vscode-icon/index.js';
/**
 * @tag vscode-option
 */
let VscodeOption = class VscodeOption extends VscElement {
    constructor() {
        super(...arguments);
        this.description = '';
        this.icon = '';
        this.selected = false;
        this.disabled = false;
        this._initialized = false;
        this._handleSlotChange = () => {
            if (this._initialized) {
                /** @internal */
                this.dispatchEvent(new Event('vsc-option-state-change', { bubbles: true }));
            }
        };
    }
    connectedCallback() {
        super.connectedCallback();
        this.updateComplete.then(() => {
            this._initialized = true;
        });
    }
    willUpdate(changedProperties) {
        if (this._initialized &&
            (changedProperties.has('description') ||
                changedProperties.has('value') ||
                changedProperties.has('selected') ||
                changedProperties.has('disabled') ||
                changedProperties.has('icon'))) {
            /** @internal */
            this.dispatchEvent(new Event('vsc-option-state-change', { bubbles: true }));
        }
    }
    render() {
        return html `
      ${this.icon
            ? html `<vscode-icon name=${this.icon} class="icon"></vscode-icon>`
            : ''}
      <slot @slotchange=${this._handleSlotChange}></slot>
    `;
    }
};
VscodeOption.styles = styles;
__decorate([
    property({ type: String })
], VscodeOption.prototype, "value", void 0);
__decorate([
    property({ type: String })
], VscodeOption.prototype, "description", void 0);
__decorate([
    property({ type: String })
], VscodeOption.prototype, "icon", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeOption.prototype, "selected", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeOption.prototype, "disabled", void 0);
VscodeOption = __decorate([
    customElement('vscode-option')
], VscodeOption);
export { VscodeOption };
//# sourceMappingURL=vscode-option.js.map