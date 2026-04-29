var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-progress-ring.styles.js';
/**
 * @tag vscode-progress-ring
 *
 * @cssprop [--vscode-progressBar-background=#0078d4]
 */
let VscodeProgressRing = class VscodeProgressRing extends VscElement {
    constructor() {
        super(...arguments);
        this.ariaLabel = 'Loading';
        this.ariaLive = 'assertive';
        this.role = 'alert';
    }
    render() {
        return html `<svg class="progress" part="progress" viewBox="0 0 16 16">
      <circle
        class="background"
        part="background"
        cx="8px"
        cy="8px"
        r="7px"
      ></circle>
      <circle
        class="indeterminate-indicator-1"
        part="indeterminate-indicator-1"
        cx="8px"
        cy="8px"
        r="7px"
      ></circle>
    </svg>`;
    }
};
VscodeProgressRing.styles = styles;
__decorate([
    property({ reflect: true, attribute: 'aria-label' })
], VscodeProgressRing.prototype, "ariaLabel", void 0);
__decorate([
    property({ reflect: true, attribute: 'aria-live' })
], VscodeProgressRing.prototype, "ariaLive", void 0);
__decorate([
    property({ reflect: true })
], VscodeProgressRing.prototype, "role", void 0);
VscodeProgressRing = __decorate([
    customElement('vscode-progress-ring')
], VscodeProgressRing);
export { VscodeProgressRing };
//# sourceMappingURL=vscode-progress-ring.js.map