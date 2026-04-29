import { PropertyValues, TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
import type { VscodeTreeItem } from '../vscode-tree-item';
export type VscTreeSelectEvent = CustomEvent<{
    selectedItems: VscodeTreeItem[];
}>;
export declare const ExpandMode: {
    readonly singleClick: "singleClick";
    readonly doubleClick: "doubleClick";
};
export type ExpandMode = (typeof ExpandMode)[keyof typeof ExpandMode];
export declare const IndentGuides: {
    readonly none: "none";
    readonly onHover: "onHover";
    readonly always: "always";
};
export type IndentGuideDisplay = (typeof IndentGuides)[keyof typeof IndentGuides];
/**
 * @tag vscode-tree
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-foreground=#cccccc]
 * @cssprop [--vscode-icon-foreground=#cccccc]
 * @cssprop [--vscode-list-focusAndSelectionOutline=#0078d4]
 * @cssprop [--vscode-list-focusOutline=#0078d4]
 * @cssprop [--vscode-list-hoverBackground=#2a2d2e]
 * @cssprop [--vscode-list-hoverForeground=#cccccc]
 * @cssprop [--vscode-tree-inactiveIndentGuidesStroke=rgba(88, 88, 88, 0.4)]
 * @cssprop [--vscode-tree-indentGuidesStroke=#585858]
 */
export declare class VscodeTree extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * Controls how tree folders are expanded when clicked. This property is designed to use
     * the `workbench.tree.expandMode` setting.
     *
     * Valid options are available as constants.
     *
     * ```javascript
     * import {ExpandMode} from '@vscode-elements/elements/dist/vscode-tree/vscode-tree.js';
     *
     * document.querySelector('vscode-tree').expandMode = ExpandMode.singleClick;
     * ```
     *
     * @type {'singleClick' | 'doubleClick'}
     */
    expandMode: ExpandMode;
    /**
     * Although arrows are always visible in the Tree component by default in VSCode, some icon sets
     * (e.g., Material Icon Theme) allow disabling them in the file explorer view. This flag makes it
     * possible to mimic that behavior.
     */
    hideArrows: boolean;
    /**
     * Controls the indentation in pixels. This property is designed to use the
     * `workbench.tree.indent` setting.
     */
    indent: number;
    /**
     * Controls whether the tree should render indent guides. This property is
     * designed to use the `workbench.tree.renderIndentGuides` setting.
     *
     * Valid options are available as constants.
     *
     * ```javascript
     * import {IndentGuides} from '@vscode-elements/elements/dist/vscode-tree/vscode-tree.js';
     *
     * document.querySelector('vscode-tree').expandMode = IndentGuides.onHover;
     * ```
     *
     * @type {'none' | 'onHover' | 'always'}
     */
    indentGuides: IndentGuideDisplay;
    /**
     * Allows selecting multiple items.
     */
    multiSelect: boolean;
    private _treeContextState;
    private _configContext;
    private _assignedTreeItems;
    constructor();
    connectedCallback(): void;
    protected willUpdate(changedProperties: PropertyValues<this>): void;
    /**
     * Expands all folders.
     */
    expandAll(): void;
    /**
     * Collapses all folders.
     */
    collapseAll(): void;
    /**
     * @internal
     * Updates `hasBranchItem` property in the context state in order to removing
     * extra padding before the leaf elements, if it is required.
     */
    updateHasBranchItemFlag(): void;
    private _emitSelectEvent;
    private _highlightIndentGuideOfItem;
    private _highlightIndentGuides;
    private _updateConfigContext;
    private _focusItem;
    private _focusPrevItem;
    private _focusNextItem;
    private _handleArrowRightPress;
    private _handleArrowLeftPress;
    private _handleArrowDownPress;
    private _handleArrowUpPress;
    private _handleEnterPress;
    private _handleShiftPress;
    private _handleComponentKeyDown;
    private _handleComponentKeyUp;
    private _handleSlotChange;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-tree': VscodeTree;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-tree-select': VscTreeSelectEvent;
    }
}
//# sourceMappingURL=vscode-tree.d.ts.map