var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-form-helper.styles.js';
const lightDOMStyles = new CSSStyleSheet();
lightDOMStyles.replaceSync(`
  vscode-form-helper * {
    margin: 0;
  }

  vscode-form-helper *:not(:last-child) {
    margin-bottom: 8px;
  }
`);
/**
 * Adds more detailed description to a [FromGroup](https://bendera.github.io/vscode-webview-elements/components/vscode-form-group/)
 *
 * @tag vscode-form-helper
 *
 * @cssprop --vsc-foreground-translucent - Default text color. 90% transparency version of `--vscode-foreground` by default.
 */
let VscodeFormHelper = class VscodeFormHelper extends VscElement {
    constructor() {
        super();
        this._injectLightDOMStyles();
    }
    _injectLightDOMStyles() {
        const found = document.adoptedStyleSheets.find((s) => s === lightDOMStyles);
        if (!found) {
            document.adoptedStyleSheets.push(lightDOMStyles);
        }
    }
    render() {
        return html `<slot></slot>`;
    }
};
VscodeFormHelper.styles = styles;
VscodeFormHelper = __decorate([
    customElement('vscode-form-helper')
], VscodeFormHelper);
export { VscodeFormHelper };
//# sourceMappingURL=vscode-form-helper.js.map