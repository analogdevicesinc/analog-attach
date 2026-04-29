import hdsSpacingStyles from './hds-spacing.styles.js';
import hdsBordersStyles from './hds-borders.styles.js';
import hdsColorsStyles from './hds-colors.styles.js';
import hdsElevationStyles from './hds-elevation.styles.js';
/**
 * Harmonic Design System - CSS Export Utilities
 *
 * This file provides CSS exports in multiple formats for use in React projects,
 * SCSS files, or any other CSS-in-JS solution.
 */
/**
 * Convert Lit CSS template to plain CSS string, replacing :host with :root
 */
function litCssToString(litCss) {
    return litCss.cssText.replace(/:host/g, ':root');
}
/**
 * Individual CSS token exports
 */
export const spacingCSS = litCssToString(hdsSpacingStyles);
export const bordersCSS = litCssToString(hdsBordersStyles);
export const colorsCSS = litCssToString(hdsColorsStyles);
export const elevationCSS = litCssToString(hdsElevationStyles);
/**
 * Combined CSS for all design tokens
 * Perfect for importing into React projects or SCSS files
 */
export const allTokensCSS = [
    spacingCSS,
    bordersCSS,
    colorsCSS,
    elevationCSS,
].join('\n\n');
// Re-export the original Lit CSS for internal component use
export { hdsSpacingStyles, hdsBordersStyles, hdsColorsStyles, hdsElevationStyles, };
//# sourceMappingURL=design-tokens.js.map