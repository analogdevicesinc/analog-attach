import { noChange } from 'lit';
import { Directive, directive, PartType } from 'lit/directive.js';
class StylePropertyMap extends Directive {
    constructor(partInfo) {
        super(partInfo);
        this._prevProperties = {};
        if (partInfo.type !== PartType.PROPERTY || partInfo.name !== 'style') {
            throw new Error('The `stylePropertyMap` directive must be used in the `style` property');
        }
    }
    update(part, [styleProps]) {
        Object.entries(styleProps).forEach(([key, val]) => {
            if (this._prevProperties[key] !== val) {
                if (key.startsWith('--')) {
                    part.element.style.setProperty(key, val);
                }
                else {
                    // @ts-expect-error I'm so sick of these stupid unresolvable TS errors.
                    part.element.style[key] = val;
                }
                this._prevProperties[key] = val;
            }
        });
        return noChange;
    }
    render(_styleProps) {
        return noChange;
    }
}
/**
 * Implement a Lit directive similar to styleMap, but instead of setting styles via the style
 * attribute (which violates CSP), it should apply styles using the style property.
 *
 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy#unsafe-inline)
 */
export const stylePropertyMap = directive(StylePropertyMap);
//# sourceMappingURL=style-property-map.js.map