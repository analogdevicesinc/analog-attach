import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * Adds more detailed description to a [FromGroup](https://bendera.github.io/vscode-webview-elements/components/vscode-form-group/)
 *
 * @tag vscode-form-helper
 *
 * @cssprop --vsc-foreground-translucent - Default text color. 90% transparency version of `--vscode-foreground` by default.
 */
export declare class VscodeFormHelper extends VscElement {
    static styles: import("lit").CSSResultGroup;
    constructor();
    private _injectLightDOMStyles;
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-form-helper': VscodeFormHelper;
    }
}
//# sourceMappingURL=vscode-form-helper.d.ts.map