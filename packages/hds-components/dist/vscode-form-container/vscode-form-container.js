var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { html } from 'lit';
import { property, query, queryAssignedElements } from 'lit/decorators.js';
import { customElement, VscElement } from '../includes/VscElement.js';
import styles from './vscode-form-container.styles.js';
var FormGroupLayout;
(function (FormGroupLayout) {
    FormGroupLayout["HORIZONTAL"] = "horizontal";
    FormGroupLayout["VERTICAL"] = "vertical";
})(FormGroupLayout || (FormGroupLayout = {}));
/**
 * @tag vscode-form-container
 */
let VscodeFormContainer = class VscodeFormContainer extends VscElement {
    constructor() {
        super(...arguments);
        this.breakpoint = 490;
        this._responsive = false;
        this._firstUpdateComplete = false;
        this._resizeObserverCallbackBound = this._resizeObserverCallback.bind(this);
    }
    set responsive(isResponsive) {
        this._responsive = isResponsive;
        if (this._firstUpdateComplete) {
            if (isResponsive) {
                this._activateResponsiveLayout();
            }
            else {
                this._deactivateResizeObserver();
            }
        }
    }
    get responsive() {
        return this._responsive;
    }
    _toggleCompactLayout(layout) {
        this._assignedFormGroups.forEach((group) => {
            if (!group.dataset.originalVariant) {
                group.dataset.originalVariant = group.variant;
            }
            const oVariant = group.dataset.originalVariant;
            if (layout === FormGroupLayout.VERTICAL && oVariant === 'horizontal') {
                group.variant = 'vertical';
            }
            else {
                group.variant = oVariant;
            }
            const checkboxOrRadioGroup = group.querySelectorAll('vscode-checkbox-group, vscode-radio-group');
            checkboxOrRadioGroup.forEach((widgetGroup) => {
                if (!widgetGroup.dataset.originalVariant) {
                    widgetGroup.dataset.originalVariant = widgetGroup.variant;
                }
                const originalVariant = widgetGroup.dataset.originalVariant;
                if (layout === FormGroupLayout.HORIZONTAL &&
                    originalVariant === FormGroupLayout.HORIZONTAL) {
                    widgetGroup.variant = 'horizontal';
                }
                else {
                    widgetGroup.variant = 'vertical';
                }
            });
        });
    }
    _resizeObserverCallback(entries) {
        let wrapperWidth = 0;
        for (const entry of entries) {
            wrapperWidth = entry.contentRect.width;
        }
        const nextLayout = wrapperWidth < this.breakpoint
            ? FormGroupLayout.VERTICAL
            : FormGroupLayout.HORIZONTAL;
        if (nextLayout !== this._currentFormGroupLayout) {
            this._toggleCompactLayout(nextLayout);
            this._currentFormGroupLayout = nextLayout;
        }
    }
    _activateResponsiveLayout() {
        this._resizeObserver = new ResizeObserver(this._resizeObserverCallbackBound);
        this._resizeObserver.observe(this._wrapperElement);
    }
    _deactivateResizeObserver() {
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
    }
    firstUpdated() {
        this._firstUpdateComplete = true;
        if (this._responsive) {
            this._activateResponsiveLayout();
        }
    }
    render() {
        return html `
      <div class="wrapper">
        <slot></slot>
      </div>
    `;
    }
};
VscodeFormContainer.styles = styles;
__decorate([
    property({ type: Boolean, reflect: true })
], VscodeFormContainer.prototype, "responsive", null);
__decorate([
    property({ type: Number })
], VscodeFormContainer.prototype, "breakpoint", void 0);
__decorate([
    query('.wrapper')
], VscodeFormContainer.prototype, "_wrapperElement", void 0);
__decorate([
    queryAssignedElements({ selector: 'vscode-form-group' })
], VscodeFormContainer.prototype, "_assignedFormGroups", void 0);
VscodeFormContainer = __decorate([
    customElement('vscode-form-container')
], VscodeFormContainer);
export { VscodeFormContainer };
//# sourceMappingURL=vscode-form-container.js.map