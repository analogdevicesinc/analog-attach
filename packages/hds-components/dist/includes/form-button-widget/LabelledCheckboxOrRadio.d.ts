import { LitElement, TemplateResult } from 'lit';
type Constructor<T = unknown> = new (...args: any[]) => T;
export declare class LabelledCheckboxOrRadioInterface {
    label: string;
    description: string;
    protected _handleSlotChange(): void;
    protected _renderLabelAttribute(): TemplateResult;
    protected _renderDescription(): TemplateResult;
}
export declare const LabelledCheckboxOrRadioMixin: <T extends Constructor<LitElement>>(superClass: T) => Constructor<LabelledCheckboxOrRadioInterface> & T;
export {};
//# sourceMappingURL=LabelledCheckboxOrRadio.d.ts.map