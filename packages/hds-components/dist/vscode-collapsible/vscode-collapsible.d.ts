import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
export type VscCollapsibleToggleEvent = CustomEvent<{
    open: boolean;
}>;
/**
 * Allows users to reveal or hide related content on a page.
 *
 * @tag vscode-collapsible
 *
 * @slot - Main content.
 * @slot actions - You can place any action icon in this slot in the header, but it's also possible to use any HTML element in it. It's only visible when the component is open.
 * @slot decorations - The elements placed in the decorations slot are always visible.
 *
 * @fires {VscCollapsibleToggleEvent} vsc-collapsible-toggle - Dispatched when the content visibility is changed.
 *
 * @cssprop [--vscode-sideBar-background=#181818] - Background color
 * @cssprop [--vscode-focusBorder=#0078d4] - Focus border color
 * @cssprop [--vscode-font-family=sans-serif] - Header font family
 * @cssprop [--vscode-sideBarSectionHeader-background=#181818] - Header background
 * @cssprop [--vscode-icon-foreground=#cccccc] - Arrow icon color
 * @cssprop [--vscode-sideBarTitle-foreground=#cccccc] - Header font color
 *
 * @csspart body - Container for the toggleable content of the component. The container's overflow content is hidden by default. This CSS part can serve as an escape hatch to modify this behavior.
 */
export declare class VscodeCollapsible extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * When enabled, header actions are always visible; otherwise, they appear only when the cursor
     * hovers over the component. Actions are shown only when the Collapsible component is open. This
     * property is designed to use the `workbench.view.alwaysShowHeaderActions` setting.
     */
    alwaysShowHeaderActions: boolean;
    /**
     * Component heading text
     *
     * @deprecated The `title` is a global HTML attribute and will unintentionally trigger a native
     * tooltip on the component. Use the `heading` property instead.
     */
    title: string;
    /**
     * Heading text.
     */
    heading: string;
    /** Less prominent text in the header. */
    description: string;
    open: boolean;
    private _emitToggleEvent;
    private _onHeaderClick;
    private _onHeaderKeyDown;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-collapsible': VscodeCollapsible;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-collapsible-toggle': VscCollapsibleToggleEvent;
    }
}
//# sourceMappingURL=vscode-collapsible.d.ts.map