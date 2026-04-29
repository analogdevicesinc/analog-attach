import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
export interface VscClickEventDetail {
    label: string;
    keybinding: string;
    value: string;
    separator: boolean;
    tabindex: number;
}
/**
 * @tag vscode-context-menu-item
 *
 * Child component of [ContextMenu](/components/context-menu/).
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-menu-background=#1f1f1f]
 * @cssprop [--vscode-menu-selectionBorder=transparent]
 * @cssprop [--vscode-menu-foreground=#cccccc]
 * @cssprop [--vscode-menu-selectionBackground=#0078d4]
 * @cssprop [--vscode-menu-selectionForeground=#ffffff]
 * @cssprop [--vscode-menu-separatorBackground=#454545]
 */
export declare class VscodeContextMenuItem extends VscElement {
    static styles: import("lit").CSSResultGroup;
    label: string;
    keybinding: string;
    value: string;
    separator: boolean;
    tabindex: number;
    private onItemClick;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-context-menu-item': VscodeContextMenuItem;
    }
}
//# sourceMappingURL=vscode-context-menu-item.d.ts.map