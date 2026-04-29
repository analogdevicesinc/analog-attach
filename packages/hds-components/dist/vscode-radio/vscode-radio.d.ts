import { PropertyValueMap, TemplateResult } from 'lit';
import { FormButtonWidgetBase } from '../includes/form-button-widget/FormButtonWidgetBase.js';
import { AssociatedFormControl } from '../includes/AssociatedFormControl.js';
declare const VscodeRadio_base: (new (...args: any[]) => import("../includes/form-button-widget/LabelledCheckboxOrRadio.js").LabelledCheckboxOrRadioInterface) & typeof FormButtonWidgetBase;
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
export declare class VscodeRadio extends VscodeRadio_base implements AssociatedFormControl {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    static formAssociated: boolean;
    /** @internal */
    static shadowRootOptions: ShadowRootInit;
    autofocus: boolean;
    checked: boolean;
    defaultChecked: boolean;
    invalid: boolean;
    /**
     * Name which is used as a variable name in the data of the form-container.
     */
    name: string;
    /** @internal */
    type: string;
    value: string;
    disabled: boolean;
    required: boolean;
    /** @internal */
    tabIndex: number;
    get form(): HTMLFormElement | null;
    get validity(): ValidityState;
    get validationMessage(): string;
    get willValidate(): boolean;
    private _slottedText;
    private _inputEl;
    private _internals;
    constructor();
    connectedCallback(): void;
    update(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void;
    checkValidity(): boolean;
    reportValidity(): boolean;
    /** @internal */
    formResetCallback(): void;
    /** @internal */
    formStateRestoreCallback(state: string, _mode: 'restore' | 'autocomplete'): void;
    /**
     * @internal
     */
    setComponentValidity(isValid: boolean): void;
    private _getRadios;
    private _uncheckOthers;
    private _checkButton;
    private _setGroupValidity;
    private _setActualFormValue;
    private _handleValueChange;
    private _handleClick;
    protected _handleKeyDown: (ev: KeyboardEvent) => void;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-radio': VscodeRadio;
    }
}
export {};
//# sourceMappingURL=vscode-radio.d.ts.map