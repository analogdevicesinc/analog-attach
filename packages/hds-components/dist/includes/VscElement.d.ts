import { LitElement } from 'lit';
export declare class VscElement extends LitElement {
    /** VSCode Elements version */
    get version(): string;
}
type CustomElementClass = Omit<typeof HTMLElement, 'new'>;
export type Constructor<T> = {
    new (...args: any[]): T;
};
/**
 * Own implementation of Lit's customElement decorator.
 */
export declare const customElement: (tagName: string) => (classOrTarget: CustomElementClass) => void;
export {};
//# sourceMappingURL=VscElement.d.ts.map