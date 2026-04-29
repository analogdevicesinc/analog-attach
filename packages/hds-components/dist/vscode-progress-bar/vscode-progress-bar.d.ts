import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-progress-bar
 *
 * @cssprop [--vscode-progressBar-background=#0078d4]
 */
export declare class VscodeProgressBar extends VscElement {
    static styles: import("lit").CSSResultGroup;
    /**
     * @internal
     */
    ariaLabel: string;
    /**
     * Current value for determinate mode. If undefined/NaN, the bar is indeterminate.
     */
    value?: number;
    /**
     * Maximum value for determinate mode.
     */
    max: number;
    /**
     * Force indeterminate mode even if value is set.
     */
    indeterminate: boolean;
    /**
     * Switch to a gentler animation after this many ms in indeterminate mode.
     */
    longRunningThreshold: number;
    private _longRunning;
    private _longRunningHandle;
    private get _isDeterminate();
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected willUpdate(): void;
    render(): TemplateResult;
    private _maybeStartLongRunningTimer;
    private _clearLongRunningTimer;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-progress-bar': VscodeProgressBar;
    }
}
//# sourceMappingURL=vscode-progress-bar.d.ts.map