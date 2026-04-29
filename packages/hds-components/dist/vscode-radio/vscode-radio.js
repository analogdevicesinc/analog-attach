var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from 'lit';
import { property, state, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement } from '../includes/VscElement.js';
import { FormButtonWidgetBase } from '../includes/form-button-widget/FormButtonWidgetBase.js';
import { LabelledCheckboxOrRadioMixin } from '../includes/form-button-widget/LabelledCheckboxOrRadio.js';
import styles from './vscode-radio.styles.js';
/**
 * When participating in a form, it supports the `:invalid` pseudo class. Otherwise the error styles
 * can be applied through the `invalid` property.
 *
 * @tag vscode-radio
 *
 * @attr name - Name which is used as a variable name in the data of the form-container.
 * @attr label - Attribute pair of the `label` property.
 *
 * @prop label - Label text. It is only applied if component's innerHTML doesn't contain any text.
 *
 * @fires {Event} change - Dispatched when checked state is changed.
 * @fires {Event} invalid - Dispatched when the element is invalid and `checkValidity()` has been called or the form containing this element is submitted.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/invalid_event)
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-settings-checkboxBackground=#313131]
 * @cssprop [--vscode-settings-checkboxBorder=#3c3c3c]
 * @cssprop [--vscode-settings-checkboxForeground=#cccccc]
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-inputValidation-errorBackground=#5a1d1d]
 * @cssprop [--vscode-inputValidation-errorBorder=#be1100]
 */
let VscodeRadio = class VscodeRadio extends LabelledCheckboxOrRadioMixin(FormButtonWidgetBase) {
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
    //#endregion
    //#region lifecycle methods
    constructor() {
        super();
        //#region properties
        this.autofocus = false;
        this.checked = false;
        this.defaultChecked = false;
        this.invalid = false;
        /**
         * Name which is used as a variable name in the data of the form-container.
         */
        this.name = '';
        /** @internal */
        this.type = 'radio';
        this.value = '';
        this.disabled = false;
        this.required = false;
        /** @internal */
        this.tabIndex = 0;
        //#endregion
        //#region private variables
        this._slottedText = '';
        this._handleClick = () => {
            if (this.disabled) {
                return;
            }
            if (!this.checked) {
                this._checkButton();
                this._handleValueChange();
                this.dispatchEvent(new Event('change', { bubbles: true }));
            }
        };
        this._handleKeyDown = (ev) => {
            if (!this.disabled && (ev.key === 'Enter' || ev.key === ' ')) {
                ev.preventDefault();
                if (ev.key === ' ' && !this.checked) {
                    this.checked = true;
                    this._handleValueChange();
                    this.dispatchEvent(new Event('change', { bubbles: true }));
                }
                if (ev.key === 'Enter') {
                    this._internals.form?.requestSubmit();
                }
            }
        };
        this._internals = this.attachInternals();
        this.addEventListener('keydown', this._handleKeyDown);
        this.addEventListener('click', this._handleClick);
    }
    connectedCallback() {
        super.connectedCallback();
        this._handleValueChange();
    }
    update(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    changedProperties) {
        super.update(changedProperties);
        if (changedProperties.has('checked')) {
            this._handleValueChange();
        }
        if (changedProperties.has('required')) {
            this._handleValueChange();
        }
    }
    //#endregion
    //#region public methods
    checkValidity() {
        return this._internals.checkValidity();
    }
    reportValidity() {
        return this._internals.reportValidity();
    }
    /** @internal */
    formResetCallback() {
        const radios = this._getRadios();
        radios.forEach((r) => {
            r.checked = r.defaultChecked;
        });
        this.updateComplete.then(() => {
            this._handleValueChange();
        });
    }
    /** @internal */
    formStateRestoreCallback(state, _mode) {
        if (this.value === state && state !== '') {
            this.checked = true;
        }
    }
    /**
     * @internal
     */
    setComponentValidity(isValid) {
        if (isValid) {
            this._internals.setValidity({});
        }
        else {
            this._internals.setValidity({
                valueMissing: true,
            }, 'Please select one of these options.', this._inputEl);
        }
    }
    //#endregion
    //#region private methods
    _getRadios() {
        const root = this.getRootNode({ composed: false });
        if (!root) {
            return [];
        }
        const radios = root.querySelectorAll(`vscode-radio[name="${this.name}"]`);
        return Array.from(radios);
    }
    _uncheckOthers(radios) {
        radios.forEach((r) => {
            if (r !== this) {
                r.checked = false;
            }
        });
    }
    _checkButton() {
        const radios = this._getRadios();
        this.checked = true;
        radios.forEach((r) => {
            if (r !== this) {
                r.checked = false;
            }
        });
    }
    _setGroupValidity(radios, isValid) {
        this.updateComplete.then(() => {
            radios.forEach((r) => {
                r.setComponentValidity(isValid);
            });
        });
    }
    _setActualFormValue() {
        let actualValue = '';
        if (this.checked) {
            actualValue = !this.value ? 'on' : this.value;
        }
        else {
            actualValue = null;
        }
        this._internals.setFormValue(actualValue);
    }
    //#endregion
    //#region  event handlers
    _handleValueChange() {
        const radios = this._getRadios();
        const anyRequired = radios.some((r) => {
            return r.required;
        });
        this._setActualFormValue();
        if (this.checked) {
            this._uncheckOthers(radios);
            this._setGroupValidity(radios, true);
        }
        else {
            const anyChecked = !!radios.find((r) => r.checked);
            const isInvalid = anyRequired && !anyChecked;
            this._setGroupValidity(radios, !isInvalid);
        }
    }
    //#endregion
    render() {
        const iconClasses = classMap({
            icon: true,
            checked: this.checked,
        });
        const labelInnerClasses = classMap({
            'label-inner': true,
            'is-slot-empty': this._slottedText === '',
        });
        return html `
      <div class="wrapper">
        <input
          ?autofocus=${this.autofocus}
          id="input"
          class="radio"
          type="checkbox"
          ?checked=${this.checked}
          value=${this.value}
          tabindex=${this.tabIndex}
        >
        <div class=${iconClasses}></div>
        <label for="input" class="label" @click=${this._handleClick}>
          <span class=${labelInnerClasses}>
            ${this._renderLabelAttribute()}
            <slot @slotchange=${this._handleSlotChange}></slot>
          </span>
        </label>
      </div>
    `;
    }
};
VscodeRadio.styles = styles;
/** @internal */
VscodeRadio.formAssociated = true;
/** @internal */
VscodeRadio.shadowRootOptions = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
};
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeRadio.prototype, "autofocus", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeRadio.prototype, "checked", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'default-checked' })
], VscodeRadio.prototype, "defaultChecked", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeRadio.prototype, "invalid", void 0);
__decorate([
    property({ reflect: true })
], VscodeRadio.prototype, "name", void 0);
__decorate([
    property()
], VscodeRadio.prototype, "type", void 0);
__decorate([
    property()
], VscodeRadio.prototype, "value", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeRadio.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeRadio.prototype, "required", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeRadio.prototype, "tabIndex", void 0);
__decorate([
    state()
], VscodeRadio.prototype, "_slottedText", void 0);
__decorate([
    query('#input')
], VscodeRadio.prototype, "_inputEl", void 0);
VscodeRadio = __decorate([
    customElement('vscode-radio')
], VscodeRadio);
export { VscodeRadio };
//# sourceMappingURL=vscode-radio.js.map