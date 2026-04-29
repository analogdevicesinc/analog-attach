import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import '../vscode-context-menu-item/index.js';
interface MenuItemData {
    label?: string;
    keybinding?: string;
    value?: string;
    separator?: boolean;
    tabindex?: number;
}
export type VscContextMenuSelectEvent = CustomEvent<{
    keybinding: string;
    label: string;
    value: string;
    separator: boolean;
    tabindex: number;
}>;
/**
 * @tag vscode-context-menu
 *
 * @fires {VscMenuSelectEvent} vsc-menu-select - Emitted when a menu item is clicked
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-menu-background=#1f1f1f]
 * @cssprop [--vscode-menu-border=#454545]
 * @cssprop [--vscode-menu-foreground=#cccccc]
 * @cssprop [--vscode-widget-shadow=rgba(0, 0, 0, 0.36)]
 */
export declare class VscodeContextMenu extends VscElement {
    static styles: import("lit").CSSResultGroup;
    set data(data: MenuItemData[]);
    get data(): MenuItemData[];
    /**
     * By default, the menu closes when an item is clicked. This attribute prevents the menu from closing.
     */
    preventClose: boolean;
    set show(show: boolean);
    get show(): boolean;
    /** @internal */
    tabIndex: number;
    constructor();
    private _selectedClickableItemIndex;
    private _show;
    private _wrapperEl;
    private _data;
    private _clickableItemIndexes;
    private _onClickOutside;
    private _onClickOutsideBound;
    private _onKeyDown;
    private _handleArrowUp;
    private _handleArrowDown;
    private _handleEscape;
    private _dispatchSelectEvent;
    private _handleEnter;
    private _onItemClick;
    private _onItemMouseOver;
    private _onItemMouseOut;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-context-menu': VscodeContextMenu;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-context-menu-select': VscContextMenuSelectEvent;
    }
}
export {};
//# sourceMappingURL=vscode-context-menu.d.ts.map