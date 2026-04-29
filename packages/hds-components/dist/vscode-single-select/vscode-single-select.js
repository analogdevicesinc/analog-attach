var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, LitElement } from 'lit';
import { property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement } from '../includes/VscElement.js';
import { chevronDownIcon } from '../includes/vscode-select/template-elements.js';
import { VscodeSelectBase } from '../includes/vscode-select/vscode-select-base.js';
import '../vscode-icon/index.js';
import styles from './vscode-single-select.styles.js';
/**
 * Allows to select an item from multiple options.
 *
 * When participating in a form, it supports the `:invalid` pseudo class. Otherwise the error styles
 * can be applied through the `invalid` property.
 *
 * @tag vscode-single-select
 *
 * ## Types
 *
 * ```typescript
 *interface Option {
 *  label: string;
 *  value: string;
 *  description: string;
 *  selected: boolean;
 *  disabled: boolean;
 *}
 * ```
 * @prop {boolean} invalid
 * @attr {boolean} invalid
 * @attr name - Name which is used as a variable name in the data of the form-container.
 *
 * @cssprop [--dropdown-z-index=2]
 * @cssprop [--vscode-badge-background=#616161]
 * @cssprop [--vscode-badge-foreground=#f8f8f8]
 * @cssprop [--vscode-settings-dropdownBorder=#3c3c3c]
 * @cssprop [--vscode-settings-checkboxBackground=#313131]
 * @cssprop [--vscode-settings-dropdownBackground=#313131]
 * @cssprop [--vscode-settings-dropdownForeground=#cccccc]
 * @cssprop [--vscode-settings-dropdownListBorder=#454545]
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-inputValidation-errorBackground=#5a1d1d]
 * @cssprop [--vscode-inputValidation-errorBorder=#be1100]
 * @cssprop [--vscode-list-activeSelectionBackground=#04395e]
 * @cssprop [--vscode-list-activeSelectionForeground=#ffffff]
 * @cssprop [--vscode-list-focusOutline=#0078d4]
 * @cssprop [--vscode-list-focusHighlightForeground=#2aaaff]
 * @cssprop [--vscode-list-highlightForeground=#2aaaff]
 * @cssprop [--vscode-list-hoverBackground=#2a2d2e]
 * @cssprop [--vscode-list-hoverForeground=#ffffff]
 */
let VscodeSingleSelect = class VscodeSingleSelect extends VscodeSelectBase {
    set selectedIndex(val) {
        this._opts.selectedIndex = val;
        const op = this._opts.getOptionByIndex(val);
        if (op) {
            this._opts.activeIndex = val;
            this._value = op.value;
            this._internals.setFormValue(this._value);
            this._manageRequired();
        }
        else {
            this._value = '';
            this._internals.setFormValue('');
            this._manageRequired();
        }
    }
    get selectedIndex() {
        return this._opts.selectedIndex;
    }
    set value(val) {
        this._opts.value = val;
        if (this._opts.selectedIndex > -1) {
            this._requestedValueToSetLater = '';
        }
        else {
            this._requestedValueToSetLater = val;
        }
        this._internals.setFormValue(this._value);
        this._manageRequired();
    }
    get value() {
        return this._opts.value;
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
    checkValidity() {
        return this._internals.checkValidity();
    }
    reportValidity() {
        return this._internals.reportValidity();
    }
    updateInputValue() {
        if (!this.combobox) {
            return;
        }
        const input = this.renderRoot.querySelector('.combobox-input');
        if (input) {
            const selectedOption = this._opts.getSelectedOption();
            input.value = selectedOption?.label ?? '';
        }
    }
    constructor() {
        super();
        this.defaultValue = '';
        this.name = undefined;
        this.required = false;
        /**
         * This variable was introduced for cases where the value is set before the corresponding option
         * exists. This can happen while a framework like Vue or React is rendering the component.
         */
        this._requestedValueToSetLater = '';
        this._opts.multiSelect = false;
        this._internals = this.attachInternals();
    }
    connectedCallback() {
        super.connectedCallback();
        this.updateComplete.then(() => {
            this._manageRequired();
        });
    }
    /** @internal */
    formResetCallback() {
        this.value = this.defaultValue;
    }
    /** @internal */
    formStateRestoreCallback(state, _mode) {
        this.updateComplete.then(() => {
            this.value = state;
        });
    }
    /** @internal */
    get type() {
        return 'select-one';
    }
    get form() {
        return this._internals.form;
    }
    async _createAndSelectSuggestedOption() {
        const nextIndex = this._createSuggestedOption();
        await this.updateComplete;
        this._opts.selectedIndex = nextIndex;
        this._dispatchChangeEvent();
        const opCreateEvent = new CustomEvent('vsc-single-select-create-option', { detail: { value: this._opts.getOptionByIndex(nextIndex)?.value ?? '' } });
        this.dispatchEvent(opCreateEvent);
        this.open = false;
        this._isPlaceholderOptionActive = false;
    }
    _setStateFromSlottedElements() {
        super._setStateFromSlottedElements();
        if (!this.combobox && this._opts.selectedIndexes.length === 0) {
            this._opts.selectedIndex = this._opts.options.length > 0 ? 0 : -1;
        }
    }
    //#region event handlers
    _onSlotChange() {
        super._onSlotChange();
        if (this._requestedValueToSetLater) {
            // the value is set before the available options are appended
            const foundOption = this._opts.getOptionByValue(this._requestedValueToSetLater);
            if (foundOption) {
                this._opts.selectedIndex = foundOption.index;
                this._requestedValueToSetLater = '';
            }
        }
        if (this._opts.selectedIndex > -1 && this._opts.numOptions > 0) {
            this._internals.setFormValue(this._opts.value);
            this._manageRequired();
        }
        else {
            this._internals.setFormValue(null);
            this._manageRequired();
        }
    }
    _onEnterKeyDown(ev) {
        super._onEnterKeyDown(ev);
        let valueChanged = false;
        if (this.combobox) {
            if (this.open) {
                if (this._isPlaceholderOptionActive) {
                    this._createAndSelectSuggestedOption();
                }
                else {
                    valueChanged = this._opts.activeIndex !== this._opts.selectedIndex;
                    this._opts.selectedIndex = this._opts.activeIndex;
                    this.open = false;
                }
            }
            else {
                this.open = true;
                this._scrollActiveElementToTop();
            }
        }
        else {
            if (this.open) {
                valueChanged = this._opts.activeIndex !== this._opts.selectedIndex;
                this._opts.selectedIndex = this._opts.activeIndex;
                this.open = false;
            }
            else {
                this.open = true;
                this._scrollActiveElementToTop();
            }
        }
        if (valueChanged) {
            this._dispatchChangeEvent();
            this.updateInputValue();
            this._internals.setFormValue(this._opts.value);
            this._manageRequired();
        }
    }
    _onOptionClick(ev) {
        super._onOptionClick(ev);
        const composedPath = ev.composedPath();
        const optEl = composedPath.find((et) => {
            const el = et;
            if ('matches' in el) {
                return el.matches('li.option');
            }
            return;
        });
        if (!optEl || optEl.matches('.disabled')) {
            return;
        }
        const isPlaceholderOption = optEl.classList.contains('placeholder');
        if (isPlaceholderOption) {
            if (this.creatable) {
                this._createAndSelectSuggestedOption();
            }
        }
        else {
            this._opts.selectedIndex = Number(optEl.dataset.index);
            this.open = false;
            this._internals.setFormValue(this._value);
            this._manageRequired();
            this._dispatchChangeEvent();
        }
    }
    //#endregion
    _manageRequired() {
        const { value } = this;
        if (value === '' && this.required) {
            this._internals.setValidity({ valueMissing: true }, 'Please select an item in the list.', this._face);
        }
        else {
            this._internals.setValidity({});
        }
    }
    //#region render functions
    _renderSelectFace() {
        const selectedOption = this._opts.getSelectedOption();
        const label = selectedOption?.label ?? '';
        const icon = selectedOption?.icon ?? '';
        const activeDescendant = this._opts.activeIndex > -1 ? `op-${this._opts.activeIndex}` : '';
        return html `
      <div
        aria-activedescendant=${activeDescendant}
        aria-controls="select-listbox"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-haspopup="listbox"
        aria-label=${ifDefined(this.label)}
        class="select-face face"
        @click=${this._onFaceClick}
        role="combobox"
        tabindex="0"
      >
        ${icon
            ? html `<vscode-icon
              name=${icon}
              size=${this.size === 'small' ? '12' : '16'}
            ></vscode-icon>`
            : ''}
        <span class="text">${label}</span> ${chevronDownIcon}
      </div>
    `;
    }
    _renderComboboxFace() {
        let inputVal = '';
        if (this._isBeingFiltered) {
            inputVal = this._opts.filterPattern;
        }
        else {
            const op = this._opts.getSelectedOption();
            inputVal = op?.label ?? '';
        }
        const activeDescendant = this._opts.activeIndex > -1 ? `op-${this._opts.activeIndex}` : '';
        const expanded = this.open ? 'true' : 'false';
        return html `
      <div class="combobox-face face">
        <input
          aria-activedescendant=${activeDescendant}
          aria-autocomplete="list"
          aria-controls="select-listbox"
          aria-expanded=${expanded}
          aria-haspopup="listbox"
          aria-label=${ifDefined(this.label)}
          class="combobox-input"
          role="combobox"
          spellcheck="false"
          type="text"
          autocomplete="off"
          .value=${inputVal}
          @focus=${this._onComboboxInputFocus}
          @blur=${this._onComboboxInputBlur}
          @input=${this._onComboboxInputInput}
          @click=${this._onComboboxInputClick}
          @keydown=${this._onComboboxInputSpaceKeyDown}
        >
        <button
          aria-label="Open the list of options"
          class="combobox-button"
          type="button"
          @click=${this._onComboboxButtonClick}
          @keydown=${this._onComboboxButtonKeyDown}
          tabindex="-1"
        >
          ${chevronDownIcon}
        </button>
      </div>
    `;
    }
    render() {
        return html `
      <div class="single-select">
        <slot class="main-slot" @slotchange=${this._onSlotChange}></slot>
        ${this.combobox ? this._renderComboboxFace() : this._renderSelectFace()}
        ${this._renderDropdown()}
      </div>
    `;
    }
};
VscodeSingleSelect.styles = styles;
/** @internal */
VscodeSingleSelect.shadowRootOptions = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
};
/** @internal */
VscodeSingleSelect.formAssociated = true;
__decorate([
    property({ attribute: 'default-value' })
], VscodeSingleSelect.prototype, "defaultValue", void 0);
__decorate([
    property({ reflect: true })
], VscodeSingleSelect.prototype, "name", void 0);
__decorate([
    property({ type: Number, attribute: 'selected-index' })
], VscodeSingleSelect.prototype, "selectedIndex", null);
__decorate([
    property({ type: String })
], VscodeSingleSelect.prototype, "value", null);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSingleSelect.prototype, "required", void 0);
__decorate([
    query('.face')
], VscodeSingleSelect.prototype, "_face", void 0);
VscodeSingleSelect = __decorate([
    customElement('vscode-single-select')
], VscodeSingleSelect);
export { VscodeSingleSelect };
//# sourceMappingURL=vscode-single-select.js.map