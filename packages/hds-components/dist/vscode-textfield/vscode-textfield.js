var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-textfield.styles.js';
/**
 * A simple inline textfield
 *
 * When participating in a form, it supports the `:invalid` pseudo class. Otherwise the error styles
 * can be applied through the `invalid` property.
 *
 * @tag vscode-textfield
 *
 * @slot content-before - A slot before the editable area but inside of the component. It is used to place icons.
 * @slot content-after - A slot after the editable area but inside of the component. It is used to place icons.
 *
 * @fires {InputEvent} input
 * @fires {Event} change
 *
 * @cssprop [--vscode-settings-textInputBackground=#313131]
 * @cssprop [--vscode-settings-textInputBorder=var(--vscode-settings-textInputBackground, #3c3c3c)]
 * @cssprop [--vscode-settings-textInputForeground=#cccccc]
 * @cssprop [--vscode-settings-textInputBackground=#313131]
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-font-family=sans-serif] - A sans-serif font type depends on the host OS.
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-inputValidation-errorBorder=#be1100]
 * @cssprop [--vscode-inputValidation-errorBackground=#5a1d1d]
 * @cssprop [--vscode-input-placeholderForeground=#989898]
 * @cssprop [--vscode-button-background=#0078d4]
 * @cssprop [--vscode-button-foreground=#ffffff]
 * @cssprop [--vscode-button-hoverBackground=#026ec1]
 */
let VscodeTextfield = class VscodeTextfield extends VscElement {
    /**
     * Same as the `type` of the native `<input>` element but only a subset of types are supported.
     * The supported ones are: `color`,`date`,`datetime-local`,`email`,`file`,`month`,`number`,`password`,`search`,`tel`,`text`,`time`,`url`,`week`
     */
    set type(val) {
        const validTypes = [
            'color',
            'date',
            'datetime-local',
            'email',
            'file',
            'month',
            'number',
            'password',
            'search',
            'tel',
            'text',
            'time',
            'url',
            'week',
        ];
        this._type = (validTypes.includes(val) ? val : 'text');
    }
    get type() {
        return this._type;
    }
    set value(val) {
        if (this.type !== 'file') {
            this._value = val;
            this._internals.setFormValue(val);
        }
        this.updateComplete.then(() => {
            this._setValidityFromInput();
        });
    }
    get value() {
        return this._value;
    }
    /**
     * Lowercase alias to minLength
     */
    set minlength(val) {
        this.minLength = val;
    }
    get minlength() {
        return this.minLength;
    }
    /**
     * Lowercase alias to maxLength
     */
    set maxlength(val) {
        this.maxLength = val;
    }
    get maxlength() {
        return this.maxLength;
    }
    get form() {
        return this._internals.form;
    }
    get validity() {
        return this._internals.validity;
    }
    get validationMessage() {
        return this._internals.validationMessage;
    }
    get willValidate() {
        return this._internals.willValidate;
    }
    /**
     * Check the component's validity state when built-in validation is used.
     * Built-in validation is triggered when any validation-related attribute is set. Validation-related
     * attributes are: `max, maxlength, min, minlength, pattern, required, step`.
     * See this [the MDN reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checkValidity) for more details.
     * @returns {boolean}
     */
    checkValidity() {
        this._setValidityFromInput();
        return this._internals.checkValidity();
    }
    reportValidity() {
        this._setValidityFromInput();
        return this._internals.reportValidity();
    }
    get wrappedElement() {
        return this._inputEl;
    }
    constructor() {
        super();
        this.autocomplete = undefined;
        this.autofocus = false;
        this.defaultValue = '';
        this.disabled = false;
        this.focused = false;
        /**
         * Set error styles on the component. This is only intended to apply styles when custom error
         * validation is implemented. To check whether the component is valid, use the checkValidity method.
         */
        this.invalid = false;
        /**
         * @internal
         * Set `aria-label` for the inner input element. Should not be set,
         * vscode-label will do it automatically.
         */
        this.label = '';
        this.max = undefined;
        this.maxLength = undefined;
        this.min = undefined;
        this.minLength = undefined;
        this.multiple = false;
        this.name = undefined;
        /**
         * Specifies a regular expression the form control's value should match.
         * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/pattern)
         */
        this.pattern = undefined;
        this.placeholder = undefined;
        this.readonly = false;
        this.required = false;
        this.step = undefined;
        this._value = '';
        this._type = 'text';
        this._internals = this.attachInternals();
    }
    connectedCallback() {
        super.connectedCallback();
        this.updateComplete.then(() => {
            this._inputEl.checkValidity();
            this._setValidityFromInput();
            this._internals.setFormValue(this._inputEl.value);
        });
    }
    attributeChangedCallback(name, old, value) {
        super.attributeChangedCallback(name, old, value);
        const validationRelatedAttributes = [
            'max',
            'maxlength',
            'min',
            'minlength',
            'pattern',
            'required',
            'step',
        ];
        if (validationRelatedAttributes.includes(name)) {
            this.updateComplete.then(() => {
                this._setValidityFromInput();
            });
        }
    }
    /** @internal */
    formResetCallback() {
        this.value = this.defaultValue;
        this.requestUpdate();
    }
    /** @internal */
    formStateRestoreCallback(state, _mode) {
        this.value = state;
    }
    _dataChanged() {
        this._value = this._inputEl.value;
        if (this.type === 'file' && this._inputEl.files) {
            for (const f of this._inputEl.files) {
                this._internals.setFormValue(f);
            }
        }
        else {
            this._internals.setFormValue(this._inputEl.value);
        }
    }
    _setValidityFromInput() {
        if (this._inputEl) {
            this._internals.setValidity(this._inputEl.validity, this._inputEl.validationMessage, this._inputEl);
        }
    }
    _onInput() {
        this._dataChanged();
        this._setValidityFromInput();
        // native input event dispatched automatically
    }
    _onChange() {
        this._dataChanged();
        this._setValidityFromInput();
        this.dispatchEvent(new Event('change'));
    }
    _onFocus() {
        this.focused = true;
    }
    _onBlur() {
        this.focused = false;
    }
    _onKeyDown(ev) {
        if (ev.key === 'Enter' && this._internals.form) {
            this._internals.form?.requestSubmit();
        }
    }
    render() {
        return html `
      <div class="root">
        <slot name="content-before"></slot>
        <input
          id="input"
          type=${this.type}
          ?autofocus=${this.autofocus}
          autocomplete=${ifDefined(this.autocomplete)}
          aria-label=${this.label}
          ?disabled=${this.disabled}
          max=${ifDefined(this.max)}
          maxlength=${ifDefined(this.maxLength)}
          min=${ifDefined(this.min)}
          minlength=${ifDefined(this.minLength)}
          ?multiple=${this.multiple}
          name=${ifDefined(this.name)}
          pattern=${ifDefined(this.pattern)}
          placeholder=${ifDefined(this.placeholder)}
          ?readonly=${this.readonly}
          ?required=${this.required}
          step=${ifDefined(this.step)}
          .value=${this._value}
          @blur=${this._onBlur}
          @change=${this._onChange}
          @focus=${this._onFocus}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
        >
        <slot name="content-after"></slot>
      </div>
    `;
    }
};
VscodeTextfield.styles = styles;
/** @internal */
VscodeTextfield.formAssociated = true;
/** @internal */
VscodeTextfield.shadowRootOptions = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
};
__decorate([
    property()
], VscodeTextfield.prototype, "autocomplete", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "autofocus", void 0);
__decorate([
    property({ attribute: 'default-value' })
], VscodeTextfield.prototype, "defaultValue", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "focused", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "invalid", void 0);
__decorate([
    property({ attribute: false })
], VscodeTextfield.prototype, "label", void 0);
__decorate([
    property({ type: Number })
], VscodeTextfield.prototype, "max", void 0);
__decorate([
    property({ type: Number })
], VscodeTextfield.prototype, "maxLength", void 0);
__decorate([
    property({ type: Number })
], VscodeTextfield.prototype, "min", void 0);
__decorate([
    property({ type: Number })
], VscodeTextfield.prototype, "minLength", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "multiple", void 0);
__decorate([
    property({ reflect: true })
], VscodeTextfield.prototype, "name", void 0);
__decorate([
    property()
], VscodeTextfield.prototype, "pattern", void 0);
__decorate([
    property()
], VscodeTextfield.prototype, "placeholder", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "readonly", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextfield.prototype, "required", void 0);
__decorate([
    property({ type: Number })
], VscodeTextfield.prototype, "step", void 0);
__decorate([
    property({ reflect: true })
], VscodeTextfield.prototype, "type", null);
__decorate([
    property()
], VscodeTextfield.prototype, "value", null);
__decorate([
    query('#input')
], VscodeTextfield.prototype, "_inputEl", void 0);
__decorate([
    state()
], VscodeTextfield.prototype, "_value", void 0);
__decorate([
    state()
], VscodeTextfield.prototype, "_type", void 0);
VscodeTextfield = __decorate([
    customElement('vscode-textfield')
], VscodeTextfield);
export { VscodeTextfield };
//# sourceMappingURL=vscode-textfield.js.map