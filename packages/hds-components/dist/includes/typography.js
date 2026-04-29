/* eslint-disable @typescript-eslint/no-namespace */
import { css } from 'lit';
export var TextStyles;
(function (TextStyles) {
    let Body;
    (function (Body) {
        Body.b1 = css `
      & {
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-4);
        font-style: normal;
        font-weight: 600;
        line-height: 120%; /* 15.6px */
      }
    `;
        Body.b2 = css `
      & {
        /* Body/B2/Text */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-3);
        font-style: normal;
        font-weight: 600;
        line-height: 120%; /* 14.4px */
      }
    `;
        Body.b3 = css `
      & {
        /* Body/B3/Text */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-2);
        font-style: normal;
        font-weight: 600;
        line-height: 120%; /* 13.2px */
      }
    `;
    })(Body = TextStyles.Body || (TextStyles.Body = {}));
    let Label;
    (function (Label) {
        Label.l1 = css `
      & {
        /* Label/L1 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-5);
        font-style: normal;
        font-weight: 600;
        line-height: 150%; /* 21px */
      }
    `;
        Label.l2 = css `
      & {
        /* Label/L2 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-3);
        font-style: normal;
        font-weight: 700;
        line-height: 150%; /* 18px */
      }
    `;
        Label.l3 = css `
      & {
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-2);
        font-style: normal;
        font-weight: 600;
        line-height: 100%; /* 11px */
      }
    `;
        Label.l4 = css `
      & {
        /* Label/L4 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-1);
        font-style: normal;
        font-weight: 700;
        line-height: 120%; /* 10.8px */
      }
    `;
    })(Label = TextStyles.Label || (TextStyles.Label = {}));
    let Heading;
    (function (Heading) {
        Heading.h1 = css `
      & {
        /* Heading/H1 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-9);
        font-style: normal;
        font-weight: 700;
        line-height: 120%; /* 31.2px */
      }
    `;
        Heading.h2 = css `
      & {
        /* Heading/H2 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-7);
        font-style: normal;
        font-weight: 600;
        line-height: 120%; /* 21.6px */
      }
    `;
        Heading.h3 = css `
      & {
        /* Heading/H3 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-5);
        font-style: normal;
        font-weight: 600;
        line-height: 120%; /* 16.8px */
      }
    `;
        Heading.h4 = css `
      & {
        /* Heading/H4 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-4);
        font-style: normal;
        font-weight: 700;
        line-height: 120%; /* 15.6px */
      }
    `;
        Heading.h5 = css `
      & {
        /* Heading/H5 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-2);
        font-style: normal;
        font-weight: 700;
        line-height: 120%; /* 13.2px */
        text-transform: uppercase;
      }
    `;
        Heading.h6 = css `
      & {
        /* Heading/H6 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-2);
        font-style: normal;
        font-weight: 600;
        line-height: 120%; /* 13.2px */
        text-transform: uppercase;
      }
    `;
        Heading.h7 = css `
      & {
        /* Heading/H7 */
        font-family: var(--vscode-font-family, 'Segoe UI Variable');
        font-size: var(--hmc-font-size-2);
        font-style: normal;
        font-weight: 400;
        line-height: 120%; /* 13.2px */
      }
    `;
    })(Heading = TextStyles.Heading || (TextStyles.Heading = {}));
})(TextStyles || (TextStyles = {}));
//# sourceMappingURL=typography.js.map