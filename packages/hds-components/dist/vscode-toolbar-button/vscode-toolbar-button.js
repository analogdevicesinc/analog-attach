var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property, queryAssignedNodes, state } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import '../vscode-icon/vscode-icon.js';
import styles from './vscode-toolbar-button.styles.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
/**
 * Toolbar button
 *
 * @tag vscode-toolbar-button
 */
let VscodeToolbarButton = class VscodeToolbarButton extends VscElement {
    constructor() {
        super(...arguments);
        this.icon = '';
        this.label = undefined;
        this.toggleable = false;
        this.checked = false;
        this._isSlotEmpty = true;
    }
    _handleSlotChange() {
        this._isSlotEmpty = !((this._assignedNodes?.length ?? 0) > 0);
    }
    _handleButtonClick() {
        if (!this.toggleable) {
            return;
        }
        this.checked = !this.checked;
        this.dispatchEvent(new Event('change'));
    }
    render() {
        const checked = this.checked ? 'true' : 'false';
        return html `
      <button
        type="button"
        aria-label=${ifDefined(this.label)}
        role=${ifDefined(this.toggleable ? 'switch' : undefined)}
        aria-checked=${ifDefined(this.toggleable ? checked : undefined)}
        class=${classMap({ checked: this.toggleable && this.checked })}
        @click=${this._handleButtonClick}
      >
        ${this.icon
            ? html `<vscode-icon name=${this.icon}></vscode-icon>`
            : nothing}
        <slot
          @slotchange=${this._handleSlotChange}
          class=${classMap({ empty: this._isSlotEmpty, textOnly: !this.icon })}
        ></slot>
      </button>
    `;
    }
};
VscodeToolbarButton.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeToolbarButton.prototype, "icon", void 0);
__decorate([
    property()
], VscodeToolbarButton.prototype, "label", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeToolbarButton.prototype, "toggleable", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeToolbarButton.prototype, "checked", void 0);
__decorate([
    state()
], VscodeToolbarButton.prototype, "_isSlotEmpty", void 0);
__decorate([
    queryAssignedNodes()
], VscodeToolbarButton.prototype, "_assignedNodes", void 0);
VscodeToolbarButton = __decorate([
    customElement('vscode-toolbar-button')
], VscodeToolbarButton);
export { VscodeToolbarButton };
//# sourceMappingURL=vscode-toolbar-button.js.map