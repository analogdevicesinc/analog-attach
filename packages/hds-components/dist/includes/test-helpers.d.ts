/** A testing utility that measures an element's position and clicks on it. */
export declare function clickOnElement(
/** The element to click */
el: Element, 
/** The location of the element to click */
position?: 'top' | 'right' | 'bottom' | 'left' | 'center', 
/** The horizontal offset to apply to the position when clicking */
offsetX?: number, 
/** The vertical offset to apply to the position when clicking */
offsetY?: number): Promise<void>;
/** A testing utility that moves the mouse onto an element. */
export declare function moveMouseOnElement(
/** The element to click */
el: Element, 
/** The location of the element to click */
position?: 'top' | 'right' | 'bottom' | 'left' | 'center', 
/** The horizontal offset to apply to the position when clicking */
offsetX?: number, 
/** The vertical offset to apply to the position when clicking */
offsetY?: number): Promise<void>;
/** A testing utility that drags an element with the mouse. */
export declare function dragElement(
/** The element to drag */
el: Element, 
/** The horizontal distance to drag in pixels */
deltaX?: number, 
/** The vertical distance to drag in pixels */
deltaY?: number, callbacks?: {
    afterMouseDown?: () => void | Promise<void>;
    afterMouseMove?: () => void | Promise<void>;
}): Promise<void>;
type AllTagNames = keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap;
type TagNameToElement<K extends AllTagNames> = K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] : K extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[K] : Element;
export declare function $<K extends AllTagNames>(selector: K): TagNameToElement<K>;
export declare function $<K extends AllTagNames>(root: Element | ShadowRoot, selector: K): TagNameToElement<K>;
export declare function $<T extends Element = Element>(selector: string): T;
export declare function $<T extends Element = Element>(root: Element | ShadowRoot, selector: string): T;
export declare function $$<K extends AllTagNames>(selector: K): NodeListOf<TagNameToElement<K>>;
export declare function $$<K extends AllTagNames>(root: Element | ShadowRoot, selector: K): NodeListOf<TagNameToElement<K>>;
export declare function $$<T extends Element = Element>(selector: string): NodeListOf<T>;
export declare function $$<T extends Element = Element>(root: Element | ShadowRoot, selector: string): NodeListOf<T>;
export {};
//# sourceMappingURL=test-helpers.d.ts.map