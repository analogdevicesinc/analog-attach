# Repository Guidelines

## Project Structure & Module Organization
- `src/extension.ts`: VS Code extension entry (Node context).
- `src/AttachLib/*`: Core attach/parsing logic; keep UI-free and testable.
- `src/AttachSession/*`: Platform-specific commands and session management.
- `src/webview/*`: Webview UI (browser context) bundled separately.
- `src/test/*`: Integration/tests and fixtures (`*.test.ts`, `.dts`, `.json`).
- `dist/`: Webpack output (`extension.js`, `webview.js`).
- `out/`: Transpiled tests output.
- `media/`: Static assets used by the webview.

## Build, Test, and Development Commands
- `npm run watch`: Incremental build in watch mode.
- `npm run compile`: Webpack build for extension and webview.
- `npm run package`: Production bundle with hidden source maps.
- `npm run lint`: ESLint over `src`.
- `npm test`: Runs VS Code integration tests (`pretest` compiles + lints).
Tip: Use VS Code “Run Extension” (F5) to debug locally.

## Coding Style & Naming Conventions
- **Language**: TypeScript with `strict` compiler options (see `tsconfig.json`).
- **Linting**: ESLint with `@typescript-eslint` and `unicorn`. Fix warnings where practical.
- **Names**: PascalCase for classes/types, camelCase for functions/variables; keep filenames consistent with existing patterns (e.g., `AnalogAttachPanel.ts`).
- **Formatting**: Use VS Code’s default TS formatter; avoid large unrelated reformatting in PRs.

## Testing Guidelines
- **Location**: Place tests in `src/test` and name as `*.test.ts` (e.g., `extension.test.ts`).
- **Scope**: Prefer testing pure logic in `AttachLib`; use fixtures in `src/test/` for DTS/JSON cases.
- **Run**: `npm test` (automatically compiles and lints). Ensure new behavior is covered.

## Commit & Pull Request Guidelines
- **Commits**: Use short, imperative messages (present tense). Example: `move pure attach files to lib folder` or `update UI to vscode-elements`.
- **PRs**: Provide a clear description, link related issues, include screenshots/GIFs for webview changes, list testing steps, and ensure `npm run lint` and `npm test` pass.

## Security & Configuration Tips
- Configure device paths/commands via settings, not code. Example (User Settings):
```json
{
  "analog-attach.defaultLinuxRepository": "~/linux",
  "analog-attach.defaultDtSchemaRepository": "~/dt-schema"
}
```
- Do not commit secrets or hard-coded IPs/passwords. The defaults in `package.json` are placeholders—override them locally.
