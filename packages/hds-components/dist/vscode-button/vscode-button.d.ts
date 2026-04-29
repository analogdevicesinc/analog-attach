import { PropertyValueMap, TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import '../vscode-icon/index.js';
import { IconType } from '../vscode-icon/types.js';
/**
 * Clickable element that are used to trigger actions.
 *
 * @tag vscode-button
 *
 * @cssprop [--vscode-button-background=#0078d4] - Primary button background
 * @cssprop [--vscode-button-foreground=#ffffff] - Primary button foreground
 * @cssprop [--vscode-button-border=var(--vscode-button-background, rgba(255, 255, 255, 0.07))] - Primary button border
 * @cssprop [--vscode-button-hoverBackground=#026ec1] - Primary button hover background
 * @cssprop [--vscode-button-focusBackground=#026ec1] - Primary button focus background
 * @cssprop [--vscode-font-family=sans-serif] - A sans-serif font type depends on the host OS.
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-button-secondaryForeground=#cccccc] - Secondary button foreground
 * @cssprop [--vscode-button-secondaryBackground=#313131] - Secondary button background
 * @cssprop [--vscode-button-secondaryHoverBackground=#3c3c3c] - Secondary button hover background
 * @cssprop [--vscode-button-secondaryFocusBackground=#3c3c3c] - Secondary button focus background
 * @cssprop [--vscode-button-tertiaryForeground=#cccccc] - Tertiary button foreground
 * @cssprop [--vscode-button-tertiaryBackground=transparent] - Tertiary button background
 * @cssprop [--vscode-button-tertiaryHoverBackground=#2a2d2e] - Tertiary button hover background
 * @cssprop [--vscode-button-tertiaryFocusBackground=#2a2d2e] - Tertiary button focus background
 * @cssprop [--vscode-focusBorder=#0078d4]
 *
 * @csspart base - The main content area of the component.
 *
 * @slot content-before - Slot before the main content.
 * @slot content-after - Slot after the main content.
 */
export declare class VscodeButton extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /** @internal */
    static formAssociated: boolean;
    autofocus: boolean;
    /** @internal */
    tabIndex: number;
    /**
     * Button variant style, default is primary.
     */
    variant: 'primary' | 'secondary' | 'tertiary';
    /**
     * Button size.
     */
    size: 'small' | 'medium' | 'large';
    /** @internal */
    role: string;
    disabled: boolean;
    /**
     * A [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) before the label
     */
    icon: IconType;
    /**
     * Spin property for the icon
     */
    iconSpin?: boolean | undefined;
    /**
     * Fixed width property for the button
     * A fixed button will have full width of the parent container.
     */
    fixed?: boolean | undefined;
    /**
     * Duration property for the icon
     */
    iconSpinDuration?: number;
    /**
     * A [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) after the label
     */
    iconAfter: IconType;
    /**
     * Spin property for the after icon
     */
    iconAfterSpin: boolean;
    /**
     * Duration property for the after icon
     */
    iconAfterSpinDuration?: number;
    focused: boolean;
    name: string | undefined;
    iconOnly: boolean;
    type: 'submit' | 'reset' | 'button';
    value: string;
    private _prevTabindex;
    private _internals;
    get form(): HTMLFormElement | null;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    update(changedProperties: PropertyValueMap<any> | Map<PropertyKey, unknown>): void;
    private _executeAction;
    private _handleKeyDown;
    private _handleClick;
    private _handleFocus;
    private _handleBlur;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-button': VscodeButton;
    }
}
//# sourceMappingURL=vscode-button.d.ts.map