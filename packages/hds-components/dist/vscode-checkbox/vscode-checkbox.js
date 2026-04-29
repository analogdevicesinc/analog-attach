var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement, nothing } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { property, query } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement } from '../includes/VscElement.js';
import { FormButtonWidgetBase } from '../includes/form-button-widget/FormButtonWidgetBase.js';
import { LabelledCheckboxOrRadioMixin } from '../includes/form-button-widget/LabelledCheckboxOrRadio.js';
import styles from './vscode-checkbox.styles.js';
/**
 * Allows users to select one or more options from a set. When participating in a form, it supports
 * the `:invalid` pseudo class. Otherwise the error styles can be applied through the `invalid`
 * property.
 *
 * @tag vscode-checkbox
 *
 * @attr name - Name which is used as a variable name in the data of the form-container.
 * @attr label - Attribute pair of the `label` property.
 * @prop label - Label text. It is only applied if component's innerHTML doesn't contain any text.
 *
 * @fires {Event} change - Dispatched when checked state is changed. The event is bubbled, so it can be listened on a parent element like the `CheckboxGroup`.
 * @fires {Event} invalid - Dispatched when the element is invalid and `checkValidity()` has been called or the form containing this element is submitted.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/invalid_event)
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-settings-checkboxBackground=#313131]
 * @cssprop [--vscode-settings-checkboxBorder=#3c3c3c]
 * @cssprop [--vscode-settings-checkboxForeground=#cccccc]
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-inputValidation-errorBackground=#5a1d1d]
 * @cssprop [--vscode-inputValidation-errorBorder=#be1100]
 */
let VscodeCheckbox = class VscodeCheckbox extends LabelledCheckboxOrRadioMixin(FormButtonWidgetBase) {
    set checked(newVal) {
        this._checked = newVal;
        this._manageRequired();
        this.requestUpdate();
    }
    get checked() {
        return this._checked;
    }
    set required(newVal) {
        this._required = newVal;
        this._manageRequired();
        this.requestUpdate();
    }
    get required() {
        return this._required;
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
     * Returns `true` if the element's value is valid; otherwise, it returns `false`.
     * If the element's value is invalid, an invalid event is triggered on the element.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checkValidity)
     */
    checkValidity() {
        return this._internals.checkValidity();
    }
    /**
     * Returns `true` if the element's value is valid; otherwise, it returns `false`.
     * If the element's value is invalid, an invalid event is triggered on the element, and the
     * browser displays an error message to the user.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/reportValidity)
     */
    reportValidity() {
        return this._internals.reportValidity();
    }
    constructor() {
        super();
        /**
         * Automatically focus on the element when the page loads.
         *
         * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/autofocus)
         */
        this.autofocus = false;
        this._checked = false;
        /**
         * The element's initial checked state, which will be restored when the containing form is reset.
         */
        this.defaultChecked = false;
        this.invalid = false;
        this.name = undefined;
        /**
         * When true, renders as a toggle switch instead of a checkbox.
         */
        this.toggle = false;
        /**
         * Associate a value to the checkbox. According to the native checkbox [specification](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#value_2), If the component participates in a form:
         *
         * - If it is unchecked, the value will not be submitted.
         * - If it is checked but the value is not set, `on` will be submitted.
         * - If it is checked and value is set, the value will be submitted.
         */
        this.value = '';
        this.disabled = false;
        this.indeterminate = false;
        this._required = false;
        /** @internal */
        this.type = 'checkbox';
        this._handleClick = (ev) => {
            ev.preventDefault();
            if (this.disabled) {
                return;
            }
            this._toggleState();
        };
        this._handleKeyDown = (ev) => {
            if (!this.disabled && (ev.key === 'Enter' || ev.key === ' ')) {
                ev.preventDefault();
                if (ev.key === ' ') {
                    this._toggleState();
                }
                if (ev.key === 'Enter') {
                    this._internals.form?.requestSubmit();
                }
            }
        };
        this._internals = this.attachInternals();
    }
    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('keydown', this._handleKeyDown);
        this.updateComplete.then(() => {
            this._manageRequired();
            this._setActualFormValue();
        });
    }
    disconnectedCallback() {
        this.removeEventListener('keydown', this._handleKeyDown);
    }
    /** @internal */
    formResetCallback() {
        this.checked = this.defaultChecked;
    }
    /** @internal */
    formStateRestoreCallback(state, _mode) {
        if (state) {
            this.checked = true;
        }
    }
    // Sets the value of the control according to the native checkbox behavior.
    // - If the checkbox is unchecked, the value will be null, so the control will
    //   excluded from the form.
    // - If the control is checked but the value is not set, the value will be "on".
    // - If the control is checked and value is set, the value won't be changed.
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
    _toggleState() {
        this.checked = !this.checked;
        this.indeterminate = false;
        this._setActualFormValue();
        this._manageRequired();
        this.dispatchEvent(new Event('change', { bubbles: true }));
    }
    _manageRequired() {
        if (!this.checked && this.required) {
            this._internals.setValidity({
                valueMissing: true,
            }, 'Please check this box if you want to proceed.', this._inputEl ?? undefined);
        }
        else {
            this._internals.setValidity({});
        }
    }
    render() {
        const iconClasses = classMap({
            icon: true,
            checked: this.checked,
            indeterminate: this.indeterminate,
        });
        const labelInnerClasses = classMap({
            'label-inner': true,
        });
        const icon = html `<svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      class="check-icon"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"
      />
    </svg>`;
        const check = this.checked && !this.indeterminate ? icon : nothing;
        const indeterminate = this.indeterminate
            ? html `<span class="indeterminate-icon"></span>`
            : nothing;
        const iconContent = this.toggle
            ? html `<span class="thumb"></span>`
            : html `${indeterminate}${check}`;
        return html `
      <div class="wrapper">
        <input
          ?autofocus=${this.autofocus}
          id="input"
          class="checkbox"
          type="checkbox"
          ?checked=${this.checked}
          role=${ifDefined(this.toggle ? 'switch' : undefined)}
          aria-checked=${ifDefined(this.toggle ? (this.checked ? 'true' : 'false') : undefined)}
          value=${this.value}
        >
        <div class=${iconClasses}>${iconContent}</div>
        <label for="input" class="label" @click=${this._handleClick}>
          <span class=${labelInnerClasses}>
            ${this._renderLabelAttribute()}
            <slot @slotchange=${this._handleSlotChange}></slot>
          </span>
          ${this.description
            ? html `<span class="desc-inner">${this._renderDescription()}</span>`
            : nothing}
        </label>
      </div>
    `;
    }
};
VscodeCheckbox.styles = styles;
/** @internal */
VscodeCheckbox.formAssociated = true;
/** @internal */
VscodeCheckbox.shadowRootOptions = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
};
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "autofocus", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "checked", null);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'default-checked' })
], VscodeCheckbox.prototype, "defaultChecked", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "invalid", void 0);
__decorate([
    property({ reflect: true })
], VscodeCheckbox.prototype, "name", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "toggle", void 0);
__decorate([
    property()
], VscodeCheckbox.prototype, "value", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "indeterminate", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCheckbox.prototype, "required", null);
__decorate([
    property()
], VscodeCheckbox.prototype, "type", void 0);
__decorate([
    query('#input')
], VscodeCheckbox.prototype, "_inputEl", void 0);
VscodeCheckbox = __decorate([
    customElement('vscode-checkbox')
], VscodeCheckbox);
export { VscodeCheckbox };
//# sourceMappingURL=vscode-checkbox.js.map