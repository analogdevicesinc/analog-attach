var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-collapsible.styles.js';
/**
 * Allows users to reveal or hide related content on a page.
 *
 * @tag vscode-collapsible
 *
 * @slot - Main content.
 * @slot actions - You can place any action icon in this slot in the header, but it's also possible to use any HTML element in it. It's only visible when the component is open.
 * @slot decorations - The elements placed in the decorations slot are always visible.
 *
 * @fires {VscCollapsibleToggleEvent} vsc-collapsible-toggle - Dispatched when the content visibility is changed.
 *
 * @cssprop [--vscode-sideBar-background=#181818] - Background color
 * @cssprop [--vscode-focusBorder=#0078d4] - Focus border color
 * @cssprop [--vscode-font-family=sans-serif] - Header font family
 * @cssprop [--vscode-sideBarSectionHeader-background=#181818] - Header background
 * @cssprop [--vscode-icon-foreground=#cccccc] - Arrow icon color
 * @cssprop [--vscode-sideBarTitle-foreground=#cccccc] - Header font color
 *
 * @csspart body - Container for the toggleable content of the component. The container's overflow content is hidden by default. This CSS part can serve as an escape hatch to modify this behavior.
 */
let VscodeCollapsible = class VscodeCollapsible extends VscElement {
    constructor() {
        super(...arguments);
        /**
         * When enabled, header actions are always visible; otherwise, they appear only when the cursor
         * hovers over the component. Actions are shown only when the Collapsible component is open. This
         * property is designed to use the `workbench.view.alwaysShowHeaderActions` setting.
         */
        this.alwaysShowHeaderActions = false;
        /**
         * Component heading text
         *
         * @deprecated The `title` is a global HTML attribute and will unintentionally trigger a native
         * tooltip on the component. Use the `heading` property instead.
         */
        this.title = '';
        /**
         * Heading text.
         */
        this.heading = '';
        /** Less prominent text in the header. */
        this.description = '';
        this.open = false;
    }
    _emitToggleEvent() {
        this.dispatchEvent(new CustomEvent('vsc-collapsible-toggle', {
            detail: { open: this.open },
        }));
    }
    _onHeaderClick() {
        this.open = !this.open;
        this._emitToggleEvent();
    }
    _onHeaderKeyDown(event) {
        if (event.key === 'Enter') {
            this.open = !this.open;
            this._emitToggleEvent();
        }
    }
    render() {
        const classes = { collapsible: true, open: this.open };
        const actionsClasses = {
            actions: true,
            'always-visible': this.alwaysShowHeaderActions,
        };
        const heading = this.heading ? this.heading : this.title;
        const icon = html `<svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      class="header-icon"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M10.072 8.024L5.715 3.667l.618-.62L11 7.716v.618L6.333 13l-.618-.619 4.357-4.357z"
      />
    </svg>`;
        const descriptionMarkup = this.description
            ? html `<span class="description">${this.description}</span>`
            : nothing;
        return html `
      <div class=${classMap(classes)}>
        <div
          class="collapsible-header"
          tabindex="0"
          @click=${this._onHeaderClick}
          @keydown=${this._onHeaderKeyDown}
        >
          ${icon}
          <h3 class="title">${heading}${descriptionMarkup}</h3>
          <div class="header-slots">
            <div class=${classMap(actionsClasses)}>
              <slot name="actions"></slot>
            </div>
            <div class="decorations"><slot name="decorations"></slot></div>
          </div>
        </div>
        <div class="collapsible-body" part="body">
          <slot></slot>
        </div>
      </div>
    `;
    }
};
VscodeCollapsible.styles = styles;
__decorate([
    property({
        type: Boolean,
        reflect: true,
        attribute: 'always-show-header-actions',
    })
], VscodeCollapsible.prototype, "alwaysShowHeaderActions", void 0);
__decorate([
    property({ type: String })
], VscodeCollapsible.prototype, "title", void 0);
__decorate([
    property()
], VscodeCollapsible.prototype, "heading", void 0);
__decorate([
    property()
], VscodeCollapsible.prototype, "description", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeCollapsible.prototype, "open", void 0);
VscodeCollapsible = __decorate([
    customElement('vscode-collapsible')
], VscodeCollapsible);
export { VscodeCollapsible };
//# sourceMappingURL=vscode-collapsible.js.map