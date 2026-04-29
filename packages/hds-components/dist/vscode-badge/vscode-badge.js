var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-badge.styles.js';
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
let VscodeBadge = class VscodeBadge extends VscElement {
    constructor() {
        super(...arguments);
        this.variant = 'default';
    }
    render() {
        return html `<div class="root"><slot></slot></div>`;
    }
};
VscodeBadge.styles = styles;
__decorate([
    property({ reflect: true })
], VscodeBadge.prototype, "variant", void 0);
VscodeBadge = __decorate([
    customElement('vscode-badge')
], VscodeBadge);
export { VscodeBadge };
//# sourceMappingURL=vscode-badge.js.map