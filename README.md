# analog-attach README


## Requirements
- `yarn v4.5.3`
- `node >= v20`

## Install & Build
Make sure you have cloned the repository recursively, since we have a submodule package.

You can do this by running the following command after a fresh clone:
```bash
git submodule update --init --recursive
```

To keep your submodule up to date, you can run the following command:
```bash
git submodule update --recursive --remote
```

Then, you can install the dependencies and build the project by running the following command:
```bash
yarn install
yarn build:all
```

You can clean the output via `yarn clean` to remove all built artifacts.

## Packaging the Extension

To create a `.vsix` package for installation or distribution:
```bash
vsce package --no-yarn --no-dependencies
```

This automatically builds the extension before packaging. The flags are required because:
- `--no-yarn`: vsce doesn't support Yarn 2+ (Berry) workspaces
- `--no-dependencies`: Dependencies are already bundled by webpack

Creates `analog-attach-0.0.1.vsix` which can be installed via **Extensions: Install from VSIX** in VS Code.

## Extension Settings

## Known Issues

## Release Notes

### 0.0.1
