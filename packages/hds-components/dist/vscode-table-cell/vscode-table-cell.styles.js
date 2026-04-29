import { css } from 'lit';
import defaultStyles from '../includes/default.styles.js';
const styles = [
    defaultStyles,
    css `
    :host {
      border-top: var(--vsc-row-border-width) solid
        var(--vscode-editorGroup-border, rgba(255, 255, 255, 0.09));
      box-sizing: border-box;
      color: var(--vscode-foreground, #cccccc);
      display: table-cell;
      font-family: var(--vscode-font-family, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      height: var(--vsc-row-height);
      overflow: hidden;
      padding-left: 10px;
      text-overflow: ellipsis;
      vertical-align: middle;
      white-space: nowrap;
      padding: 0 var(--hmc-space-3);
    }

    :host([compact]) {
      display: block;
      height: auto;
      padding-bottom: 5px;
      width: 100% !important;
    }

    :host([compact]:first-child) {
      padding-top: 10px;
    }

    :host([compact]:last-child) {
      padding-bottom: 10px;
    }

    :host([alignment='center']) {
      text-align: center;
    }

    :host([alignment='right']) {
      text-align: right;
    }

    .wrapper {
      overflow: inherit;
      text-overflow: inherit;
      white-space: inherit;
      width: 100%;
    }

    .column-label {
      font-weight: bold;
    }
  `,
];
export default styles;
//# sourceMappingURL=vscode-table-cell.styles.js.map