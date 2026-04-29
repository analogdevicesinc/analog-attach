import { PropertyValues, TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
export declare class VscodeTreeItem extends VscElement {
    static styles: import("lit").CSSResultGroup;
    active: boolean;
    branch: boolean;
    hasActiveItem: boolean;
    hasSelectedItem: boolean;
    /** @internal */
    highlightedGuides: boolean;
    open: boolean;
    level: number;
    set selected(selected: boolean);
    get selected(): boolean;
    private _selected;
    set path(newPath: number[]);
    get path(): number[];
    private _path;
    private _internals;
    private _hasBranchIcon;
    private _hasBranchOpenedIcon;
    private _hasLeafIcon;
    private _treeContextState;
    private _configContext;
    private _initiallyAssignedTreeItems;
    private _childrenTreeItems;
    constructor();
    connectedCallback(): void;
    protected willUpdate(changedProperties: PropertyValues): void;
    private _setAriaExpanded;
    private _setHasActiveItemFlagOnParent;
    private _toggleActiveState;
    private _selectItem;
    private _selectRange;
    private _selectItemsAndAllVisibleDescendants;
    private _mainSlotChange;
    private _handleChildrenSlotChange;
    private _handleMainSlotChange;
    private _handleComponentFocus;
    private _handleContentClick;
    private _handleDoubleClick;
    private _handleIconSlotChange;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-tree-item': VscodeTreeItem;
    }
}
//# sourceMappingURL=vscode-tree-item.d.ts.map