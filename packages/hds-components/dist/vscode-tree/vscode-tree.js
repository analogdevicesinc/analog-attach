var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { provide } from '@lit/context';
import { property, queryAssignedElements } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-tree.styles.js';
import { configContext, treeContext, } from './tree-context.js';
import { findNextItem, findPrevItem, findParentItem, initPathTrackerProps, } from './helpers.js';
export const ExpandMode = {
    singleClick: 'singleClick',
    doubleClick: 'doubleClick',
};
export const IndentGuides = {
    none: 'none',
    onHover: 'onHover',
    always: 'always',
};
const listenedKeys = [
    ' ',
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'Enter',
    'Escape',
    'Shift',
];
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
let VscodeTree = class VscodeTree extends VscElement {
    //#endregion
    //#region lifecycle methods
    constructor() {
        super();
        //#region properties
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
        this.expandMode = 'singleClick';
        /**
         * Although arrows are always visible in the Tree component by default in VSCode, some icon sets
         * (e.g., Material Icon Theme) allow disabling them in the file explorer view. This flag makes it
         * possible to mimic that behavior.
         */
        this.hideArrows = false;
        /**
         * Controls the indentation in pixels. This property is designed to use the
         * `workbench.tree.indent` setting.
         */
        this.indent = 8;
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
        this.indentGuides = 'onHover';
        /**
         * Allows selecting multiple items.
         */
        this.multiSelect = false;
        //#endregion
        //#region private variables
        this._treeContextState = {
            isShiftPressed: false,
            activeItem: null,
            selectedItems: new Set(),
            allItems: null,
            itemListUpToDate: false,
            focusedItem: null,
            prevFocusedItem: null,
            hasBranchItem: false,
            rootElement: this,
            highlightedItems: new Set(),
            highlightIndentGuides: () => {
                this._highlightIndentGuides();
            },
            emitSelectEvent: () => {
                this._emitSelectEvent();
            },
        };
        this._configContext = {
            hideArrows: this.hideArrows,
            expandMode: this.expandMode,
            indent: this.indent,
            indentGuides: this.indentGuides,
            multiSelect: this.multiSelect,
        };
        this._handleComponentKeyDown = (ev) => {
            const key = ev.key;
            if (listenedKeys.includes(key)) {
                ev.stopPropagation();
                ev.preventDefault();
            }
            switch (key) {
                case ' ':
                case 'Enter':
                    this._handleEnterPress();
                    break;
                case 'ArrowDown':
                    this._handleArrowDownPress();
                    break;
                case 'ArrowLeft':
                    this._handleArrowLeftPress(ev);
                    break;
                case 'ArrowRight':
                    this._handleArrowRightPress();
                    break;
                case 'ArrowUp':
                    this._handleArrowUpPress();
                    break;
                case 'Shift':
                    this._handleShiftPress();
                    break;
                default:
            }
        };
        this._handleComponentKeyUp = (ev) => {
            if (ev.key === 'Shift') {
                this._treeContextState.isShiftPressed = false;
            }
        };
        this._handleSlotChange = () => {
            this._treeContextState.itemListUpToDate = false;
            initPathTrackerProps(this, this._assignedTreeItems);
            this.updateComplete.then(() => {
                if (this._treeContextState.activeItem === null) {
                    const firstChild = this.querySelector(':scope > vscode-tree-item');
                    if (firstChild) {
                        firstChild.active = true;
                    }
                }
            });
        };
        this.addEventListener('keyup', this._handleComponentKeyUp);
        this.addEventListener('keydown', this._handleComponentKeyDown);
    }
    connectedCallback() {
        super.connectedCallback();
        this.role = 'tree';
    }
    willUpdate(changedProperties) {
        this._updateConfigContext(changedProperties);
        if (changedProperties.has('multiSelect')) {
            this.ariaMultiSelectable = this.multiSelect ? 'true' : 'false';
        }
    }
    //#endregion
    //#region public methods
    /**
     * Expands all folders.
     */
    expandAll() {
        const children = this.querySelectorAll('vscode-tree-item');
        children.forEach((item) => {
            if (item.branch) {
                item.open = true;
            }
        });
    }
    /**
     * Collapses all folders.
     */
    collapseAll() {
        const children = this.querySelectorAll('vscode-tree-item');
        children.forEach((item) => {
            if (item.branch) {
                item.open = false;
            }
        });
    }
    /**
     * @internal
     * Updates `hasBranchItem` property in the context state in order to removing
     * extra padding before the leaf elements, if it is required.
     */
    updateHasBranchItemFlag() {
        const hasBranchItem = this._assignedTreeItems.some((li) => li.branch);
        this._treeContextState = { ...this._treeContextState, hasBranchItem };
    }
    //#endregion
    //#region private methods
    _emitSelectEvent() {
        const ev = new CustomEvent('vsc-tree-select', {
            detail: Array.from(this._treeContextState.selectedItems),
        });
        this.dispatchEvent(ev);
    }
    _highlightIndentGuideOfItem(item) {
        if (item.branch && item.open) {
            item.highlightedGuides = true;
            this._treeContextState.highlightedItems?.add(item);
        }
        else {
            const parent = findParentItem(item);
            if (parent) {
                parent.highlightedGuides = true;
                this._treeContextState.highlightedItems?.add(parent);
            }
        }
    }
    _highlightIndentGuides() {
        if (this.indentGuides === IndentGuides.none) {
            return;
        }
        this._treeContextState.highlightedItems?.forEach((i) => (i.highlightedGuides = false));
        this._treeContextState.highlightedItems?.clear();
        if (this._treeContextState.activeItem) {
            this._highlightIndentGuideOfItem(this._treeContextState.activeItem);
        }
        this._treeContextState.selectedItems.forEach((item) => {
            this._highlightIndentGuideOfItem(item);
        });
    }
    _updateConfigContext(changedProperties) {
        const { hideArrows, expandMode, indent, indentGuides, multiSelect } = this;
        if (changedProperties.has('hideArrows')) {
            this._configContext = { ...this._configContext, hideArrows };
        }
        if (changedProperties.has('expandMode')) {
            this._configContext = { ...this._configContext, expandMode };
        }
        if (changedProperties.has('indent')) {
            this._configContext = { ...this._configContext, indent };
        }
        if (changedProperties.has('indentGuides')) {
            this._configContext = { ...this._configContext, indentGuides };
        }
        if (changedProperties.has('multiSelect')) {
            this._configContext = { ...this._configContext, multiSelect };
        }
    }
    _focusItem(item) {
        item.active = true;
        item.updateComplete.then(() => {
            item.focus();
            this._highlightIndentGuides();
        });
    }
    _focusPrevItem() {
        if (this._treeContextState.focusedItem) {
            const item = findPrevItem(this._treeContextState.focusedItem);
            if (item) {
                this._focusItem(item);
                if (this._treeContextState.isShiftPressed && this.multiSelect) {
                    item.selected = !item.selected;
                    this._emitSelectEvent();
                }
            }
        }
    }
    _focusNextItem() {
        if (this._treeContextState.focusedItem) {
            const item = findNextItem(this._treeContextState.focusedItem);
            if (item) {
                this._focusItem(item);
                if (this._treeContextState.isShiftPressed && this.multiSelect) {
                    item.selected = !item.selected;
                    this._emitSelectEvent();
                }
            }
        }
    }
    //#endregion
    //#region event handlers
    _handleArrowRightPress() {
        if (!this._treeContextState.focusedItem) {
            return;
        }
        const { focusedItem } = this._treeContextState;
        if (focusedItem.branch) {
            if (focusedItem.open) {
                this._focusNextItem();
            }
            else {
                focusedItem.open = true;
            }
        }
    }
    _handleArrowLeftPress(ev) {
        if (ev.ctrlKey) {
            this.collapseAll();
            return;
        }
        if (!this._treeContextState.focusedItem) {
            return;
        }
        const { focusedItem } = this._treeContextState;
        const parent = findParentItem(focusedItem);
        if (!focusedItem.branch) {
            if (parent && parent.branch) {
                this._focusItem(parent);
            }
        }
        else {
            if (focusedItem.open) {
                focusedItem.open = false;
            }
            else {
                if (parent && parent.branch) {
                    this._focusItem(parent);
                }
            }
        }
    }
    _handleArrowDownPress() {
        if (this._treeContextState.focusedItem) {
            this._focusNextItem();
        }
        else {
            this._focusItem(this._assignedTreeItems[0]);
        }
    }
    _handleArrowUpPress() {
        if (this._treeContextState.focusedItem) {
            this._focusPrevItem();
        }
        else {
            this._focusItem(this._assignedTreeItems[0]);
        }
    }
    _handleEnterPress() {
        const { focusedItem } = this._treeContextState;
        if (focusedItem) {
            this._treeContextState.selectedItems.forEach((li) => (li.selected = false));
            this._treeContextState.selectedItems.clear();
            this._highlightIndentGuides();
            focusedItem.selected = true;
            this._emitSelectEvent();
            if (focusedItem.branch) {
                focusedItem.open = !focusedItem.open;
            }
        }
    }
    _handleShiftPress() {
        this._treeContextState.isShiftPressed = true;
    }
    //#endregion
    render() {
        return html `<div>
      <slot @slotchange=${this._handleSlotChange}></slot>
    </div>`;
    }
};
VscodeTree.styles = styles;
__decorate([
    property({ type: String, attribute: 'expand-mode' })
], VscodeTree.prototype, "expandMode", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'hide-arrows' })
], VscodeTree.prototype, "hideArrows", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeTree.prototype, "indent", void 0);
__decorate([
    property({
        type: String,
        attribute: 'indent-guides',
        useDefault: true,
        reflect: true,
    })
], VscodeTree.prototype, "indentGuides", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'multi-select' })
], VscodeTree.prototype, "multiSelect", void 0);
__decorate([
    provide({ context: treeContext })
], VscodeTree.prototype, "_treeContextState", void 0);
__decorate([
    provide({ context: configContext })
], VscodeTree.prototype, "_configContext", void 0);
__decorate([
    queryAssignedElements({ selector: 'vscode-tree-item' })
], VscodeTree.prototype, "_assignedTreeItems", void 0);
VscodeTree = __decorate([
    customElement('vscode-tree')
], VscodeTree);
export { VscodeTree };
//# sourceMappingURL=vscode-tree.js.map