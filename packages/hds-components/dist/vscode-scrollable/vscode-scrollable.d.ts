import { PropertyValues, TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
export type VscScrollableScrollEvent = CustomEvent<number>;
/**
 * @tag vscode-scrollable
 *
 * @cssprop [--vscode-scrollbar-shadow=#000000]
 * @cssprop [--vscode-scrollbarSlider-background=rgba(121, 121, 121, 0.4)]
 * @cssprop [--vscode-scrollbarSlider-hoverBackground=rgba(100, 100, 100, 0.7)]
 * @cssprop [--vscode-scrollbarSlider-activeBackground=rgba(191, 191, 191, 0.4)]
 */
export declare class VscodeScrollable extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * By default, the scrollbar appears only when the cursor hovers over the
     * component. With this option, the scrollbar will always be visible.
     */
    alwaysVisible: boolean;
    /**
     * Scrolling speed multiplier when pressing `Alt`. This property is designed to use the value of
     * `editor.fastScrollSensitivity`, `workbench.list.fastScrollSensitivity` or
     * `terminal.integrated.fastScrollSensitivity` depending on the context.
     */
    fastScrollSensitivity: number;
    /**
     * This setting defines the scrollbar's minimum size when the component contains a large amount of content.
     */
    minThumbSize: number;
    /**
     * A multiplier to be used on the `deltaY` of the mouse wheel scroll events. This property is
     * designed to use the value of `editor.mouseWheelScrollSensitivity`,
     * `workbench.list.mouseWheelScrollSensitivity` or
     * `terminal.integrated.mouseWheelScrollSensitivity` depending on the context.
     */
    mouseWheelScrollSensitivity: number;
    /**
     * Controls shadow visibility when content overflows.
     */
    shadow: boolean;
    /**
     * It's true when `scrollPos` greater than 0
     */
    scrolled: boolean;
    /**
     * Scroll position.
     */
    set scrollPos(val: number);
    get scrollPos(): number;
    private _scrollPos;
    /**
     * The maximum amount of the `scrollPos`.
     */
    get scrollMax(): number;
    private _isDragging;
    private _thumbHeight;
    private _thumbY;
    private _thumbVisible;
    private _thumbFade;
    private _thumbActive;
    private _contentElement;
    private _scrollThumbElement;
    private _scrollableContainer;
    private _assignedElements;
    private _hostResizeObserver;
    private _contentResizeObserver;
    private _componentHeight;
    private _contentHeight;
    private _scrollThumbStartY;
    private _mouseStartY;
    private _scrollbarVisible;
    private _scrollbarTrackZ;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected firstUpdated(_changedProperties: PropertyValues): void;
    private _resizeObserverCallback;
    private _calcThumbHeight;
    private _updateScrollbar;
    private _zIndexFix;
    private _updateThumbPosition;
    private _calculateScrollPosFromThumbPos;
    private _limitScrollPos;
    private _limitThumbPos;
    private _handleSlotChange;
    private _handleScrollThumbMouseDown;
    private _handleScrollThumbMouseMove;
    private _handleScrollThumbMouseUp;
    private _handleComponentMouseOver;
    private _handleComponentMouseOut;
    private _handleComponentWheel;
    private _handleScrollbarTrackPress;
    private _handleScrollableContainerScroll;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-scrollable': VscodeScrollable;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-scrollable-scroll': VscScrollableScrollEvent;
    }
}
//# sourceMappingURL=vscode-scrollable.d.ts.map