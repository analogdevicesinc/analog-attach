import { css } from 'lit';
import hdsSpacingStyles from './hds-spacing.styles.js';
import hdsBordersStyles from './hds-borders.styles.js';
import hdsColorsStyles from './hds-colors.styles.js';
import hdsElevationStyles from './hds-elevation.styles.js';
export default [
    hdsSpacingStyles,
    hdsBordersStyles,
    hdsColorsStyles,
    hdsElevationStyles,
    css `
    :host([hidden]) {
      display: none;
    }

    :host([disabled]),
    :host(:disabled) {
      cursor: not-allowed;
      opacity: 0.4;
      pointer-events: none;
    }
  `,
];
//# sourceMappingURL=default.styles.js.map