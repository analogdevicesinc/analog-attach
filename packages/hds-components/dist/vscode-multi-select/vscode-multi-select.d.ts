import { TemplateResult } from 'lit';
import { VscodeSelectBase } from '../includes/vscode-select/vscode-select-base.js';
import { AssociatedFormControl } from '../includes/AssociatedFormControl.js';
import '../vscode-icon/index.js';
export type VscMultiSelectCreateOptionEvent = CustomEvent<{
    value: string;
}>;
/**
 * Allows to select multiple items from a list of options.
 *
 * When participating in a form, it supports the `:invalid` pseudo class. Otherwise the error styles
 * can be applied through the `invalid` property.
 *
 * @tag vscode-multi-select
 *
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
export declare class VscodeMultiSelect extends VscodeSelectBase implements AssociatedFormControl {
    static styles: (import("lit").CSSResult | import("lit").CSSResult[])[];
    /** @internal */
    static shadowRootOptions: ShadowRootInit;
    static formAssociated: boolean;
    defaultValue: string[];
    required: boolean;
    name: string | undefined;
    set selectedIndexes(val: number[]);
    get selectedIndexes(): number[];
    set value(val: string[]);
    get value(): string[];
    get form(): HTMLFormElement | null;
    /** @internal */
    get type(): string;
    get validity(): ValidityState;
    get validationMessage(): string;
    get willValidate(): boolean;
    checkValidity(): boolean;
    reportValidity(): boolean;
    selectAll(): void;
    selectNone(): void;
    private _internals;
    constructor();
    connectedCallback(): void;
    /** @internal */
    formResetCallback(): void;
    /** @internal */
    formStateRestoreCallback(state: FormData, _mode: 'restore' | 'autocomplete'): void;
    private _faceElement;
    private _setDefaultValue;
    protected _dispatchChangeEvent(): void;
    protected _onFaceClick(): void;
    protected _toggleComboboxDropdown(): void;
    protected _manageRequired(): void;
    private _setFormValue;
    private _requestedValueToSetLater;
    protected _createAndSelectSuggestedOption(): Promise<void>;
    protected _onSlotChange(): void;
    protected _onOptionClick: (ev: MouseEvent) => void;
    protected _onEnterKeyDown(ev: KeyboardEvent): void;
    private _onMultiAcceptClick;
    private _onMultiDeselectAllClick;
    private _onMultiSelectAllClick;
    protected _onComboboxInputBlur(): void;
    private _renderLabel;
    protected _renderComboboxFace(): TemplateResult;
    protected _renderSelectFace(): TemplateResult;
    protected _renderDropdownControls(): TemplateResult;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-multi-select': VscodeMultiSelect;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-multi-select-create-option': VscMultiSelectCreateOptionEvent;
    }
}
//# sourceMappingURL=vscode-multi-select.d.ts.map