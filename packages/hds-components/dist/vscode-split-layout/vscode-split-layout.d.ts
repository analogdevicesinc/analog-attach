import { PropertyValues, TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
type PositionUnit = 'pixel' | 'percent';
type Orientation = 'horizontal' | 'vertical';
type FixedPaneType = 'start' | 'end' | 'none';
export declare const parseValue: (raw: string) => {
    value: number;
    unit: PositionUnit;
};
export declare const pxToPercent: (current: number, max: number) => number;
export declare const percentToPx: (current: number, max: number) => number;
export type VscSplitLayoutChangeEvent = CustomEvent<{
    position: number;
    positionInPercentage: number;
}>;
/**
 * @tag vscode-split-layout
 *
 * @prop {'start' | 'end' | 'none'} fixedPane
 *
 * @cssprop [--separator-border=#454545]
 * @cssprop [--vscode-editorWidget-border=#454545]
 * @cssprop [--vscode-sash-hoverBorder=#0078d4]
 */
export declare class VscodeSplitLayout extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * Direction of the divider.
     */
    set split(newVal: Orientation);
    get split(): Orientation;
    private _split;
    /**
     * Controls whether the handle position should reset to the value set in the
     * `initialHandlePosition` when it is double-clicked.
     */
    resetOnDblClick: boolean;
    /**
     * Controls the draggable area size in pixels. it is intended to use the value
     * of `workbench.sash.size`.
     */
    handleSize: number;
    /**
     * The handler position will reset to this position when it is double-clicked,
     * or the `resetHandlePosition()` is called.
     */
    initialHandlePosition: string;
    /**
     * Set the handle position programmatically. The value must include a unit,
     * either `%` or `px`. If no unit is specified, the value is interpreted as
     * `px`.
     */
    set handlePosition(newVal: string);
    get handlePosition(): string | undefined;
    private _rawHandlePosition?;
    /**
     * The size of the fixed pane will not change when the component is resized.
     */
    set fixedPane(newVal: FixedPaneType);
    get fixedPane(): FixedPaneType;
    private _fixedPane;
    private _handlePosition;
    private _isDragActive;
    private _hover;
    private _hide;
    private _wrapperEl;
    private _handleEl;
    private _nestedLayoutsAtStart;
    private _nestedLayoutsAtEnd;
    private _boundRect;
    private _handleOffset;
    private _resizeObserver;
    private _wrapperObserved;
    private _fixedPaneSize;
    constructor();
    /**
     * Sets the handle position to the value specified in the `initialHandlePosition` property.
     */
    resetHandlePosition(): void;
    connectedCallback(): void;
    protected firstUpdated(_changedProperties: PropertyValues): void;
    private _handlePositionPropChanged;
    private _fixedPanePropChanged;
    private _initFixedPane;
    private _handleResize;
    private _setPosition;
    private _handleMouseOver;
    private _handleMouseOut;
    private _handleMouseDown;
    private _handleMouseUp;
    private _handleMouseMove;
    private _handleDblClick;
    private _handleSlotChange;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-split-layout': VscodeSplitLayout;
    }
    interface GlobalEventHandlersEventMap {
        'vsc-split-layout-change': VscSplitLayoutChangeEvent;
    }
}
export {};
//# sourceMappingURL=vscode-split-layout.d.ts.map