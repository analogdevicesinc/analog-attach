import { css } from 'lit';
import { TextStyles } from '../includes/typography.js';
import defaultStyles from '../includes/default.styles.js';
import hdsSpacingStyles from '../includes/hds-spacing.styles.js';
const styles = [
    defaultStyles,
    hdsSpacingStyles,
    css `
    :host {
      box-sizing: border-box;
      color: var(--vscode-foreground, #cccccc);
      display: table-cell;
      overflow: hidden;
      padding: var(--hmc-space-3);
      text-overflow: ellipsis;
      white-space: nowrap;
      height: var(--vsc-row-height, 32px);
      vertical-align: middle;

      ${TextStyles.Heading.h4};
    }

    :host([alignment='center']) {
      text-align: center;
    }

    :host([alignment='right']) {
      text-align: right;
    }

    .wrapper {
      box-sizing: inherit;
      overflow: inherit;
      text-overflow: inherit;
      white-space: inherit;
      width: 100%;
    }

    .wrapper.sortable {
      display: flex;
      gap: var(--hmc-space-2);
    }

    .sort-icon {
      cursor: pointer;
    }
  `,
];
export default styles;
//# sourceMappingURL=vscode-table-header-cell.styles.js.map