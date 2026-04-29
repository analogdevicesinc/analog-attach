var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
import styles from './vscode-textarea.styles.js';
/**
 * Multi-line text input.
 *
 * When participating in a form, it supports the `:invalid` pseudo class. Otherwise the error styles
 * can be applied through the `invalid` property.
 *
 * @tag vscode-textarea
 *
 * @fires {InputEvent} input
 * @fires {Event} change
 *
 * @cssprop [--vscode-scrollbar-shadow=#000000]
 * @cssprop [--vscode-settings-textInputBackground=#313131]
 * @cssprop [--vscode-settings-textInputBorder=transparent]
 * @cssprop [--vscode-settings-textInputForeground=#cccccc]
 * @cssprop [--vscode-input-placeholderForeground=#989898]
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-editor-background=#1f1f1f]
 * @cssprop [--vscode-editor-foreground=#cccccc]
 * @cssprop [--vscode-editor-font-family=monospace]
 * @cssprop [--vscode-editor-font-size=14px]
 * @cssprop [--vscode-editor-font-weight=normal]
 * @cssprop [--vscode-editor-inlineValuesForeground=rgba(255, 255, 255, 0.5)]
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-scrollbarSlider-background=rgba(121, 121, 121, 0.4)]
 * @cssprop [--vscode-scrollbarSlider-hoverBackground=rgba(100, 100, 100, 0.7)]
 * @cssprop [--vscode-scrollbarSlider-activeBackground=rgba(191, 191, 191, 0.4)]
 */
let VscodeTextarea = class VscodeTextarea extends VscElement {
    set value(val) {
        this._value = val;
        this._internals.setFormValue(val);
    }
    get value() {
        return this._value;
    }
    /**
     * Getter for the inner textarea element if it needs to be accessed for some reason.
     */
    get wrappedElement() {
        return this._textareaEl;
    }
    get form() {
        return this._internals.form;
    }
    /** @internal */
    get type() {
        return 'textarea';
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
    // #endregion
    constructor() {
        super();
        // #region properties, setters/getters
        this.autocomplete = undefined;
        this.autofocus = false;
        this.defaultValue = '';
        this.disabled = false;
        this.invalid = false;
        this.label = '';
        this.maxLength = undefined;
        this.minLength = undefined;
        this.rows = undefined;
        this.cols = undefined;
        this.name = undefined;
        this.placeholder = undefined;
        this.readonly = false;
        this.resize = 'none';
        this.required = false;
        this.spellcheck = false;
        /**
         * Use monospace fonts. The font family, weight, size, and color will be the same as set in the
         * VSCode code editor.
         */
        this.monospace = false;
        this._value = '';
        this._textareaPointerCursor = false;
        this._shadow = false;
        this._internals = this.attachInternals();
    }
    connectedCallback() {
        super.connectedCallback();
        this.updateComplete.then(() => {
            this._textareaEl.checkValidity();
            this._setValidityFromInput();
            this._internals.setFormValue(this._textareaEl.value);
        });
    }
    updated(changedProperties) {
        const validationRelatedProps = ['maxLength', 'minLength', 'required'];
        for (const key of changedProperties.keys()) {
            if (validationRelatedProps.includes(String(key))) {
                this.updateComplete.then(() => {
                    this._setValidityFromInput();
                });
                break;
            }
        }
    }
    /** @internal */
    formResetCallback() {
        this.value = this.defaultValue;
    }
    /** @internal */
    formStateRestoreCallback(state, _mode) {
        this.updateComplete.then(() => {
            this._value = state;
        });
    }
    checkValidity() {
        return this._internals.checkValidity();
    }
    reportValidity() {
        return this._internals.reportValidity();
    }
    _setValidityFromInput() {
        this._internals.setValidity(this._textareaEl.validity, this._textareaEl.validationMessage, this._textareaEl);
    }
    _dataChanged() {
        this._value = this._textareaEl.value;
        this._internals.setFormValue(this._textareaEl.value);
    }
    _handleChange() {
        this._dataChanged();
        this._setValidityFromInput();
        this.dispatchEvent(new Event('change'));
    }
    _handleInput() {
        this._dataChanged();
        this._setValidityFromInput();
    }
    _handleMouseMove(ev) {
        if (this._textareaEl.clientHeight >= this._textareaEl.scrollHeight) {
            this._textareaPointerCursor = false;
            return;
        }
        const SCROLLBAR_WIDTH = 14;
        const BORDER_WIDTH = 1;
        const br = this._textareaEl.getBoundingClientRect();
        const x = ev.clientX;
        this._textareaPointerCursor =
            x >= br.left + br.width - SCROLLBAR_WIDTH - BORDER_WIDTH * 2;
    }
    _handleScroll() {
        this._shadow = this._textareaEl.scrollTop > 0;
    }
    render() {
        return html `
      <div
        class=${classMap({
            shadow: true,
            visible: this._shadow,
        })}
      ></div>
      <textarea
        autocomplete=${ifDefined(this.autocomplete)}
        ?autofocus=${this.autofocus}
        ?disabled=${this.disabled}
        aria-label=${this.label}
        id="textarea"
        class=${classMap({
            monospace: this.monospace,
            'cursor-pointer': this._textareaPointerCursor,
        })}
        maxlength=${ifDefined(this.maxLength)}
        minlength=${ifDefined(this.minLength)}
        rows=${ifDefined(this.rows)}
        cols=${ifDefined(this.cols)}
        name=${ifDefined(this.name)}
        placeholder=${ifDefined(this.placeholder)}
        ?readonly=${this.readonly}
        .style=${stylePropertyMap({
            resize: this.resize,
        })}
        ?required=${this.required}
        spellcheck=${this.spellcheck}
        @change=${this._handleChange}
        @input=${this._handleInput}
        @mousemove=${this._handleMouseMove}
        @scroll=${this._handleScroll}
        .value=${this._value}
      ></textarea>
    `;
    }
};
VscodeTextarea.styles = styles;
/**
 * @internal
 */
VscodeTextarea.formAssociated = true;
/** @internal */
VscodeTextarea.shadowRootOptions = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
};
__decorate([
    property()
], VscodeTextarea.prototype, "autocomplete", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextarea.prototype, "autofocus", void 0);
__decorate([
    property({ attribute: 'default-value' })
], VscodeTextarea.prototype, "defaultValue", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextarea.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextarea.prototype, "invalid", void 0);
__decorate([
    property({ attribute: false })
], VscodeTextarea.prototype, "label", void 0);
__decorate([
    property({ type: Number })
], VscodeTextarea.prototype, "maxLength", void 0);
__decorate([
    property({ type: Number })
], VscodeTextarea.prototype, "minLength", void 0);
__decorate([
    property({ type: Number })
], VscodeTextarea.prototype, "rows", void 0);
__decorate([
    property({ type: Number })
], VscodeTextarea.prototype, "cols", void 0);
__decorate([
    property()
], VscodeTextarea.prototype, "name", void 0);
__decorate([
    property()
], VscodeTextarea.prototype, "placeholder", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextarea.prototype, "readonly", void 0);
__decorate([
    property()
], VscodeTextarea.prototype, "resize", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextarea.prototype, "required", void 0);
__decorate([
    property({ type: Boolean })
], VscodeTextarea.prototype, "spellcheck", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTextarea.prototype, "monospace", void 0);
__decorate([
    property()
], VscodeTextarea.prototype, "value", null);
__decorate([
    query('#textarea')
], VscodeTextarea.prototype, "_textareaEl", void 0);
__decorate([
    state()
], VscodeTextarea.prototype, "_value", void 0);
__decorate([
    state()
], VscodeTextarea.prototype, "_textareaPointerCursor", void 0);
__decorate([
    state()
], VscodeTextarea.prototype, "_shadow", void 0);
VscodeTextarea = __decorate([
    customElement('vscode-textarea')
], VscodeTextarea);
export { VscodeTextarea };
//# sourceMappingURL=vscode-textarea.js.map