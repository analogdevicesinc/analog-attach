import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * @tag vscode-label
 *
 * @cssprop [--vscode-font-family=sans-serif]
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-foreground=#cccccc]
 */
export declare class VscodeLabel extends VscElement {
    static styles: import("lit").CSSResultGroup;
    set htmlFor(val: string);
    get htmlFor(): string;
    set id(val: string);
    get id(): string;
    required: boolean;
    attributeChangedCallback(name: string, old: string | null, value: string): void;
    connectedCallback(): void;
    private _id;
    private _htmlFor;
    private _connected;
    private _getTarget;
    private _connectWithTarget;
    private _handleClick;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-label': VscodeLabel;
    }
}
//# sourceMappingURL=vscode-label.d.ts.map