# analog-attach

A CLI for AI coding assistants (and people) to configure peripherals: Linux device tree
overlays (the `linux` backend) and no-OS CAPI projects (the `noos` backend).

## Install

```bash
npm install -g analog-attach-cli.tgz
```

It needs Node.js 20 or later.

## Requirements of the linux backend

The linux backend runs tools installed on your system. It doesn't ship them:

- **dtc**, the devicetree compiler, 1.6.0 or later, from your package manager:

  | System | Command |
  |---|---|
  | Debian, Ubuntu | `sudo apt install device-tree-compiler` |
  | Fedora, RHEL | `sudo dnf install dtc` |
  | Arch | `sudo pacman -S dtc` |
  | openSUSE | `sudo zypper install dtc` |
  | macOS | `brew install dtc` |

- **cpp**, the C preprocessor, for the base devicetree's `#include`s and macros (the default
  `preprocess-command`): `sudo apt install cpp`, `sudo dnf install cpp`, `sudo pacman -S gcc`,
  `sudo zypper install cpp`, or `xcode-select --install` on macOS. Most systems with a C
  compiler have it.

- **dt-schema 2026.9** (`dt-mk-schema`, `dt-validate` and the core schemas), exactly that
  version, from PyPI with [pipx](https://pipx.pypa.io):

  ```bash
  pipx install dtschema==2026.9
  pipx inject dtschema ruamel.yaml.clib   # the fast YAML loader
  pipx ensurepath                         # once, if pipx's bin directory isn't on PATH
  ```

  Replace another version with `pipx install --force dtschema==2026.9`.

A bare `analog-attach` on a terminal checks them and offers to run the pipx commands. A
command that needs a tool that is missing says which one, and how to install it.

## Get started

```bash
analog-attach            # on a terminal: the guided setup
analog-attach --help
```

`analog-attach skill install analog-attach-linux` (or `analog-attach-noos`) installs the
skill that teaches Claude Code the commands.
