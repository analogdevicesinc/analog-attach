var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
export const LabelledCheckboxOrRadioMixin = (superClass) => {
    class LabelledCheckboxOrRadio extends superClass {
        constructor() {
            super(...arguments);
            this._label = '';
            this._slottedText = '';
        }
        set label(val) {
            this._label = val;
            if (this._slottedText === '') {
                this.setAttribute('aria-label', val);
            }
        }
        get label() {
            return this._label;
        }
        _handleSlotChange() {
            this._slottedText = this.textContent ? this.textContent.trim() : '';
            if (this._slottedText !== '') {
                this.setAttribute('aria-label', this._slottedText);
            }
        }
        _renderLabelAttribute() {
            return this._slottedText === ''
                ? html `<span class="label-attr">${this._label}</span>`
                : html `${nothing}`;
        }
        _renderDescription() {
            return this.description
                ? html `<span class="description">${this.description}</span>`
                : html `${nothing}`;
        }
    }
    __decorate([
        property()
    ], LabelledCheckboxOrRadio.prototype, "label", null);
    __decorate([
        property()
    ], LabelledCheckboxOrRadio.prototype, "description", void 0);
    return LabelledCheckboxOrRadio;
};
//# sourceMappingURL=LabelledCheckboxOrRadio.js.map