# Development Guidelines

## Project Structure

- `packages/extension`: VS Code extension core
- `packages/attach-lib`: Device tree parsing and binding processing library
- `packages/extension-protocol`: Shared types and message protocols
- `packages/hds-components`: HDS Components (Lit-based)
- `packages/hds-react`: HDS React Components
- `packages/attach-ui-lib`: Shared UI library
- `packages/pnp-webview`: Plug and Play Webview
- `packages/tree-editor-webview`: Advanced Tree Editor Webview

## Requirements

- `yarn v4.5.3`
- `node >= v20`

## Getting Started

### Install dependencies

`yarn` is the package manager of choice for this project.

1. Install Yarn package manager globally:
   ```bash
   npm install -g yarn
   ```

2. Install tools for building .vsix extension files:
   ```bash
   npm install -g @vscode/vsce
   ```

3. Clone the repository with submodules:
   ```bash
   git clone --recursive <repo-url>
   ```

   Or if you already cloned without submodules:
   ```bash
   git submodule update --init --recursive
   ```

4. Install dependencies:
   ```bash
   yarn install
   ```

### Keeping Submodules Up to Date

```bash
git submodule update --recursive --remote
```

## Building

### Build Everything

```bash
yarn build:all
```

### Build Individual Packages

```bash
yarn build:extension          # VS Code extension
yarn build:attach-lib         # Device tree library
yarn build:pnp-webview        # Plug and Play webview
yarn build:tree-editor-webview # Advanced editor webview
yarn build:hds-react          # HDS React components
yarn build:attach-ui-lib      # Shared UI library
yarn build:extension-protocol # Protocol types
```

### Watch Mode (Development)

```bash
yarn watch
```

### Clean Build Artifacts

```bash
yarn clean      # Remove built artifacts
yarn clean:all  # Remove artifacts and node_modules
```

## Running the Extension

### Debug Mode

1. Open the project in VS Code
2. Press `F5` or go to Run > Start Debugging
3. A new VS Code window will open with the extension loaded

### Running Tests

```bash
yarn test           # Run all tests
yarn test-clean     # Clean build then run tests
```

## Packaging the Extension

To create a `.vsix` package for installation or distribution:

```bash
vsce package --no-yarn --no-dependencies
```

This automatically builds the extension before packaging. The flags are required
because:

- `--no-yarn`: vsce doesn't support Yarn 2+ (Berry) workspaces
- `--no-dependencies`: Dependencies are already bundled by webpack

Creates `analog-attach-0.0.1.vsix` which can be installed via **Extensions:
Install from VSIX** in VS Code.

## Linting

```bash
yarn lint
```
