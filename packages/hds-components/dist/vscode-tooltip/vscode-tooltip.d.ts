import { TemplateResult, PropertyValues } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * A tooltip component that displays a label on hover over its children.
 * The tooltip wraps its children and shows the tooltip text when hovered.
 * Can also be set to active mode for always-visible tooltips.
 *
 * @tag vscode-tooltip
 *
 * @slot - The content that will trigger the tooltip on hover.
 * @slot tooltip - Custom content to display in the tooltip. Takes precedence over the label property.
 *
 * @cssprop [--vscode-tooltip-background=#1e1e1e] - Tooltip background color
 * @cssprop [--vscode-tooltip-foreground=#cccccc] - Tooltip text color
 * @cssprop [--vscode-tooltip-border=#454545] - Tooltip border color
 * @cssprop [--vscode-font-family=sans-serif] - Font family
 * @cssprop [--vscode-font-size=12px] - Font size
 * @cssprop [--vscode-tooltip-maxWidth=320px] - Maximum width of tooltip
 * @cssprop [--vscode-tooltip-zIndex=1000] - Z-index for tooltip positioning
 * @cssprop [--vscode-focusBorder=#0078d4] - Border color for active tooltips
 *
 * @csspart tooltip - The tooltip container element
 * @csspart content - The wrapped content element
 */
export declare class VscodeTooltip extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * The text to display in the tooltip
     */
    label: string;
    /**
     * Position of the tooltip relative to the trigger element
     */
    position: 'top' | 'bottom' | 'left' | 'right';
    /**
     * Delay in milliseconds before showing the tooltip
     */
    showDelay: number;
    /**
     * Delay in milliseconds before hiding the tooltip
     */
    hideDelay: number;
    /**
     * Disable the tooltip
     */
    disabled: boolean;
    /**
     * Keep the tooltip always visible (overrides hover/focus behavior)
     */
    active: boolean;
    private _visible;
    private _showTimeout;
    private _hideTimeout;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected willUpdate(changedProperties: PropertyValues): void;
    private _clearTimeouts;
    private _hasTooltipContent;
    private _showTooltip;
    private _hideTooltip;
    private _handleMouseEnter;
    private _handleMouseLeave;
    private _handleFocus;
    private _handleBlur;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-tooltip': VscodeTooltip;
    }
}
//# sourceMappingURL=vscode-tooltip.d.ts.map