import { VscElement } from '../VscElement.js';
export declare class FormButtonWidgetBase extends VscElement {
    focused: boolean;
    constructor();
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(name: string, oldVal: string, newVal: string): void;
    private _prevTabindex;
    private _handleFocus;
    private _handleBlur;
}
//# sourceMappingURL=FormButtonWidgetBase.d.ts.map