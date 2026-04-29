import { nothing, TemplateResult, PropertyValues } from 'lit';
import '../../vscode-button/index.js';
import '../../vscode-option/index.js';
import '../../vscode-icon/index.js';
import { VscElement } from '../VscElement.js';
import type { InternalOption, Option, FilterMethod } from './types.js';
import { OptionListController } from './OptionListController.js';
import '../../vscode-scrollable/vscode-scrollable.js';
export declare const VISIBLE_OPTS = 10;
export declare const OPT_HEIGHT = 22;
export declare class VscodeSelectBase extends VscElement {
    creatable: boolean;
    /**
     * Options can be filtered by typing into a text input field.
     */
    set combobox(enabled: boolean);
    get combobox(): boolean;
    /**
     * Accessible label for screen readers. When a `<vscode-label>` is connected
     * to the component, it will be filled automatically.
     */
    label: string;
    /**
     * The element cannot be used and is not focusable.
     */
    set disabled(newState: boolean);
    get disabled(): boolean;
    /**
     * Sets the invalid state manually.
     */
    invalid: boolean;
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
    set filter(val: 'contains' | 'fuzzy' | 'startsWith' | 'startsWithPerTerm');
    get filter(): 'contains' | 'fuzzy' | 'startsWith' | 'startsWithPerTerm';
    /**
     * Its value is true when element is focused.
     */
    focused: boolean;
    /**
     * Toggle the dropdown visibility.
     */
    open: boolean;
    /**
     * @attr [options=[]]
     * @type {Option[]}
     */
    set options(opts: Option[]);
    get options(): Option[];
    /**
     * Position of the options list when visible.
     */
    position: 'above' | 'below';
    /**
     * Select size.
     */
    size: 'small' | 'large';
    private _assignedOptions;
    private _dropdownEl;
    private _prevXPos;
    private _prevYPos;
    protected _opts: OptionListController;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected _firstUpdateCompleted: boolean;
    protected firstUpdated(_changedProperties: PropertyValues): void;
    protected willUpdate(changedProperties: PropertyValues): void;
    protected _currentDescription: string;
    protected _filter: FilterMethod;
    protected get _filteredOptions(): InternalOption[];
    protected _selectedIndexes: number[];
    protected _options: InternalOption[];
    protected _value: string;
    protected _values: string[];
    protected _isPlaceholderOptionActive: boolean;
    protected _isBeingFiltered: boolean;
    protected _optionListScrollPos: number;
    private _isHoverForbidden;
    private _disabled;
    private _originalTabIndex;
    private _setAutoFocus;
    protected get _isSuggestedOptionVisible(): boolean;
    protected _manageRequired(): void;
    protected _setStateFromSlottedElements(): void;
    protected _createSuggestedOption(): number;
    protected _dispatchChangeEvent(): void;
    protected _createAndSelectSuggestedOption(): Promise<void>;
    protected _toggleComboboxDropdown(): void;
    protected _scrollActiveElementToTop(): void;
    private _adjustOptionListScrollPos;
    protected _onFaceClick(): void;
    private _handleDropdownToggle;
    private _onMouseMove;
    protected _onComboboxButtonClick(): void;
    protected _onComboboxButtonKeyDown(ev: KeyboardEvent): void;
    private _onOptionListScroll;
    protected _onOptionMouseOver(ev: MouseEvent): void;
    protected _onPlaceholderOptionMouseOut(): void;
    protected _onNoOptionsClick(ev: MouseEvent): void;
    protected _onEnterKeyDown(ev: KeyboardEvent): void;
    private _onSpaceKeyDown;
    protected _onArrowUpKeyDown(): void;
    protected _onArrowDownKeyDown(): void;
    private _onEscapeKeyDown;
    private _onComponentKeyDown;
    private _onComponentFocus;
    private _onComponentBlur;
    protected _onSlotChange(): void;
    protected _onComboboxInputFocus(ev: FocusEvent): void;
    protected _onComboboxInputBlur(): void;
    protected _onComboboxInputInput(ev: InputEvent): void;
    protected _onComboboxInputClick(): void;
    protected _onComboboxInputSpaceKeyDown(ev: KeyboardEvent): void;
    protected _onOptionClick(_ev: MouseEvent): void;
    private _handleWindowScroll;
    private _renderCheckbox;
    protected _renderOptions(): TemplateResult | TemplateResult[];
    protected _renderPlaceholderOption(isListEmpty: boolean): TemplateResult<1> | typeof nothing;
    private _renderDescription;
    protected _renderSelectFace(): TemplateResult;
    protected _renderComboboxFace(): TemplateResult;
    protected _renderDropdownControls(): TemplateResult;
    protected _renderDropdown(): TemplateResult<1>;
}
//# sourceMappingURL=vscode-select-base.d.ts.map