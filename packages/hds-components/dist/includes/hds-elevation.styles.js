import { css } from 'lit';
/**
 * Harmonic Design System - Elevation CSS Variables
 *
 * Provides consistent elevation (shadow) system across all components.
 * Automatically adjusts shadow opacity based on theme preference.
 */
export default css `
  :host {
    /* Base elevation shadows with theme-aware opacity */
    --hmc-shadow: rgba(0, 0, 0, 0.16);
    /** Tooltip z-index */
    --hmc-tooltip-z-index: 1000;
  }

  /* Dark theme - higher opacity for better visibility */
  @media (prefers-color-scheme: dark) {
    :host {
      --hmc-shadow: rgba(0, 0, 0, 0.36);
    }
  }

  /* Light theme - lower opacity for subtlety */
  @media (prefers-color-scheme: light) {
    :host {
      --hmc-shadow: rgba(0, 0, 0, 0.16);
    }
  }
`;
//# sourceMappingURL=hds-elevation.styles.js.map