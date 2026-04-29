import { LitElement } from 'lit';
const VERSION = '2.3.1';
const CONFIG_KEY = '__vscodeElements_disableRegistryWarning__';
export class VscElement extends LitElement {
    /** VSCode Elements version */
    get version() {
        return VERSION;
    }
}
/**
 * Own implementation of Lit's customElement decorator.
 */
export const customElement = (tagName) => {
    return (classOrTarget) => {
        const customElementClass = customElements.get(tagName);
        if (!customElementClass) {
            customElements.define(tagName, classOrTarget);
            return;
        }
        if (CONFIG_KEY in window) {
            return;
        }
        const el = document.createElement(tagName);
        const anotherVersion = el?.version;
        let message = '';
        if (!anotherVersion) {
            message +=
                'is already registered by an unknown custom element handler class.';
        }
        else if (anotherVersion !== VERSION) {
            message +=
                'is already registered by a different version of VSCode Elements. ';
            message += `This version is "${VERSION}", while the other one is "${anotherVersion}".`;
        }
        else {
            message += `is already registered by the same version of VSCode Elements (${VERSION}).`;
        }
        // eslint-disable-next-line no-console
        console.warn(`[VSCode Elements] ${tagName} ${message}\nTo suppress this warning, set window.${CONFIG_KEY} to true`);
    };
};
//# sourceMappingURL=VscElement.js.map