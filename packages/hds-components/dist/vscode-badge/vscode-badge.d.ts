import { TemplateResult } from 'lit';
import { VscElement } from '../includes/VscElement.js';
/**
 * Show counts or status information. Badges can also be used within [Textfield](https://vscode-elements.github.io/components/textfield) and [TabHeader](https://vscode-elements.github.io/components/tabs) components.
 *
 * @tag vscode-badge
 *
 * @cssprop [--vscode-font-family=sans-serif] - A sans-serif font type depends on the host OS.
 * @cssprop [--vscode-contrastBorder=transparent]
 * @cssprop [--vscode-badge-background=#616161] - default and counter variant background color
 * @cssprop [--vscode-badge-foreground=#f8f8f8] - default and counter variant foreground color
 * @cssprop [--vscode-activityBarBadge-background=#0078d4] - activity bar variant background color
 * @cssprop [--vscode-activityBarBadge-foreground=#ffffff] - activity bar variant foreground color
 */
export declare class VscodeBadge extends VscElement {
    static styles: import("lit").CSSResultGroup;
    variant: 'default' | 'counter' | 'activity-bar-counter' | 'tab-header-counter';
    render(): TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'vscode-badge': VscodeBadge;
    }
}
//# sourceMappingURL=vscode-badge.d.ts.map