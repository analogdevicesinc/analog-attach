import { css } from 'lit';
import defaultStyles from '../includes/default.styles.js';
const styles = [
    defaultStyles,
    css `
    :host {
      display: inline-block;
      position: relative;
    }

    .wrapper {
      display: inline-block;
      position: relative;
    }

    .tooltip {
      opacity: 0;
      visibility: hidden;
      transform: scale(0.8);
      transition:
        opacity 0.15s ease-in-out,
        visibility 0.15s ease-in-out,
        transform 0.15s ease-in-out;
      pointer-events: none;
      position: absolute;
      z-index: var(--hmc-tooltip-z-index);

      /* Layout */
      display: flex;
      padding: var(--hmc-space-2) var(--hmc-space-3);
      flex-direction: column;
      align-items: flex-start;
      gap: var(--hmc-space-3);

      /* Styling */
      border-radius: var(--hmc-border-radius-1);
      border: var(--hmc-border-width-1) solid var(--vscode-editorWidget-border);
      background: var(--vscode-editorWidget-background);

      /* Elevation */
      box-shadow: 0 2px 16px 0 var(--hmc-shadow);
    }

    .tooltip.visible {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
    }

    /* Active tooltip styling - always visible with subtle visual distinction */
    .tooltip.active {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
    }

    /* Position: top (default) */
    .tooltip.top {
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%) scale(0.8);
      margin-bottom: 8px;
    }

    .tooltip.top.visible {
      transform: translateX(-50%) scale(1);
    }

    .tooltip.top::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      margin-left: -4px;
      border: 4px solid transparent;
      border-top-color: var(--vscode-editorWidget-background);
    }

    /* Position: bottom */
    .tooltip.bottom {
      top: 100%;
      left: 50%;
      transform: translateX(-50%) scale(0.8);
      margin-top: 8px;
    }

    .tooltip.bottom.visible {
      transform: translateX(-50%) scale(1);
    }

    .tooltip.bottom::after {
      content: '';
      position: absolute;
      bottom: 100%;
      left: 50%;
      margin-left: -4px;
      border: 4px solid transparent;
      border-bottom-color: var(--vscode-editorWidget-background);
    }

    /* Position: left */
    .tooltip.left {
      right: 100%;
      top: 50%;
      transform: translateY(-50%) scale(0.8);
      margin-right: 8px;
    }

    .tooltip.left.visible {
      transform: translateY(-50%) scale(1);
    }

    .tooltip.left::after {
      content: '';
      position: absolute;
      left: 100%;
      top: 50%;
      margin-top: -4px;
      border: 4px solid transparent;
      border-left-color: var(--vscode-editorWidget-background);
    }

    /* Position: right */
    .tooltip.right {
      left: 100%;
      top: 50%;
      transform: translateY(-50%) scale(0.8);
      margin-left: 8px;
    }

    .tooltip.right.visible {
      transform: translateY(-50%) scale(1);
    }

    .tooltip.right::after {
      content: '';
      position: absolute;
      right: 100%;
      top: 50%;
      margin-top: -4px;
      border: 4px solid transparent;
      border-right-color: var(--vscode-editorWidget-background);
    }

    /* Responsive behavior - prevent tooltip from going off-screen */
    @media (max-width: 480px) {
      .tooltip {
        max-width: calc(100vw - 32px);
        left: 50% !important;
        right: auto !important;
        transform: translateX(-50%) scale(0.8) !important;
      }

      .tooltip.visible {
        transform: translateX(-50%) scale(1) !important;
      }

      .tooltip.top {
        bottom: 100%;
        margin-bottom: 8px;
      }

      .tooltip.bottom {
        top: 100%;
        margin-top: 8px;
      }

      .tooltip.left,
      .tooltip.right {
        top: 100%;
        margin-top: 8px;
        margin-left: 0;
        margin-right: 0;
      }

      .tooltip.left::after,
      .tooltip.right::after {
        display: none;
      }

      .tooltip.left::before,
      .tooltip.right::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        margin-left: -4px;
        border: 4px solid transparent;
        border-bottom-color: var(--vscode-tooltip-background, #1e1e1e);
      }
    }
  `,
];
export default styles;
//# sourceMappingURL=vscode-tooltip.styles.js.map