var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { consume } from '@lit/context';
import { property, queryAssignedElements, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
import { configContext, treeContext, } from '../vscode-tree/tree-context.js';
import { initPathTrackerProps } from '../vscode-tree/helpers.js';
import styles from './vscode-tree-item.styles.js';
import { ExpandMode, IndentGuides } from '../vscode-tree/vscode-tree.js';
const BASE_INDENT = 3;
const ARROW_CONTAINER_WIDTH = 30;
const arrowIcon = html `<svg
  width="16"
  height="16"
  viewBox="0 0 16 16"
  xmlns="http://www.w3.org/2000/svg"
>
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"
  />
</svg>`;
function getParentItem(childItem) {
    if (!childItem.parentElement) {
        return null;
    }
    if (!(childItem.parentElement instanceof VscodeTreeItem)) {
        return null;
    }
    return childItem.parentElement;
}
let VscodeTreeItem = class VscodeTreeItem extends VscElement {
    set selected(selected) {
        this._selected = selected;
        this._treeContextState.selectedItems.add(this);
        this.ariaSelected = selected ? 'true' : 'false';
    }
    get selected() {
        return this._selected;
    }
    set path(newPath) {
        this._path = newPath;
    }
    get path() {
        return this._path;
    }
    //#endregion
    //#region lifecycle methods
    constructor() {
        super();
        //#region properties
        this.active = false;
        this.branch = false;
        this.hasActiveItem = false;
        this.hasSelectedItem = false;
        /** @internal */
        this.highlightedGuides = false;
        this.open = false;
        this.level = 0;
        this._selected = false;
        //#endregion
        //#region private variables
        this._path = [];
        this._hasBranchIcon = false;
        this._hasBranchOpenedIcon = false;
        this._hasLeafIcon = false;
        this._treeContextState = {
            isShiftPressed: false,
            selectedItems: new Set(),
            allItems: null,
            itemListUpToDate: false,
            focusedItem: null,
            prevFocusedItem: null,
            hasBranchItem: false,
            rootElement: null,
            activeItem: null,
        };
        this._handleMainSlotChange = () => {
            this._mainSlotChange();
            this._treeContextState.itemListUpToDate = false;
        };
        this._handleComponentFocus = () => {
            if (this._treeContextState.focusedItem &&
                this._treeContextState.focusedItem !== this) {
                if (!this._treeContextState.isShiftPressed) {
                    this._treeContextState.prevFocusedItem =
                        this._treeContextState.focusedItem;
                }
                this._treeContextState.focusedItem = null;
            }
            this._treeContextState.focusedItem = this;
        };
        this._internals = this.attachInternals();
        this.addEventListener('focus', this._handleComponentFocus);
    }
    connectedCallback() {
        super.connectedCallback();
        this._mainSlotChange();
        this.role = 'treeitem';
        this.ariaDisabled = 'false';
    }
    willUpdate(changedProperties) {
        if (changedProperties.has('active')) {
            this._toggleActiveState();
        }
        if (changedProperties.has('open') || changedProperties.has('branch')) {
            this._setAriaExpanded();
        }
    }
    //#endregion
    //#region private methods
    _setAriaExpanded() {
        if (!this.branch) {
            this.ariaExpanded = null;
        }
        else {
            this.ariaExpanded = this.open ? 'true' : 'false';
        }
    }
    _setHasActiveItemFlagOnParent(childItem, value) {
        const parent = getParentItem(childItem);
        if (parent) {
            parent.hasActiveItem = value;
        }
    }
    _toggleActiveState() {
        if (this.active) {
            if (this._treeContextState.activeItem) {
                this._treeContextState.activeItem.active = false;
                this._setHasActiveItemFlagOnParent(this._treeContextState.activeItem, false);
            }
            this._treeContextState.activeItem = this;
            this._setHasActiveItemFlagOnParent(this, true);
            this.tabIndex = 0;
            this._internals.states.add('active');
        }
        else {
            if (this._treeContextState.activeItem === this) {
                this._treeContextState.activeItem = null;
                this._setHasActiveItemFlagOnParent(this, false);
            }
            this.tabIndex = -1;
            this._internals.states.delete('active');
        }
    }
    _selectItem(isCtrlDown) {
        const { selectedItems } = this._treeContextState;
        const { multiSelect } = this._configContext;
        if (multiSelect && isCtrlDown) {
            if (this.selected) {
                this.selected = false;
                selectedItems.delete(this);
            }
            else {
                this.selected = true;
                selectedItems.add(this);
            }
        }
        else {
            selectedItems.forEach((li) => (li.selected = false));
            selectedItems.clear();
            this.selected = true;
            selectedItems.add(this);
        }
    }
    _selectRange() {
        const prevFocused = this._treeContextState.prevFocusedItem;
        if (!prevFocused || prevFocused === this) {
            return;
        }
        if (!this._treeContextState.itemListUpToDate) {
            this._treeContextState.allItems =
                this._treeContextState.rootElement.querySelectorAll('vscode-tree-item');
            if (this._treeContextState.allItems) {
                this._treeContextState.allItems.forEach((li, i) => {
                    li.dataset.score = i.toString();
                });
            }
            this._treeContextState.itemListUpToDate = true;
        }
        let from = +(prevFocused.dataset.score ?? -1);
        let to = +(this.dataset.score ?? -1);
        if (from > to) {
            [from, to] = [to, from];
        }
        this._treeContextState.selectedItems.forEach((li) => (li.selected = false));
        this._treeContextState.selectedItems.clear();
        this._selectItemsAndAllVisibleDescendants(from, to);
    }
    _selectItemsAndAllVisibleDescendants(from, to) {
        let i = from;
        while (i <= to) {
            if (this._treeContextState.allItems) {
                const item = this._treeContextState.allItems[i];
                if (item.branch && !item.open) {
                    item.selected = true;
                    const numChildren = item.querySelectorAll('vscode-tree-item').length;
                    i += numChildren;
                }
                else if (item.branch && item.open) {
                    item.selected = true;
                    i += this._selectItemsAndAllVisibleDescendants(i + 1, to);
                }
                else {
                    item.selected = true;
                    i += 1;
                }
            }
        }
        return i;
    }
    _mainSlotChange() {
        this._initiallyAssignedTreeItems.forEach((li) => {
            li.setAttribute('slot', 'children');
        });
    }
    //#endregion
    //#region event handlers
    _handleChildrenSlotChange() {
        initPathTrackerProps(this, this._childrenTreeItems);
        if (this._treeContextState.rootElement) {
            this._treeContextState.rootElement.updateHasBranchItemFlag();
        }
    }
    _handleContentClick(ev) {
        ev.stopPropagation();
        const isCtrlDown = ev.ctrlKey || ev.metaKey;
        const isShiftDown = ev.shiftKey;
        if (isShiftDown && this._configContext.multiSelect) {
            this._selectRange();
            this._treeContextState.emitSelectEvent?.();
            this.updateComplete.then(() => {
                this._treeContextState.highlightIndentGuides?.();
            });
        }
        else {
            this._selectItem(isCtrlDown);
            this._treeContextState.emitSelectEvent?.();
            this.updateComplete.then(() => {
                this._treeContextState.highlightIndentGuides?.();
            });
            if (this._configContext.expandMode === ExpandMode.singleClick) {
                if (this.branch && !(this._configContext.multiSelect && isCtrlDown)) {
                    this.open = !this.open;
                }
            }
        }
        this.active = true;
        if (!isShiftDown) {
            this._treeContextState.prevFocusedItem = this;
        }
    }
    _handleDoubleClick(ev) {
        if (this._configContext.expandMode === ExpandMode.doubleClick) {
            if (this.branch &&
                !(this._configContext.multiSelect && (ev.ctrlKey || ev.metaKey))) {
                this.open = !this.open;
            }
        }
    }
    _handleIconSlotChange(ev) {
        const slot = ev.target;
        const hasContent = slot.assignedElements().length > 0;
        switch (slot.name) {
            case 'icon-branch':
                this._hasBranchIcon = hasContent;
                break;
            case 'icon-branch-opened':
                this._hasBranchOpenedIcon = hasContent;
                break;
            case 'icon-leaf':
                this._hasLeafIcon = hasContent;
                break;
            default:
        }
    }
    //#endregion
    render() {
        const { hideArrows, indent, indentGuides } = this._configContext;
        const { hasBranchItem } = this._treeContextState;
        let indentation = BASE_INDENT + this.level * indent;
        const guideOffset = !hideArrows ? 13 : 3;
        const indentGuideX = BASE_INDENT + this.level * indent + guideOffset;
        if (!this.branch && !hideArrows && hasBranchItem) {
            indentation += ARROW_CONTAINER_WIDTH;
        }
        const hasVisibleIcon = (this._hasBranchIcon && this.branch) ||
            (this._hasBranchOpenedIcon && this.branch && this.open) ||
            (this._hasLeafIcon && !this.branch);
        const wrapperClasses = {
            wrapper: true,
            active: this.active,
        };
        const childrenClasses = {
            children: true,
            guide: indentGuides !== IndentGuides.none,
            'default-guide': indentGuides !== IndentGuides.none,
            'highlighted-guide': this.highlightedGuides,
        };
        const iconContainerClasses = {
            'icon-container': true,
            'has-icon': hasVisibleIcon,
        };
        return html ` <div class="root">
      <div
        class=${classMap(wrapperClasses)}
        @click=${this._handleContentClick}
        @dblclick=${this._handleDoubleClick}
        .style=${stylePropertyMap({ paddingLeft: `${indentation}px` })}
      >
        ${this.branch && !hideArrows
            ? html `<div
              class=${classMap({
                'arrow-container': true,
                'icon-rotated': this.open,
            })}
            >
              ${arrowIcon}
            </div>`
            : nothing}
        <div class=${classMap(iconContainerClasses)}>
          ${this.branch && !this.open
            ? html `<slot
                name="icon-branch"
                @slotchange=${this._handleIconSlotChange}
              ></slot>`
            : nothing}
          ${this.branch && this.open
            ? html `<slot
                name="icon-branch-opened"
                @slotchange=${this._handleIconSlotChange}
              ></slot>`
            : nothing}
          ${!this.branch
            ? html `<slot
                name="icon-leaf"
                @slotchange=${this._handleIconSlotChange}
              ></slot>`
            : nothing}
        </div>
        <div class="content" part="content">
          <slot @slotchange=${this._handleMainSlotChange}></slot>
        </div>
      </div>
      <div
        class=${classMap(childrenClasses)}
        .style=${stylePropertyMap({
            '--indentation-guide-left': `${indentGuideX}px`,
        })}
        role="group"
        part="children"
      >
        <slot
          name="children"
          @slotchange=${this._handleChildrenSlotChange}
        ></slot>
      </div>
    </div>`;
    }
};
VscodeTreeItem.styles = styles;
__decorate([
    property({ type: Boolean })
], VscodeTreeItem.prototype, "active", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTreeItem.prototype, "branch", void 0);
__decorate([
    property({ type: Boolean })
], VscodeTreeItem.prototype, "hasActiveItem", void 0);
__decorate([
    property({ type: Boolean })
], VscodeTreeItem.prototype, "hasSelectedItem", void 0);
__decorate([
    property({ type: Boolean })
], VscodeTreeItem.prototype, "highlightedGuides", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTreeItem.prototype, "open", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeTreeItem.prototype, "level", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeTreeItem.prototype, "selected", null);
__decorate([
    state()
], VscodeTreeItem.prototype, "_hasBranchIcon", void 0);
__decorate([
    state()
], VscodeTreeItem.prototype, "_hasBranchOpenedIcon", void 0);
__decorate([
    state()
], VscodeTreeItem.prototype, "_hasLeafIcon", void 0);
__decorate([
    consume({ context: treeContext, subscribe: true })
], VscodeTreeItem.prototype, "_treeContextState", void 0);
__decorate([
    consume({ context: configContext, subscribe: true })
], VscodeTreeItem.prototype, "_configContext", void 0);
__decorate([
    queryAssignedElements({ selector: 'vscode-tree-item' })
], VscodeTreeItem.prototype, "_initiallyAssignedTreeItems", void 0);
__decorate([
    queryAssignedElements({ selector: 'vscode-tree-item', slot: 'children' })
], VscodeTreeItem.prototype, "_childrenTreeItems", void 0);
VscodeTreeItem = __decorate([
    customElement('vscode-tree-item')
], VscodeTreeItem);
export { VscodeTreeItem };
//# sourceMappingURL=vscode-tree-item.js.map