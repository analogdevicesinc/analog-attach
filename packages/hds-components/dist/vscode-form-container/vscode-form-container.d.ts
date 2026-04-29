import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-form-container
 */
export declare class VscodeFormContainer extends VscElement {
    static styles: import("lit").CSSResultGroup;
    set responsive(isResponsive: boolean);
    get responsive(): boolean;
    breakpoint: number;
    private _resizeObserver;
    private _wrapperElement;
    private _assignedFormGroups;
    private _responsive;
    private _firstUpdateComplete;
    private _currentFormGroupLayout;
    private _toggleCompactLayout;
    private _resizeObserverCallback;
    private _resizeObserverCallbackBound;
    private _activateResponsiveLayout;
    private _deactivateResizeObserver;
    firstUpdated(): void;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-form-container': VscodeFormContainer;
    }
}
//# sourceMappingURL=vscode-form-container.d.ts.map