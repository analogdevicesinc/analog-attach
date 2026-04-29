var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-toolbar-container.styles.js';
/**
 * Simple container to arrange the toolar buttons
 *
 * @tag vscode-toolbar-container
 */
let VscodeToolbarContainer = class VscodeToolbarContainer extends VscElement {
    render() {
        return html `<div><slot></slot></div>`;
    }
};
VscodeToolbarContainer.styles = styles;
VscodeToolbarContainer = __decorate([
    customElement('vscode-toolbar-container')
], VscodeToolbarContainer);
export { VscodeToolbarContainer };
//# sourceMappingURL=vscode-toolbar-container.js.map