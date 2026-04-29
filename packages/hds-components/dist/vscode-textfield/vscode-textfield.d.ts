import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import { AssociatedFormControl } from '../includes/AssociatedFormControl.js';
type InputType = 'color' | 'date' | 'datetime-local' | 'email' | 'file' | 'month' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'time' | 'url' | 'week';
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
export declare class VscodeTextfield extends VscElement implements AssociatedFormControl {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    static formAssociated: boolean;
    /** @internal */
    static shadowRootOptions: ShadowRootInit;
    autocomplete: 'on' | 'off' | undefined;
    autofocus: boolean;
    defaultValue: string;
    disabled: boolean;
    focused: boolean;
    /**
     * Set error styles on the component. This is only intended to apply styles when custom error
     * validation is implemented. To check whether the component is valid, use the checkValidity method.
     */
    invalid: boolean;
    /**
     * @internal
     * Set `aria-label` for the inner input element. Should not be set,
     * vscode-label will do it automatically.
     */
    label: string;
    max: number | undefined;
    maxLength: number | undefined;
    min: number | undefined;
    minLength: number | undefined;
    multiple: boolean;
    name: string | undefined;
    /**
     * Specifies a regular expression the form control's value should match.
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/pattern)
     */
    pattern: string | undefined;
    placeholder: string | undefined;
    readonly: boolean;
    required: boolean;
    step: number | undefined;
    /**
     * Same as the `type` of the native `<input>` element but only a subset of types are supported.
     * The supported ones are: `color`,`date`,`datetime-local`,`email`,`file`,`month`,`number`,`password`,`search`,`tel`,`text`,`time`,`url`,`week`
     */
    set type(val: InputType);
    get type(): InputType;
    set value(val: string);
    get value(): string;
    /**
     * Lowercase alias to minLength
     */
    set minlength(val: number);
    get minlength(): number | undefined;
    /**
     * Lowercase alias to maxLength
     */
    set maxlength(val: number);
    get maxlength(): number | undefined;
    get form(): HTMLFormElement | null;
    get validity(): ValidityState;
    get validationMessage(): string;
    get willValidate(): boolean;
    /**
     * Check the component's validity state when built-in validation is used.
     * Built-in validation is triggered when any validation-related attribute is set. Validation-related
     * attributes are: `max, maxlength, min, minlength, pattern, required, step`.
     * See this [the MDN reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checkValidity) for more details.
     * @returns {boolean}
     */
    checkValidity(): boolean;
    reportValidity(): boolean;
    get wrappedElement(): HTMLInputElement;
    constructor();
    connectedCallback(): void;
    attributeChangedCallback(name: string, old: string | null, value: string | null): void;
    /** @internal */
    formResetCallback(): void;
    /** @internal */
    formStateRestoreCallback(state: string, _mode: 'restore' | 'autocomplete'): void;
    private _inputEl;
    private _value;
    private _type;
    private _internals;
    private _dataChanged;
    private _setValidityFromInput;
    private _onInput;
    private _onChange;
    private _onFocus;
    private _onBlur;
    private _onKeyDown;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-textfield': VscodeTextfield;
    }
}
export {};
//# sourceMappingURL=vscode-textfield.d.ts.map