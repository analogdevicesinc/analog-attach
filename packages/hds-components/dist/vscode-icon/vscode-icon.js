var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var VscodeIcon_1;
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
import styles from './vscode-icon.styles.js';
// Encoded SVGs
import expandIcon from './hds-icons/expand.js';
import collapseIcon from './hds-icons/collapse.js';
import settingsBarsIcon from './hds-icons/settings-bars.js';
// Map HDS icon names to their SVG paths
const HDS_ICONS = {
    'hds-expand': expandIcon,
    'hds-collapse': collapseIcon,
    'hds-settings-bars': settingsBarsIcon,
};
/**
 * Display a [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html).
 * In "action-icon" mode it behaves like a button. In this case, it is
 * recommended that a meaningful label is specified with the `label` property.
 *
 * @tag vscode-icon
 *
 * @cssprop [--vscode-icon-foreground=#cccccc]
 * @cssprop [--vscode-toolbar-hoverBackground=rgba(90, 93, 94, 0.31)] - Hover state background color in `active-icon` mode
 * @cssprop [--vscode-toolbar-activeBackground=rgba(99, 102, 103, 0.31)] - Active state background color in `active-icon` mode
 * @cssprop [--vscode-focusBorder=#0078d4]
 * @cssprop [--icon-mask] - Custom icon mask image (when using custom icons)
 */
let VscodeIcon = VscodeIcon_1 = class VscodeIcon extends VscElement {
    constructor() {
        super(...arguments);
        /**
         * Set a meaningful label in `action-icon` mode for the screen readers
         */
        this.label = '';
        /**
         * [Codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) icon name or HDS custom icon name.
         */
        this.name = 'empty';
        /**
         * Icon size in pixels
         */
        this.size = 16;
        /**
         * Enable rotation animation
         */
        this.spin = false;
        /**
         * Animation duration in seconds
         */
        this.spinDuration = 1.5;
        /**
         * Behaves like a button
         */
        this.actionIcon = false;
        /**
         * Use custom icon via CSS custom property (--icon-mask)
         */
        this.custom = false;
        this._onButtonClick = (ev) => {
            this.dispatchEvent(new CustomEvent('vsc-click', { detail: { originalEvent: ev } }));
        };
    }
    connectedCallback() {
        super.connectedCallback();
        const { href, nonce } = this._getStylesheetConfig();
        VscodeIcon_1.stylesheetHref = href;
        VscodeIcon_1.nonce = nonce;
    }
    /**
     * Check if the icon name is an HDS custom icon
     */
    _isHdsIcon() {
        return this.name in HDS_ICONS;
    }
    /**
     * Get the SVG path for HDS icons
     */
    _getHdsSvgPath() {
        return HDS_ICONS[this.name];
    }
    /**
     * For using web fonts in web components, the font stylesheet must be included
     * twice: on the page and in the web component. This function looks for the
     * font stylesheet on the page and returns the stylesheet URL and the nonce
     * id.
     */
    _getStylesheetConfig() {
        const linkElement = document.getElementById('vscode-codicon-stylesheet');
        const href = linkElement?.getAttribute('href') || undefined;
        const nonce = linkElement?.nonce || undefined;
        if (!linkElement) {
            let msg = '[VSCode Elements] To use the Icon component, the codicons.css file must be included in the page with the id `vscode-codicon-stylesheet`! ';
            msg +=
                'See https://vscode-elements.github.io/components/icon/ for more details.';
            // eslint-disable-next-line no-console
            console.warn(msg);
        }
        return { nonce, href };
    }
    render() {
        const { stylesheetHref, nonce } = VscodeIcon_1;
        // Auto-detect if this is an HDS icon or custom icon prop is set
        const isCustomIcon = this.custom || this._isHdsIcon();
        const hdsSvgPath = this._getHdsSvgPath();
        const content = html `<span
      class=${classMap({
            codicon: !isCustomIcon,
            ['codicon-' + this.name]: !isCustomIcon,
            'custom-icon': isCustomIcon,
            spin: this.spin,
        })}
      .style=${stylePropertyMap({
            animationDuration: String(this.spinDuration) + 's',
            fontSize: this.size + 'px',
            height: this.size + 'px',
            width: this.size + 'px',
            // Add --icon-mask for HDS icons
            ...(hdsSvgPath ? { '--icon-mask': `url('${hdsSvgPath}')` } : {}),
        })}
    ></span>`;
        const wrapped = this.actionIcon
            ? html ` <button
          class="button"
          @click=${this._onButtonClick}
          aria-label=${this.label}
        >
          ${content}
        </button>`
            : html ` <span class="icon" aria-hidden="true" role="presentation"
          >${content}</span
        >`;
        return html `
      ${isCustomIcon
            ? ''
            : html `<link
            rel="stylesheet"
            href=${ifDefined(stylesheetHref)}
            nonce=${ifDefined(nonce)}
          >`}
      ${wrapped}
    `;
    }
};
VscodeIcon.styles = styles;
VscodeIcon.stylesheetHref = '';
VscodeIcon.nonce = '';
__decorate([
    property()
], VscodeIcon.prototype, "label", void 0);
__decorate([
    property({ type: String })
], VscodeIcon.prototype, "name", void 0);
__decorate([
    property({ type: Number })
], VscodeIcon.prototype, "size", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeIcon.prototype, "spin", void 0);
__decorate([
    property({ type: Number, attribute: 'spin-duration' })
], VscodeIcon.prototype, "spinDuration", void 0);
__decorate([
    property({ type: Boolean, reflect: true, attribute: 'action-icon' })
], VscodeIcon.prototype, "actionIcon", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeIcon.prototype, "custom", void 0);
VscodeIcon = VscodeIcon_1 = __decorate([
    customElement('vscode-icon')
], VscodeIcon);
export { VscodeIcon };
//# sourceMappingURL=vscode-icon.js.map