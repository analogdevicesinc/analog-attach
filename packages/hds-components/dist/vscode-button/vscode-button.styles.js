import { css, unsafeCSS } from 'lit';
import defaultStyles from '../includes/default.styles.js';
import { getDefaultFontStack } from '../includes/helpers.js';
import { TextStyles } from '../includes/typography.js';
const defaultFontStack = unsafeCSS(getDefaultFontStack());
const styles = [
    defaultStyles,
    css `
    :host {
      cursor: pointer;
      display: inline-block;
      width: auto;
    }

    .base {
      align-items: center;
      border-bottom-left-radius: var(--vsc-border-left-radius, 2px);
      border-bottom-right-radius: var(--vsc-border-right-radius, 2px);
      border-bottom-width: 1px;
      border-color: transparent;
      border-left-width: var(--vsc-border-left-width, 1px);
      border-right-width: var(--vsc-border-right-width, 1px);
      border-style: solid;
      border-top-left-radius: var(--vsc-border-left-radius, 2px);
      border-top-right-radius: var(--vsc-border-right-radius, 2px);
      border-top-width: 1px;
      box-sizing: border-box;
      display: flex;
      font-family: var(--vscode-font-family, ${defaultFontStack});
      font-weight: var(--vscode-font-weight, normal);
      height: 100%;
      justify-content: center;
      line-height: 22px;
      overflow: hidden;
      position: relative;
      user-select: none;
      white-space: nowrap;
      width: 100%;
      display: flex;
      color: #000;
      text-align: center;

      ${TextStyles.Body.b1};
      padding: var(--hmc-space-2) var(--hmc-space-4);
      gap: var(--hmc-space-3);
      height: 24px;
    }

    :host([fixed]) {
      width: 100%;
    }

    /**
     * Size styles
     */

    :host([size='medium']) .base {
      padding: var(--hmc-space-1) var(--hmc-space-3);
      gap: var(--hmc-space-1);

      height: 20px;
      font-size: var(--hmc-font-size-4);
      font-style: normal;
      font-weight: 600;
      line-height: 120%;
    }

    :host([size='small']) .base {
      padding: var(--hmc-space-1) var(--hmc-space-2);
      gap: var(--hmc-space-1);

      height: 16px;
      font-size: var(--hmc-font-size-2);
      font-style: normal;
      font-weight: 600;
      line-height: 100%; /* 11px */
    }

    /* Default styles (primary variant) */
    .base {
      background-color: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #ffffff);
    }

    .base:after {
      background-color: var(
        --vscode-button-separator,
        rgba(255, 255, 255, 0.4)
      );
      content: var(--vsc-base-after-content);
      display: var(--vsc-divider-display, none);
      position: absolute;
      right: 0;
      top: 4px;
      bottom: 4px;
      width: 1px;
    }

    /* Secondary variant styles */
    :host([variant='secondary']) .base:after {
      background-color: var(--vscode-button-secondaryForeground, #cccccc);
      opacity: 0.4;
    }

    :host([variant='secondary']) .base {
      color: var(--vscode-button-secondaryForeground, #cccccc);
      background-color: var(--vscode-button-secondaryBackground, #313131);
    }

    /* Tertiary variant styles */
    :host([variant='tertiary']) .base {
      color: var(--vscode-editor-foreground);
      background-color: var(--vscode-editor-background);
    }

    /* Hover states */
    :host(:hover) .base {
      background-color: var(--vscode-button-hoverBackground, #026ec1);
    }

    :host([disabled]:hover) .base {
      background-color: var(--vscode-button-background, #0078d4);
    }

    :host([variant='secondary']:hover) .base {
      background-color: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
    }

    :host([variant='secondary'][disabled]:hover) .base {
      background-color: var(--vscode-button-secondaryBackground, #313131);
    }

    :host([variant='tertiary']:hover) .base {
      background: var(--vscode-list-inactiveSelectionBackground, #37373d);
    }

    /* Focus states */
    :host(:focus) .base {
      background-color: var(--vscode-button-hoverBackground, #026ec1);
      outline: 1px solid var(--vscode-focusBorder, #0078d4);
      outline-offset: 2px;
    }

    :host([disabled]:focus) .base {
      background-color: var(--vscode-button-background, #0078d4);
      outline: 0;
    }

    :host([variant='secondary']:focus) .base {
      background-color: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
    }

    :host([variant='secondary'][disabled]:focus) .base {
      background-color: var(--vscode-button-secondaryBackground, #313131);
    }

    :host([variant='tertiary']:focus) .base {
      background-color: var(--vscode-button-secondaryHoverBackground, #3c3c3c);
    }

    :host([disabled]) {
      cursor: default;
      opacity: 0.4;
      pointer-events: none;
    }

    :host(:focus),
    :host(:active) {
      outline: none;
    }

    ::slotted(*) {
      display: inline-block;
      margin-left: 4px;
      margin-right: 4px;
    }

    ::slotted(*:first-child) {
      margin-left: 0;
    }

    ::slotted(*:last-child) {
      margin-right: 0;
    }

    ::slotted(vscode-icon) {
      color: inherit;
    }

    .content {
      display: flex;
      position: relative;
      width: 100%;
      height: 100%;
      padding: 1px 13px;
    }

    .base.icon-only {
      gap: 0px;
      padding: var(--hmc-space-2) var(--hmc-space-2);
      width: 24px;
      height: 24px;
    }

    :host([size='medium']) .base.icon-only {
      gap: 0px;
      padding: var(--hmc-space-1) var(--hmc-space-1);
      width: 20px;
      height: 20px;
    }

    :host([size='small']) .base.icon-only {
      gap: 0px;
      padding: 0px;
      height: 16px;
      width: 16px;
    }

    slot {
      align-items: center;
      display: flex;
      height: 100%;
    }

    .icon,
    .icon-after {
      color: inherit;
      display: block;
    }
  `,
];
export default styles;
//# sourceMappingURL=vscode-button.styles.js.map