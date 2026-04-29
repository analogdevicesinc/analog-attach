import { TemplateResult } from 'lit';
import { FormButtonWidgetBase } from '../includes/form-button-widget/FormButtonWidgetBase.js';
import { AssociatedFormControl } from '../includes/AssociatedFormControl.js';
declare const VscodeCheckbox_base: (new (...args: any[]) => import("../includes/form-button-widget/LabelledCheckboxOrRadio.js").LabelledCheckboxOrRadioInterface) & typeof FormButtonWidgetBase;
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
export declare class VscodeCheckbox extends VscodeCheckbox_base implements AssociatedFormControl {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    static formAssociated: boolean;
    /** @internal */
    static shadowRootOptions: ShadowRootInit;
    /**
     * Automatically focus on the element when the page loads.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/autofocus)
     */
    autofocus: boolean;
    set checked(newVal: boolean);
    get checked(): boolean;
    private _checked;
    /**
     * The element's initial checked state, which will be restored when the containing form is reset.
     */
    defaultChecked: boolean;
    invalid: boolean;
    name: string | undefined;
    /**
     * When true, renders as a toggle switch instead of a checkbox.
     */
    toggle: boolean;
    /**
     * Associate a value to the checkbox. According to the native checkbox [specification](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#value_2), If the component participates in a form:
     *
     * - If it is unchecked, the value will not be submitted.
     * - If it is checked but the value is not set, `on` will be submitted.
     * - If it is checked and value is set, the value will be submitted.
     */
    value: string;
    disabled: boolean;
    indeterminate: boolean;
    set required(newVal: boolean);
    get required(): boolean;
    private _required;
    get form(): HTMLFormElement | null;
    /** @internal */
    type: string;
    get validity(): ValidityState;
    get validationMessage(): string;
    get willValidate(): boolean;
    /**
     * Returns `true` if the element's value is valid; otherwise, it returns `false`.
     * If the element's value is invalid, an invalid event is triggered on the element.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/checkValidity)
     */
    checkValidity(): boolean;
    /**
     * Returns `true` if the element's value is valid; otherwise, it returns `false`.
     * If the element's value is invalid, an invalid event is triggered on the element, and the
     * browser displays an error message to the user.
     *
     * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/reportValidity)
     */
    reportValidity(): boolean;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    /** @internal */
    formResetCallback(): void;
    /** @internal */
    formStateRestoreCallback(state: string, _mode: 'restore' | 'autocomplete'): void;
    private _inputEl;
    private _internals;
    private _setActualFormValue;
    private _toggleState;
    private _handleClick;
    private _handleKeyDown;
    private _manageRequired;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-checkbox': VscodeCheckbox;
    }
}
export {};
//# sourceMappingURL=vscode-checkbox.d.ts.map