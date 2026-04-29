var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-progress-bar.styles.js';
import { classMap } from 'lit/directives/class-map.js';
import { stylePropertyMap } from '../includes/style-property-map.js';
/**
 * @tag vscode-progress-bar
 *
 * @cssprop [--vscode-progressBar-background=#0078d4]
 */
let VscodeProgressBar = class VscodeProgressBar extends VscElement {
    constructor() {
        super(...arguments);
        /**
         * @internal
         */
        this.ariaLabel = 'Loading';
        /**
         * Maximum value for determinate mode.
         */
        this.max = 100;
        /**
         * Force indeterminate mode even if value is set.
         */
        this.indeterminate = false;
        /**
         * Switch to a gentler animation after this many ms in indeterminate mode.
         */
        this.longRunningThreshold = 15000;
        this._longRunning = false;
    }
    get _isDeterminate() {
        return (!this.indeterminate &&
            typeof this.value === 'number' &&
            isFinite(this.value));
    }
    connectedCallback() {
        super.connectedCallback();
        this._maybeStartLongRunningTimer();
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this._clearLongRunningTimer();
    }
    willUpdate() {
        this._maybeStartLongRunningTimer();
    }
    render() {
        const max = this.max > 0 ? this.max : 100;
        const clamped = this._isDeterminate
            ? Math.min(Math.max(this.value ?? 0, 0), max)
            : 0;
        const percent = this._isDeterminate ? (clamped / max) * 100 : 0;
        const containerClasses = {
            container: true,
            discrete: this._isDeterminate,
            infinite: !this._isDeterminate,
            'infinite-long-running': this._longRunning && !this._isDeterminate,
        };
        return html `
      <div
        class=${classMap(containerClasses)}
        part="container"
        role="progressbar"
        aria-label=${this.ariaLabel}
        aria-valuemin="0"
        aria-valuemax=${String(max)}
        aria-valuenow=${ifDefined(this._isDeterminate ? String(Math.round(clamped)) : undefined)}
      >
        <div class="track" part="track"></div>
        <div
          class="indicator"
          part="indicator"
          .style=${stylePropertyMap({
            width: this._isDeterminate ? `${percent}%` : undefined,
        })}
        ></div>
      </div>
    `;
    }
    _maybeStartLongRunningTimer() {
        const shouldRun = !this._isDeterminate && this.longRunningThreshold > 0 && this.isConnected;
        if (!shouldRun) {
            this._clearLongRunningTimer();
            this._longRunning = false;
            return;
        }
        if (this._longRunningHandle) {
            return; // already scheduled
        }
        this._longRunningHandle = setTimeout(() => {
            this._longRunning = true;
            this._longRunningHandle = undefined;
            this.requestUpdate();
        }, this.longRunningThreshold);
    }
    _clearLongRunningTimer() {
        if (this._longRunningHandle) {
            clearTimeout(this._longRunningHandle);
            this._longRunningHandle = undefined;
        }
    }
};
VscodeProgressBar.styles = styles;
__decorate([
    property({ reflect: true, attribute: 'aria-label' })
], VscodeProgressBar.prototype, "ariaLabel", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeProgressBar.prototype, "value", void 0);
__decorate([
    property({ type: Number, reflect: true })
], VscodeProgressBar.prototype, "max", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeProgressBar.prototype, "indeterminate", void 0);
__decorate([
    property({ type: Number, attribute: 'long-running-threshold' })
], VscodeProgressBar.prototype, "longRunningThreshold", void 0);
__decorate([
    state()
], VscodeProgressBar.prototype, "_longRunning", void 0);
VscodeProgressBar = __decorate([
    customElement('vscode-progress-bar')
], VscodeProgressBar);
export { VscodeProgressBar };
//# sourceMappingURL=vscode-progress-bar.js.map