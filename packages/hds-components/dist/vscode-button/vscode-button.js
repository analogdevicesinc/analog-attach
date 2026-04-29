var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import '../vscode-icon/index.js';
import styles from './vscode-button.styles.js';
/**
 * Clickable element that are used to trigger actions.
 *
 * @tag vscode-button
 *
 * @cssprop [--vscode-button-background=#0078d4] - Primary button background
 * @cssprop [--vscode-button-foreground=#ffffff] - Primary button foreground
 * @cssprop [--vscode-button-border=var(--vscode-button-background, rgba(255, 255, 255, 0.07))] - Primary button border
 * @cssprop [--vscode-button-hoverBackground=#026ec1] - Primary button hover background
 * @cssprop [--vscode-button-focusBackground=#026ec1] - Primary button focus background
 * @cssprop [--vscode-font-family=sans-serif] - A sans-serif font type depends on the host OS.
 * @cssprop [--vscode-font-size=13px]
 * @cssprop [--vscode-font-weight=normal]
 * @cssprop [--vscode-button-secondaryForeground=#cccccc] - Secondary button foreground
 * @cssprop [--vscode-button-secondaryBackground=#313131] - Secondary button background
 * @cssprop [--vscode-button-secondaryHoverBackground=#3c3c3c] - Secondary button hover background
 * @cssprop [--vscode-button-secondaryFocusBackground=#3c3c3c] - Secondary button focus background
 * @cssprop [--vscode-button-tertiaryForeground=#cccccc] - Tertiary button foreground
 * @cssprop [--vscode-button-tertiaryBackground=transparent] - Tertiary button background
 * @cssprop [--vscode-button-tertiaryHoverBackground=#2a2d2e] - Tertiary button hover background
 * @cssprop [--vscode-button-tertiaryFocusBackground=#2a2d2e] - Tertiary button focus background
 * @cssprop [--vscode-focusBorder=#0078d4]
 *
 * @csspart base - The main content area of the component.
 *
 * @slot content-before - Slot before the main content.
 * @slot content-after - Slot after the main content.
 */
let VscodeButton = class VscodeButton extends VscElement {
    get form() {
        return this._internals.form;
    }
    constructor() {
        super();
        this.autofocus = false;
        /** @internal */
        this.tabIndex = 0;
        /**
         * Button variant style, default is primary.
         */
        this.variant = 'primary';
        /**
         * Button size.
         */
        this.size = 'medium';
        /** @internal */
        this.role = 'button';
        this.disabled = false;
        /**
         * A [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) before the label
         */
        this.icon = '';
        /**
         * Spin property for the icon
         */
        this.iconSpin = false;
        /**
         * Fixed width property for the button
         * A fixed button will have full width of the parent container.
         */
        this.fixed = false;
        /**
         * A [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) after the label
         */
        this.iconAfter = '';
        /**
         * Spin property for the after icon
         */
        this.iconAfterSpin = false;
        this.focused = false;
        this.name = undefined;
        this.iconOnly = false;
        this.type = 'button';
        this.value = '';
        this._prevTabindex = 0;
        this._handleFocus = () => {
            this.focused = true;
        };
        this._handleBlur = () => {
            this.focused = false;
        };
        this.addEventListener('keydown', this._handleKeyDown.bind(this));
        this.addEventListener('click', this._handleClick.bind(this));
        this._internals = this.attachInternals();
    }
    connectedCallback() {
        super.connectedCallback();
        if (this.autofocus) {
            if (this.tabIndex < 0) {
                this.tabIndex = 0;
            }
            this.updateComplete.then(() => {
                this.focus();
                this.requestUpdate();
            });
        }
        this.addEventListener('focus', this._handleFocus);
        this.addEventListener('blur', this._handleBlur);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('focus', this._handleFocus);
        this.removeEventListener('blur', this._handleBlur);
    }
    update(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    changedProperties) {
        super.update(changedProperties);
        if (changedProperties.has('value')) {
            this._internals.setFormValue(this.value);
        }
        if (changedProperties.has('disabled')) {
            if (this.disabled) {
                // Save the original tabIndex, which may have been modified by the user.
                this._prevTabindex = this.tabIndex;
                // It's a native property, we don't care about re-rendering.
                // eslint-disable-next-line lit/no-property-change-update
                this.tabIndex = -1;
            }
            else {
                // eslint-disable-next-line lit/no-property-change-update
                this.tabIndex = this._prevTabindex;
            }
        }
    }
    _executeAction() {
        if (this.type === 'submit' && this._internals.form) {
            this._internals.form.requestSubmit();
        }
        if (this.type === 'reset' && this._internals.form) {
            this._internals.form.reset();
        }
    }
    _handleKeyDown(event) {
        if ((event.key === 'Enter' || event.key === ' ') &&
            !this.hasAttribute('disabled')) {
            const syntheticClick = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            });
            syntheticClick.synthetic = true;
            this.dispatchEvent(syntheticClick);
            this._executeAction();
        }
    }
    _handleClick(event) {
        if (event.synthetic) {
            return;
        }
        if (!this.hasAttribute('disabled')) {
            this._executeAction();
        }
    }
    render() {
        const hasIcon = this.icon !== '';
        const hasIconAfter = this.iconAfter !== '';
        const baseClasses = {
            base: true,
            'icon-only': this.iconOnly,
        };
        const iconElem = hasIcon
            ? html `<vscode-icon
          name=${this.icon}
          size=${this.size === 'small' ? 10.5 : 14}
          ?spin=${this.iconSpin}
          spin-duration=${ifDefined(this.iconSpinDuration)}
          class="icon"
        ></vscode-icon>`
            : nothing;
        const iconAfterElem = hasIconAfter
            ? html `<vscode-icon
          name=${this.iconAfter}
          size=${this.size === 'small' ? 10.5 : 14}
          ?spin=${this.iconAfterSpin}
          spin-duration=${ifDefined(this.iconAfterSpinDuration)}
          class="icon-after"
        ></vscode-icon>`
            : nothing;
        return html `
      <div class=${classMap(baseClasses)} part="base">
        ${iconElem} ${this.iconOnly ? nothing : html `<slot></slot>`}
        ${iconAfterElem}
      </div>
    `;
    }
};
VscodeButton.styles = styles;
/** @internal */
VscodeButton.formAssociated = true;
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeButton.prototype, "autofocus", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeButton.prototype, "tabIndex", void 0);
__decorate([
    property({ reflect: true, attribute: 'variant' })
], VscodeButton.prototype, "variant", void 0);
__decorate([
    property({ reflect: true })
], VscodeButton.prototype, "size", void 0);
__decorate([
    property({ reflect: true })
], VscodeButton.prototype, "role", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeButton.prototype, "disabled", void 0);
__decorate([
    property()
], VscodeButton.prototype, "icon", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'icon-spin' })
], VscodeButton.prototype, "iconSpin", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'fixed' })
], VscodeButton.prototype, "fixed", void 0);
__decorate([
    property({ type: Number, reflect: true, attribute: 'icon-spin-duration' })
], VscodeButton.prototype, "iconSpinDuration", void 0);
__decorate([
    property({ attribute: 'icon-after' })
], VscodeButton.prototype, "iconAfter", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'icon-after-spin' })
], VscodeButton.prototype, "iconAfterSpin", void 0);
__decorate([
    property({
        type: Number,
        reflect: true,
        attribute: 'icon-after-spin-duration',
    })
], VscodeButton.prototype, "iconAfterSpinDuration", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeButton.prototype, "focused", void 0);
__decorate([
    property({ type: String, reflect: true })
], VscodeButton.prototype, "name", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'icon-only' })
], VscodeButton.prototype, "iconOnly", void 0);
__decorate([
    property({ reflect: true })
], VscodeButton.prototype, "type", void 0);
__decorate([
    property()
], VscodeButton.prototype, "value", void 0);
VscodeButton = __decorate([
    customElement('vscode-button')
], VscodeButton);
export { VscodeButton };
//# sourceMappingURL=vscode-button.js.map