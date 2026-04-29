// Borrowed from Shoelace
import { sendMouse } from '@web/test-runner-commands';
function determineMousePosition(el, position, offsetX, offsetY) {
    const { x, y, width, height } = el.getBoundingClientRect();
    const centerX = Math.floor(x + window.scrollX + width / 2);
    const centerY = Math.floor(y + window.scrollY + height / 2);
    let clickX;
    let clickY;
    switch (position) {
        case 'top':
            clickX = centerX;
            clickY = y;
            break;
        case 'right':
            clickX = x + width - 1;
            clickY = centerY;
            break;
        case 'bottom':
            clickX = centerX;
            clickY = y + height - 1;
            break;
        case 'left':
            clickX = x;
            clickY = centerY;
            break;
        default:
            clickX = centerX;
            clickY = centerY;
    }
    clickX += offsetX;
    clickY += offsetY;
    return { clickX, clickY };
}
/** A testing utility that measures an element's position and clicks on it. */
export async function clickOnElement(
/** The element to click */
el, 
/** The location of the element to click */
position = 'center', 
/** The horizontal offset to apply to the position when clicking */
offsetX = 0, 
/** The vertical offset to apply to the position when clicking */
offsetY = 0) {
    const { clickX, clickY } = determineMousePosition(el, position, offsetX, offsetY);
    await sendMouse({ type: 'click', position: [clickX, clickY] });
}
/** A testing utility that moves the mouse onto an element. */
export async function moveMouseOnElement(
/** The element to click */
el, 
/** The location of the element to click */
position = 'center', 
/** The horizontal offset to apply to the position when clicking */
offsetX = 0, 
/** The vertical offset to apply to the position when clicking */
offsetY = 0) {
    const { clickX, clickY } = determineMousePosition(el, position, offsetX, offsetY);
    await sendMouse({ type: 'move', position: [clickX, clickY] });
}
/** A testing utility that drags an element with the mouse. */
export async function dragElement(
/** The element to drag */
el, 
/** The horizontal distance to drag in pixels */
deltaX = 0, 
/** The vertical distance to drag in pixels */
deltaY = 0, callbacks = {}) {
    await moveMouseOnElement(el);
    await sendMouse({ type: 'down' });
    await callbacks.afterMouseDown?.();
    const { clickX, clickY } = determineMousePosition(el, 'center', deltaX, deltaY);
    await sendMouse({ type: 'move', position: [clickX, clickY] });
    await callbacks.afterMouseMove?.();
    await sendMouse({ type: 'up' });
}
export function $(arg1, arg2) {
    let result;
    if (typeof arg1 === 'string') {
        result = document.querySelector(arg1);
    }
    else if ((arg1 instanceof Element || arg1 instanceof ShadowRoot) &&
        typeof arg2 === 'string') {
        result = arg1.querySelector(arg2);
    }
    else {
        throw new Error('Invalid arguments passed to $()');
    }
    if (!result) {
        const selector = typeof arg1 === 'string' ? arg1 : arg2;
        const context = typeof arg1 === 'string' ? 'document' : 'root element';
        throw new Error(`No match for selector: ${selector} in ${context}`);
    }
    return result;
}
export function $$(arg1, arg2) {
    let result;
    if (typeof arg1 === 'string') {
        result = document.querySelectorAll(arg1);
    }
    else if ((arg1 instanceof Element || arg1 instanceof ShadowRoot) &&
        typeof arg2 === 'string') {
        result = arg1.querySelectorAll(arg2);
    }
    else {
        throw new Error('Invalid arguments passed to $$()');
    }
    if (result.length === 0) {
        const selector = typeof arg1 === 'string' ? arg1 : arg2;
        const context = typeof arg1 === 'string' ? 'document' : 'root element';
        throw new Error(`No matches for selector: ${selector} in ${context}`);
    }
    return result;
}
//# sourceMappingURL=test-helpers.js.map