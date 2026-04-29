var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, render, nothing } from 'lit';
import { property, query, queryAssignedElements, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import '../../vscode-button/index.js';
import '../../vscode-option/index.js';
import '../../vscode-icon/index.js';
import { stylePropertyMap } from '../style-property-map.js';
import { VscElement } from '../VscElement.js';
import { filterOptionsByPattern, highlightRanges } from './helpers.js';
import { OptionListController } from './OptionListController.js';
import { checkIcon } from './template-elements.js';
import '../../vscode-scrollable/vscode-scrollable.js';
export const VISIBLE_OPTS = 10;
export const OPT_HEIGHT = 22;
export class VscodeSelectBase extends VscElement {
    /**
     * Options can be filtered by typing into a text input field.
     */
    set combobox(enabled) {
        this._opts.comboboxMode = enabled;
    }
    get combobox() {
        return this._opts.comboboxMode;
    }
    /**
     * The element cannot be used and is not focusable.
     */
    set disabled(newState) {
        this._disabled = newState;
        this.ariaDisabled = newState ? 'true' : 'false';
        if (newState === true) {
            this._originalTabIndex = this.tabIndex;
            this.tabIndex = -1;
        }
        else {
            this.tabIndex = this._originalTabIndex ?? 0;
            this._originalTabIndex = undefined;
        }
        this.requestUpdate();
    }
    get disabled() {
        return this._disabled;
    }
    /**
     * Search method in the filtered list within the combobox mode.
     *
     * - contains - The list item includes the searched pattern at any position.
     * - fuzzy - The list item contains the letters of the search pattern in the same order, but at any position.
     * - startsWith - The search pattern matches the beginning of the searched text.
     * - startsWithPerTerm - The search pattern matches the beginning of any word in the searched text.
     *
     * @default 'fuzzy'
     */
    set filter(val) {
        const validValues = [
            'contains',
            'fuzzy',
            'startsWith',
            'startsWithPerTerm',
        ];
        let fm;
        if (validValues.includes(val)) {
            // this._filter = val as FilterMethod;
            fm = val;
        }
        else {
            // this._filter = 'fuzzy';
            // eslint-disable-next-line no-console
            console.warn(`[VSCode Webview Elements] Invalid filter: "${val}", fallback to default. Valid values are: "contains", "fuzzy", "startsWith", "startsWithPerm".`, this);
            fm = 'fuzzy';
        }
        this._opts.filterMethod = fm;
    }
    get filter() {
        return this._opts.filterMethod;
    }
    /**
     * @attr [options=[]]
     * @type {Option[]}
     */
    set options(opts) {
        this._opts.populate(opts);
    }
    get options() {
        return this._opts.options.map(({ label, value, description, selected, disabled, icon }) => ({
            label,
            value,
            description,
            selected,
            disabled,
            icon,
        }));
    }
    //#region lifecycle callbacks
    constructor() {
        super();
        this.creatable = false;
        /**
         * Accessible label for screen readers. When a `<vscode-label>` is connected
         * to the component, it will be filled automatically.
         */
        this.label = '';
        /**
         * Sets the invalid state manually.
         */
        this.invalid = false;
        /**
         * Its value is true when element is focused.
         */
        this.focused = false;
        /**
         * Toggle the dropdown visibility.
         */
        this.open = false;
        /**
         * Position of the options list when visible.
         */
        this.position = 'below';
        /**
         * Select size.
         */
        this.size = 'large';
        this._prevXPos = 0;
        this._prevYPos = 0;
        this._opts = new OptionListController(this);
        this._firstUpdateCompleted = false;
        //#endregion
        this._currentDescription = '';
        this._filter = 'fuzzy';
        this._selectedIndexes = [];
        this._options = [];
        this._value = '';
        this._values = [];
        this._isPlaceholderOptionActive = false;
        this._isBeingFiltered = false;
        this._optionListScrollPos = 0;
        this._isHoverForbidden = false;
        this._disabled = false;
        this._originalTabIndex = undefined;
        this._onMouseMove = () => {
            this._isHoverForbidden = false;
            window.removeEventListener('mousemove', this._onMouseMove);
        };
        this._onOptionListScroll = (ev) => {
            this._optionListScrollPos = ev.detail;
        };
        this._onComponentKeyDown = (event) => {
            if ([' ', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) {
                event.stopPropagation();
                event.preventDefault();
            }
            if (event.key === 'Enter') {
                this._onEnterKeyDown(event);
            }
            if (event.key === ' ') {
                this._onSpaceKeyDown();
            }
            if (event.key === 'Escape') {
                this._onEscapeKeyDown();
            }
            if (event.key === 'ArrowUp') {
                this._onArrowUpKeyDown();
            }
            if (event.key === 'ArrowDown') {
                this._onArrowDownKeyDown();
            }
        };
        this._onComponentFocus = () => {
            this.focused = true;
        };
        this._onComponentBlur = () => {
            this.focused = false;
        };
        this._handleWindowScroll = () => {
            const { x, y } = this.getBoundingClientRect();
            if (x !== this._prevXPos || y !== this._prevYPos) {
                this.open = false;
            }
        };
        this.addEventListener('vsc-option-state-change', (ev) => {
            ev.stopPropagation();
            this._setStateFromSlottedElements();
            this.requestUpdate();
        });
    }
    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('keydown', this._onComponentKeyDown);
        this.addEventListener('focus', this._onComponentFocus);
        this.addEventListener('blur', this._onComponentBlur);
        this._setAutoFocus();
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('keydown', this._onComponentKeyDown);
        this.removeEventListener('focus', this._onComponentFocus);
        this.removeEventListener('blur', this._onComponentBlur);
    }
    firstUpdated(_changedProperties) {
        this._firstUpdateCompleted = true;
    }
    willUpdate(changedProperties) {
        if (changedProperties.has('required') && this._firstUpdateCompleted) {
            this._manageRequired();
        }
        if (changedProperties.has('open') && this._firstUpdateCompleted) {
            if (this.open) {
                this._dropdownEl.showPopover();
                const { x, y } = this.getBoundingClientRect();
                this._prevXPos = x;
                this._prevYPos = y;
                window.addEventListener('scroll', this._handleWindowScroll, {
                    capture: true,
                });
                this._opts.activateDefault();
                this._scrollActiveElementToTop();
            }
            else {
                this._dropdownEl.hidePopover();
                window.removeEventListener('scroll', this._handleWindowScroll);
            }
        }
    }
    get _filteredOptions() {
        if (!this.combobox || this._opts.filterPattern === '') {
            return this._options;
        }
        return filterOptionsByPattern(this._options, this._opts.filterPattern, this._filter);
    }
    _setAutoFocus() {
        if (this.hasAttribute('autofocus')) {
            if (this.tabIndex < 0) {
                this.tabIndex = 0;
            }
            if (this.combobox) {
                this.updateComplete.then(() => {
                    this.shadowRoot
                        ?.querySelector('.combobox-input')
                        .focus();
                });
            }
            else {
                this.updateComplete.then(() => {
                    this.shadowRoot
                        ?.querySelector('.select-face')
                        .focus();
                });
            }
        }
    }
    get _isSuggestedOptionVisible() {
        if (!(this.combobox && this.creatable)) {
            return false;
        }
        const filterPatternExistsAsOption = this._opts.getOptionByValue(this._opts.filterPattern) !== null;
        const filtered = this._opts.filterPattern.length > 0;
        return !filterPatternExistsAsOption && filtered;
    }
    _manageRequired() { }
    _setStateFromSlottedElements() {
        const optionElements = this._assignedOptions ?? [];
        this._opts.clear();
        optionElements.forEach((el) => {
            const { innerText, description, disabled, icon } = el;
            const value = typeof el.value === 'string' ? el.value : innerText.trim();
            const selected = el.selected ?? false;
            const op = {
                label: innerText.trim(),
                value,
                description,
                selected,
                disabled,
                icon,
            };
            this._opts.add(op);
        });
    }
    _createSuggestedOption() {
        const nextSelectedIndex = this._opts.numOptions;
        const op = document.createElement('vscode-option');
        op.value = this._opts.filterPattern;
        render(this._opts.filterPattern, op);
        this.appendChild(op);
        return nextSelectedIndex;
    }
    _dispatchChangeEvent() {
        this.dispatchEvent(new Event('change'));
        this.dispatchEvent(new Event('input'));
    }
    async _createAndSelectSuggestedOption() { }
    _toggleComboboxDropdown() {
        this._opts.filterPattern = '';
        this.open = !this.open;
    }
    _scrollActiveElementToTop() {
        this._optionListScrollPos = Math.floor(this._opts.relativeActiveIndex * OPT_HEIGHT);
    }
    async _adjustOptionListScrollPos(direction, optionIndex) {
        let numOpts = this._opts.numOfVisibleOptions;
        const suggestedOptionVisible = this._isSuggestedOptionVisible;
        if (suggestedOptionVisible) {
            numOpts += 1;
        }
        if (numOpts <= VISIBLE_OPTS) {
            return;
        }
        this._isHoverForbidden = true;
        window.addEventListener('mousemove', this._onMouseMove);
        const ulScrollTop = this._optionListScrollPos;
        const liPosY = optionIndex * OPT_HEIGHT;
        const fullyVisible = liPosY >= ulScrollTop &&
            liPosY <= ulScrollTop + VISIBLE_OPTS * OPT_HEIGHT - OPT_HEIGHT;
        if (direction === 'down') {
            if (!fullyVisible) {
                this._optionListScrollPos =
                    optionIndex * OPT_HEIGHT - (VISIBLE_OPTS - 1) * OPT_HEIGHT;
            }
        }
        if (direction === 'up') {
            if (!fullyVisible) {
                this._optionListScrollPos = Math.floor(this._opts.relativeActiveIndex * OPT_HEIGHT);
            }
        }
    }
    //#region event handlers
    _onFaceClick() {
        this.open = !this.open;
    }
    _handleDropdownToggle(event) {
        this.open = event.newState === 'open';
    }
    _onComboboxButtonClick() {
        this._toggleComboboxDropdown();
    }
    _onComboboxButtonKeyDown(ev) {
        if (ev.key === 'Enter') {
            this._toggleComboboxDropdown();
        }
    }
    _onOptionMouseOver(ev) {
        if (this._isHoverForbidden) {
            return;
        }
        const el = ev.target;
        if (!el.matches('.option')) {
            return;
        }
        if (el.matches('.placeholder')) {
            this._isPlaceholderOptionActive = true;
            this._opts.activeIndex = -1;
        }
        else {
            this._isPlaceholderOptionActive = false;
            this._opts.activeIndex = +el.dataset.index;
        }
    }
    _onPlaceholderOptionMouseOut() {
        this._isPlaceholderOptionActive = false;
    }
    _onNoOptionsClick(ev) {
        ev.stopPropagation();
    }
    _onEnterKeyDown(ev) {
        this._isBeingFiltered = false;
        const clickedOnAcceptButton = ev?.composedPath
            ? ev
                .composedPath()
                .find((el) => el.matches
                ? el.matches('vscode-button.button-accept')
                : false)
            : false;
        if (clickedOnAcceptButton) {
            return;
        }
    }
    _onSpaceKeyDown() {
        if (!this.open) {
            this.open = true;
            return;
        }
    }
    _onArrowUpKeyDown() {
        if (this.open) {
            if (this._opts.activeIndex <= 0 && !(this.combobox && this.creatable)) {
                return;
            }
            if (this._isPlaceholderOptionActive) {
                const optionIndex = this._opts.numOfVisibleOptions - 1;
                this._opts.activeIndex = optionIndex;
                this._isPlaceholderOptionActive = false;
            }
            else {
                const prevOp = this._opts.prev();
                if (prevOp !== null) {
                    this._opts.activeIndex = prevOp?.index ?? -1;
                    const prevSelectableIndex = prevOp?.filteredIndex ?? -1;
                    if (prevSelectableIndex > -1) {
                        this._adjustOptionListScrollPos('up', prevSelectableIndex);
                    }
                }
            }
        }
        else {
            this.open = true;
            this._opts.activateDefault();
        }
    }
    _onArrowDownKeyDown() {
        let numOpts = this._opts.numOfVisibleOptions;
        const suggestedOptionVisible = this._isSuggestedOptionVisible;
        if (suggestedOptionVisible) {
            numOpts += 1;
        }
        if (this.open) {
            if (this._isPlaceholderOptionActive && this._opts.activeIndex === -1) {
                return;
            }
            const nextOp = this._opts.next();
            if (suggestedOptionVisible && nextOp === null) {
                this._isPlaceholderOptionActive = true;
                this._adjustOptionListScrollPos('down', numOpts - 1);
                this._opts.activeIndex = -1;
            }
            else if (nextOp !== null) {
                const nextSelectableIndex = nextOp?.filteredIndex ?? -1;
                this._opts.activeIndex = nextOp?.index ?? -1;
                if (nextSelectableIndex > -1) {
                    this._adjustOptionListScrollPos('down', nextSelectableIndex);
                }
            }
        }
        else {
            this.open = true;
            this._opts.activateDefault();
        }
    }
    _onEscapeKeyDown() {
        this.open = false;
    }
    _onSlotChange() {
        this._setStateFromSlottedElements();
        this.requestUpdate();
    }
    _onComboboxInputFocus(ev) {
        ev.target.select();
        this._isBeingFiltered = false;
        this._opts.filterPattern = '';
    }
    _onComboboxInputBlur() {
        this._isBeingFiltered = false;
    }
    _onComboboxInputInput(ev) {
        this._isBeingFiltered = true;
        this._opts.filterPattern = ev.target.value;
        this._opts.activeIndex = -1;
        this.open = true;
    }
    _onComboboxInputClick() {
        this._isBeingFiltered = this._opts.filterPattern !== '';
        this.open = true;
    }
    _onComboboxInputSpaceKeyDown(ev) {
        if (ev.key === ' ') {
            ev.stopPropagation();
        }
    }
    _onOptionClick(_ev) {
        this._isBeingFiltered = false;
        return;
    }
    //#endregion
    //#region render functions
    _renderCheckbox(checked, label) {
        const checkboxClasses = {
            'checkbox-icon': true,
            checked,
        };
        return html `<span class=${classMap(checkboxClasses)}>${checkIcon}</span
      ><span class="option-label">${label}</span>`;
    }
    _renderOptions() {
        const list = this._opts.options;
        return html `
      <ul
        aria-label=${ifDefined(this.label ?? undefined)}
        aria-multiselectable=${ifDefined(this._opts.multiSelect ? 'true' : undefined)}
        class="options"
        id="select-listbox"
        role="listbox"
        tabindex="-1"
        @click=${this._onOptionClick}
        @mouseover=${this._onOptionMouseOver}
      >
        ${repeat(list, (op) => op.index, (op, index) => {
            if (!op.visible) {
                return nothing;
            }
            const active = op.index === this._opts.activeIndex && !op.disabled;
            const selected = this._opts.getIsIndexSelected(op.index);
            const optionClasses = {
                active,
                disabled: op.disabled,
                option: true,
                'single-select': !this._opts.multiSelect,
                'multi-select': this._opts.multiSelect,
                selected,
            };
            const labelText = (op.ranges?.length ?? 0 > 0)
                ? html `<span
                    >${highlightRanges(op.label, op.ranges ?? [])}</span
                  >`
                : op.label;
            const optionContent = op.icon
                ? html `<vscode-icon
                    name=${op.icon}
                    size=${this.size === 'small' ? '12' : '16'}
                  ></vscode-icon
                  >${labelText}`
                : labelText;
            return html `
              <li
                aria-selected=${selected ? 'true' : 'false'}
                class=${classMap(optionClasses)}
                data-index=${op.index}
                data-filtered-index=${index}
                id=${`op-${op.index}`}
                role="option"
                tabindex="-1"
              >
                ${when(this._opts.multiSelect, () => this._renderCheckbox(selected, optionContent), () => optionContent)}
              </li>
            `;
        })}
        ${this._renderPlaceholderOption(this._opts.numOfVisibleOptions < 1)}
      </ul>
    `;
    }
    _renderPlaceholderOption(isListEmpty) {
        if (!this.combobox) {
            return nothing;
        }
        const foundOption = this._opts.getOptionByLabel(this._opts.filterPattern);
        if (foundOption) {
            return nothing;
        }
        if (this.creatable && this._opts.filterPattern.length > 0) {
            return html `<li
        class=${classMap({
                option: true,
                placeholder: true,
                active: this._isPlaceholderOptionActive,
            })}
        @mouseout=${this._onPlaceholderOptionMouseOut}
      >
        Add "${this._opts.filterPattern}"
      </li>`;
        }
        else {
            return isListEmpty
                ? html `<li class="no-options" @click=${this._onNoOptionsClick}>
            No options
          </li>`
                : nothing;
        }
    }
    _renderDescription() {
        const op = this._opts.getActiveOption();
        if (!op) {
            return nothing;
        }
        const { description } = op;
        return description
            ? html `<div class="description">${description}</div>`
            : nothing;
    }
    _renderSelectFace() {
        return html `${nothing}`;
    }
    _renderComboboxFace() {
        return html `${nothing}`;
    }
    _renderDropdownControls() {
        return html `${nothing}`;
    }
    _renderDropdown() {
        const classes = {
            dropdown: true,
            multiple: this._opts.multiSelect,
            open: this.open,
        };
        const visibleOptions = this._isSuggestedOptionVisible || this._opts.numOfVisibleOptions === 0
            ? this._opts.numOfVisibleOptions + 1
            : this._opts.numOfVisibleOptions;
        const scrollPaneHeight = Math.min(visibleOptions * OPT_HEIGHT, VISIBLE_OPTS * OPT_HEIGHT);
        const cr = this.getBoundingClientRect();
        const dropdownStyles = {
            width: `${cr.width}px`,
            left: `${cr.left}px`,
            top: this.position === 'below' ? `${cr.top + cr.height}px` : 'unset',
            bottom: this.position === 'below'
                ? 'unset'
                : `${document.documentElement.clientHeight - cr.top}px`,
        };
        return html `
      <div
        class=${classMap(classes)}
        popover="auto"
        @toggle=${this._handleDropdownToggle}
        .style=${stylePropertyMap(dropdownStyles)}
      >
        ${this.position === 'above' ? this._renderDescription() : nothing}
        <vscode-scrollable
          always-visible
          class="scrollable"
          min-thumb-size="40"
          tabindex="-1"
          @vsc-scrollable-scroll=${this._onOptionListScroll}
          .scrollPos=${this._optionListScrollPos}
          .style=${stylePropertyMap({
            height: `${scrollPaneHeight}px`,
        })}
        >
          ${this._renderOptions()} ${this._renderDropdownControls()}
        </vscode-scrollable>
        ${this.position === 'below' ? this._renderDescription() : nothing}
      </div>
    `;
    }
}
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSelectBase.prototype, "creatable", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSelectBase.prototype, "combobox", null);
__decorate([
    property({ reflect: true })
], VscodeSelectBase.prototype, "label", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSelectBase.prototype, "disabled", null);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSelectBase.prototype, "invalid", void 0);
__decorate([
    property()
], VscodeSelectBase.prototype, "filter", null);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSelectBase.prototype, "focused", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeSelectBase.prototype, "open", void 0);
__decorate([
    property({ type: Array })
], VscodeSelectBase.prototype, "options", null);
__decorate([
    property({ reflect: true })
], VscodeSelectBase.prototype, "position", void 0);
__decorate([
    property({ reflect: true })
], VscodeSelectBase.prototype, "size", void 0);
__decorate([
    queryAssignedElements({
        flatten: true,
        selector: 'vscode-option',
    })
], VscodeSelectBase.prototype, "_assignedOptions", void 0);
__decorate([
    query('.dropdown', true)
], VscodeSelectBase.prototype, "_dropdownEl", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_currentDescription", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_filter", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_filteredOptions", null);
__decorate([
    state()
], VscodeSelectBase.prototype, "_selectedIndexes", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_options", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_value", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_values", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_isPlaceholderOptionActive", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_isBeingFiltered", void 0);
__decorate([
    state()
], VscodeSelectBase.prototype, "_optionListScrollPos", void 0);
//# sourceMappingURL=vscode-select-base.js.map