import { PropertyPart } from 'lit';
import { Directive, PartInfo } from 'lit/directive.js';
declare class StylePropertyMap extends Directive {
    private _prevProperties;
    constructor(partInfo: PartInfo);
    update(part: PropertyPart, [styleProps]: [{
        [key: string]: string;
    }]): unknown;
    render(_styleProps: Partial<CSSStyleDeclaration | {
        [key: string]: string;
    }>): symbol;
}
/**
 * Implement a Lit directive similar to styleMap, but instead of setting styles via the style
 * attribute (which violates CSP), it should apply styles using the style property.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy#unsafe-inline)
 */
export declare const stylePropertyMap: (_styleProps: Partial<CSSStyleDeclaration | {
    [key: string]: string;
}>) => import("lit-html/directive.js").DirectiveResult<typeof StylePropertyMap>;
export {};
//# sourceMappingURL=style-property-map.d.ts.map