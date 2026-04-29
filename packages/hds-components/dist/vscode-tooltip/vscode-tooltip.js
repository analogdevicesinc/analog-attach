var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-tooltip.styles.js';
/**
 * A tooltip component that displays a label on hover over its children.
 * The tooltip wraps its children and shows the tooltip text when hovered.
 * Can also be set to active mode for always-visible tooltips.
 *
 * @tag vscode-tooltip
 *
 * @slot - The content that will trigger the tooltip on hover.
 * @slot tooltip - Custom content to display in the tooltip. Takes precedence over the label property.
 *
 * @cssprop [--vscode-tooltip-background=#1e1e1e] - Tooltip background color
 * @cssprop [--vscode-tooltip-foreground=#cccccc] - Tooltip text color
 * @cssprop [--vscode-tooltip-border=#454545] - Tooltip border color
 * @cssprop [--vscode-font-family=sans-serif] - Font family
 * @cssprop [--vscode-font-size=12px] - Font size
 * @cssprop [--vscode-tooltip-maxWidth=320px] - Maximum width of tooltip
 * @cssprop [--vscode-tooltip-zIndex=1000] - Z-index for tooltip positioning
 * @cssprop [--vscode-focusBorder=#0078d4] - Border color for active tooltips
 *
 * @csspart tooltip - The tooltip container element
 * @csspart content - The wrapped content element
 */
let VscodeTooltip = class VscodeTooltip extends VscElement {
    constructor() {
        super(...arguments);
        /**
         * The text to display in the tooltip
         */
        this.label = '';
        /**
         * Position of the tooltip relative to the trigger element
         */
        this.position = 'top';
        /**
         * Delay in milliseconds before showing the tooltip
         */
        this.showDelay = 500;
        /**
         * Delay in milliseconds before hiding the tooltip
         */
        this.hideDelay = 0;
        /**
         * Disable the tooltip
         */
        this.disabled = false;
        /**
         * Keep the tooltip always visible (overrides hover/focus behavior)
         */
        this.active = false;
        this._visible = false;
        this._showTimeout = null;
        this._hideTimeout = null;
        this._handleMouseEnter = () => {
            this._showTooltip();
        };
        this._handleMouseLeave = () => {
            this._hideTooltip();
        };
        this._handleFocus = () => {
            this._showTooltip();
        };
        this._handleBlur = () => {
            this._hideTooltip();
        };
    }
    connectedCallback() {
        super.connectedCallback();
        this.addEventListener('mouseenter', this._handleMouseEnter);
        this.addEventListener('mouseleave', this._handleMouseLeave);
        this.addEventListener('focus', this._handleFocus);
        this.addEventListener('blur', this._handleBlur);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener('mouseenter', this._handleMouseEnter);
        this.removeEventListener('mouseleave', this._handleMouseLeave);
        this.removeEventListener('focus', this._handleFocus);
        this.removeEventListener('blur', this._handleBlur);
        this._clearTimeouts();
    }
    willUpdate(changedProperties) {
        super.willUpdate(changedProperties);
        // Handle active property changes
        if (changedProperties.has('active')) {
            const wasActive = changedProperties.get('active');
            if (this.active && !this.disabled && this._hasTooltipContent()) {
                // Show tooltip immediately when active becomes true
                this._clearTimeouts();
                this._visible = true;
            }
            else if (!this.active && wasActive) {
                // When active becomes false, hide immediately without delays
                this._clearTimeouts();
                this._visible = false;
            }
        }
        // Handle disabled property changes
        if (changedProperties.has('disabled')) {
            if (this.disabled) {
                this._clearTimeouts();
                this._visible = false;
            }
            else if (this.active && this._hasTooltipContent()) {
                this._visible = true;
            }
        }
    }
    _clearTimeouts() {
        if (this._showTimeout !== null) {
            window.clearTimeout(this._showTimeout);
            this._showTimeout = null;
        }
        if (this._hideTimeout !== null) {
            window.clearTimeout(this._hideTimeout);
            this._hideTimeout = null;
        }
    }
    _hasTooltipContent() {
        // Check if there's slotted content by looking at the light DOM
        const hasSlottedContent = this.querySelector('[slot="tooltip"]') !== null;
        return hasSlottedContent || this.label.trim() !== '';
    }
    _showTooltip() {
        if (this.disabled || !this._hasTooltipContent()) {
            return;
        }
        // If active, tooltip is always visible, no need for delays
        if (this.active) {
            this._visible = true;
            return;
        }
        this._clearTimeouts();
        this._showTimeout = window.setTimeout(() => {
            this._visible = true;
            this._showTimeout = null;
        }, this.showDelay);
    }
    _hideTooltip() {
        // If active, don't hide the tooltip
        if (this.active) {
            return;
        }
        this._clearTimeouts();
        if (this.hideDelay > 0) {
            this._hideTimeout = window.setTimeout(() => {
                this._visible = false;
                this._hideTimeout = null;
            }, this.hideDelay);
        }
        else {
            this._visible = false;
        }
    }
    render() {
        const tooltipClasses = {
            tooltip: true,
            visible: this._visible,
            active: this.active,
            [this.position]: true,
        };
        const hasTooltipContent = this._hasTooltipContent();
        return html `
      <div class="wrapper" part="content">
        <slot></slot>
        ${hasTooltipContent && !this.disabled
            ? html `
              <div
                class=${classMap(tooltipClasses)}
                part="tooltip"
                role="tooltip"
                aria-hidden=${this._visible ? 'false' : 'true'}
              >
                <slot name="tooltip">${this.label}</slot>
              </div>
            `
            : nothing}
      </div>
    `;
    }
};
VscodeTooltip.styles = styles;
__decorate([
    property()
], VscodeTooltip.prototype, "label", void 0);
__decorate([
    property()
], VscodeTooltip.prototype, "position", void 0);
__decorate([
    property({ type: Number, attribute: 'show-delay' })
], VscodeTooltip.prototype, "showDelay", void 0);
__decorate([
    property({ type: Number, attribute: 'hide-delay' })
], VscodeTooltip.prototype, "hideDelay", void 0);
__decorate([
    property({ type: Boolean })
], VscodeTooltip.prototype, "disabled", void 0);
__decorate([
    property({ type: Boolean })
], VscodeTooltip.prototype, "active", void 0);
__decorate([
    state()
], VscodeTooltip.prototype, "_visible", void 0);
__decorate([
    state()
], VscodeTooltip.prototype, "_showTimeout", void 0);
__decorate([
    state()
], VscodeTooltip.prototype, "_hideTimeout", void 0);
VscodeTooltip = __decorate([
    customElement('vscode-tooltip')
], VscodeTooltip);
export { VscodeTooltip };
//# sourceMappingURL=vscode-tooltip.js.map