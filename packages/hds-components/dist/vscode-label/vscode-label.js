var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import uniqueId from '../includes/uniqueId.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-label.styles.js';
/**
 * @tag vscode-label
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-foreground=#cccccc]
 */
let VscodeLabel = class VscodeLabel extends VscElement {
    constructor() {
        super(...arguments);
        this.required = false;
        this._id = '';
        this._htmlFor = '';
        this._connected = false;
    }
    set htmlFor(val) {
        this._htmlFor = val;
        this.setAttribute('for', val);
        if (this._connected) {
            this._connectWithTarget();
        }
    }
    get htmlFor() {
        return this._htmlFor;
    }
    set id(val) {
        this._id = val;
    }
    get id() {
        return this._id;
    }
    attributeChangedCallback(name, old, value) {
        super.attributeChangedCallback(name, old, value);
    }
    connectedCallback() {
        super.connectedCallback();
        this._connected = true;
        if (this._id === '') {
            this._id = uniqueId('vscode-label-');
            this.setAttribute('id', this._id);
        }
        this._connectWithTarget();
    }
    _getTarget() {
        let target = null;
        if (this._htmlFor) {
            const root = this.getRootNode({ composed: false });
            if (root) {
                target = root.querySelector(`#${this._htmlFor}`);
            }
        }
        return target;
    }
    async _connectWithTarget() {
        await this.updateComplete;
        const target = this._getTarget();
        if (['vscode-radio-group', 'vscode-checkbox-group'].includes(target?.tagName.toLowerCase() ?? '')) {
            target.setAttribute('aria-labelledby', this._id);
        }
        let label = '';
        if (this.textContent) {
            label = this.textContent.trim();
        }
        if (target &&
            'label' in target &&
            [
                'vscode-textfield',
                'vscode-textarea',
                'vscode-single-select',
                'vscode-multi-select',
            ].includes(target?.tagName.toLowerCase() ?? '')) {
            target.label = label;
        }
    }
    _handleClick() {
        const target = this._getTarget();
        if (target && 'focus' in target) {
            target.focus();
        }
    }
    render() {
        return html `
      <label
        class=${classMap({ wrapper: true, required: this.required })}
        @click=${this._handleClick}
        ><slot></slot
      ></label>
    `;
    }
};
VscodeLabel.styles = styles;
__decorate([
    property({ reflect: true, attribute: 'for' })
], VscodeLabel.prototype, "htmlFor", null);
__decorate([
    property()
], VscodeLabel.prototype, "id", null);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeLabel.prototype, "required", void 0);
VscodeLabel = __decorate([
    customElement('vscode-label')
], VscodeLabel);
export { VscodeLabel };
//# sourceMappingURL=vscode-label.js.map