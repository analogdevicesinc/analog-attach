import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-progress-ring
 *
 * @cssprop [--vscode-progressBar-background=#0078d4]
 */
export declare class VscodeProgressRing extends VscElement {
    static styles: import("lit").CSSResultGroup;
    ariaLabel: string;
    ariaLive: string;
    role: string;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-progress-ring': VscodeProgressRing;
    }
}
//# sourceMappingURL=vscode-progress-ring.d.ts.map