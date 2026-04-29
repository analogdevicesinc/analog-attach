import { css } from 'lit';
import defaultStyles from '../includes/default.styles.js';
const styles = [
    defaultStyles,
    css `
    :host {
      display: block;
      line-height: 1.4em;
      margin-bottom: 4px;
      margin-top: 4px;
      max-width: 720px;
      opacity: 0.9;
    }

    :host([vertical]) {
      margin-left: 0;
    }
  `,
];
export default styles;
//# sourceMappingURL=vscode-form-helper.styles.js.map