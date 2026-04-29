var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { property } from 'lit/decorators.js';
import { VscElement } from '../VscElement.js';
export class FormButtonWidgetBase extends VscElement {
    constructor() {
        super();
        this.focused = false;
        this._prevTabindex = 0;
        this._handleFocus = () => {
            this.focused = true;
        };
        this._handleBlur = () => {
            this.focused = false;
        };
    }
    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('focus', this._handleFocus);
        this.addEventListener('blur', this._handleBlur);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('focus', this._handleFocus);
        this.removeEventListener('blur', this._handleBlur);
    }
    attributeChangedCallback(name, oldVal, newVal) {
        super.attributeChangedCallback(name, oldVal, newVal);
        if (name === 'disabled' && this.hasAttribute('disabled')) {
            this._prevTabindex = this.tabIndex;
            this.tabIndex = -1;
        }
        else if (name === 'disabled' && !this.hasAttribute('disabled')) {
            this.tabIndex = this._prevTabindex;
        }
    }
}
__decorate([
    property({ type: Boolean, reflect: true })
], FormButtonWidgetBase.prototype, "focused", void 0);
//# sourceMappingURL=FormButtonWidgetBase.js.map