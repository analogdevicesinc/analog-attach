import { css } from 'lit';
import defaultStyles from '../includes/default.styles.js';
const styles = [
    defaultStyles,
    css `
    :host {
      display: block;
      margin-bottom: 10px;
      margin-top: 10px;
    }

    div {
      background-color: var(--vscode-foreground, #cccccc);
      height: 1px;
      opacity: 0.4;
    }
  `,
];
export default styles;
//# sourceMappingURL=vscode-divider.styles.js.map