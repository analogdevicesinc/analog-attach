import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import { type IconType } from './types.js';
/**
 * Display a [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html).
 * In "action-icon" mode it behaves like a button. In this case, it is
 * recommended that a meaningful label is specified with the `label` property.
 *
 * @tag vscode-icon
 *
 * @cssprop [--vscode-icon-foreground=#cccccc]
 * @cssprop [--vscode-toolbar-hoverBackground=rgba(90, 93, 94, 0.31)] - Hover state background color in `active-icon` mode
 * @cssprop [--vscode-toolbar-activeBackground=rgba(99, 102, 103, 0.31)] - Active state background color in `active-icon` mode
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--icon-mask] - Custom icon mask image (when using custom icons)
 */
export declare class VscodeIcon extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * Set a meaningful label in `action-icon` mode for the screen readers
     */
    label: string;
    /**
     * [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) icon name or HDS custom icon name.
     */
    name: IconType;
    /**
     * Icon size in pixels
     */
    size: number;
    /**
     * Enable rotation animation
     */
    spin: boolean;
    /**
     * Animation duration in seconds
     */
    spinDuration: number;
    /**
     * Behaves like a button
     */
    actionIcon: boolean;
    /**
     * Use custom icon via CSS custom property (--icon-mask)
     */
    custom: boolean;
    private static stylesheetHref;
    private static nonce;
    connectedCallback(): void;
    /**
     * Check if the icon name is an HDS custom icon
     */
    private _isHdsIcon;
    /**
     * Get the SVG path for HDS icons
     */
    private _getHdsSvgPath;
    /**
     * For using web fonts in web components, the font stylesheet must be included
     * twice: on the page and in the web component. This function looks for the
     * font stylesheet on the page and returns the stylesheet URL and the nonce
     * id.
     */
    private _getStylesheetConfig;
    private _onButtonClick;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-icon': VscodeIcon;
    }
}
//# sourceMappingURL=vscode-icon.d.ts.map