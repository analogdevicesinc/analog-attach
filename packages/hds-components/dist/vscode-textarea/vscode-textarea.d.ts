import { TemplateResult, PropertyValues } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import { AssociatedFormControl } from '../includes/AssociatedFormControl.js';
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
export declare class VscodeTextarea extends VscElement implements AssociatedFormControl {
    static styles: import("lit").CSSResultGroup;
    /**
     * @internal
     */
    static formAssociated: boolean;
    /** @internal */
    static shadowRootOptions: ShadowRootInit;
    autocomplete: 'on' | 'off' | undefined;
    autofocus: boolean;
    defaultValue: string;
    disabled: boolean;
    invalid: boolean;
    label: string;
    maxLength: number | undefined;
    minLength: number | undefined;
    rows: number | undefined;
    cols: number | undefined;
    name: string | undefined;
    placeholder: string | undefined;
    readonly: boolean;
    resize: 'both' | 'horizontal' | 'vertical' | 'none';
    required: boolean;
    spellcheck: boolean;
    /**
     * Use monospace fonts. The font family, weight, size, and color will be the same as set in the
     * VSCode code editor.
     */
    monospace: boolean;
    set value(val: string);
    get value(): string;
    /**
     * Getter for the inner textarea element if it needs to be accessed for some reason.
     */
    get wrappedElement(): HTMLTextAreaElement;
    get form(): HTMLFormElement | null;
    /** @internal */
    get type(): 'textarea';
    get validity(): ValidityState;
    get validationMessage(): string;
    get willValidate(): boolean;
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
    constructor();
    connectedCallback(): void;
    updated(changedProperties: PropertyValues<unknown> | Map<PropertyKey, unknown>): void;
    /** @internal */
    formResetCallback(): void;
    /** @internal */
    formStateRestoreCallback(state: string, _mode: 'restore' | 'autocomplete'): void;
    checkValidity(): boolean;
    reportValidity(): boolean;
    private _textareaEl;
    private _value;
    private _textareaPointerCursor;
    private _shadow;
    private _internals;
    private _setValidityFromInput;
    private _dataChanged;
    private _handleChange;
    private _handleInput;
    private _handleMouseMove;
    private _handleScroll;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-textarea': VscodeTextarea;
    }
}
//# sourceMappingURL=vscode-textarea.d.ts.map