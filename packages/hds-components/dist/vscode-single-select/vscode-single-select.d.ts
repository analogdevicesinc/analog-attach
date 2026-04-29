import { TemplateResult } from 'lit';
import { VscodeSelectBase } from '../includes/vscode-select/vscode-select-base.js';
import { AssociatedFormControl } from '../includes/AssociatedFormControl.js';
import '../vscode-icon/index.js';
export type VscSingleSelectCreateOptionEvent = CustomEvent<{
    value: string;
}>;
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
export declare class VscodeSingleSelect extends VscodeSelectBase implements AssociatedFormControl {
    static styles: (import("lit").CSSResult | import("lit").CSSResult[])[];
    /** @internal */
    static shadowRootOptions: ShadowRootInit;
    /** @internal */
    static formAssociated: boolean;
    defaultValue: string;
    name: string | undefined;
    set selectedIndex(val: number);
    get selectedIndex(): number;
    set value(val: string);
    get value(): string;
    required: boolean;
    get validity(): ValidityState;
    get validationMessage(): string;
    get willValidate(): boolean;
    checkValidity(): boolean;
    reportValidity(): boolean;
    private _face;
    private _internals;
    private updateInputValue;
    constructor();
    connectedCallback(): void;
    /** @internal */
    formResetCallback(): void;
    /** @internal */
    formStateRestoreCallback(state: string, _mode: 'restore' | 'autocomplete'): void;
    /** @internal */
    get type(): 'select-one';
    get form(): HTMLFormElement | null;
    /**
     * This variable was introduced for cases where the value is set before the corresponding option
     * exists. This can happen while a framework like Vue or React is rendering the component.
     */
    private _requestedValueToSetLater;
    protected _createAndSelectSuggestedOption(): Promise<void>;
    protected _setStateFromSlottedElements(): void;
    protected _onSlotChange(): void;
    protected _onEnterKeyDown(ev: KeyboardEvent): void;
    protected _onOptionClick(ev: MouseEvent): void;
    protected _manageRequired(): void;
    protected _renderSelectFace(): TemplateResult;
    protected _renderComboboxFace(): TemplateResult;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-single-select': VscodeSingleSelect;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-single-select-create-option': VscSingleSelectCreateOptionEvent;
    }
}
//# sourceMappingURL=vscode-single-select.d.ts.map