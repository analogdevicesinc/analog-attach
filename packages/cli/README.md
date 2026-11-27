# analog-attach

A CLI for AI coding assistants (and people) to configure peripherals: Linux device tree
overlays (the `linux` backend) and no-OS CAPI projects (the `noos` backend, not offered for now:
a new project can't pick it, and a project set to it already still runs it).

## Install

```bash
npm install -g analog-attach-cli.tgz
```

It needs Node.js 20 or later.

Or, without Node.js, the standalone binary: the CLI and the GUI in one executable, for the
platform it was built on (on Linux, any distribution with glibc 2.28 or later and GCC's
libatomic) and the architecture asked for. Desktop distributions have libatomic; minimal and
container images may not (Debian's and Ubuntu's slim ones: `apt-get install libatomic1`), and the
binary then stops with `libatomic.so.1: cannot open shared object file`. From the repository root,
with Node.js 26:

```bash
yarn build:binary                     # packages/cli/dist-binary/linux-x64/analog-attach (this machine's)
yarn build:binary --arch arm64        # packages/cli/dist-binary/linux-arm64/analog-attach
yarn build:binary --arch x64,arm64    # both
```

The binary is made of nodejs.org's Node of the same version for that architecture, which the first
build downloads to `~/.cache/analog-attach/node/` (`ANALOG_ATTACH_SEA_NODE=<node>` uses another for
this machine's architecture). A distribution's Node links the system's libraries, so the build
refuses it on Linux; the check reads the binary with `readelf` (binutils).

Copy `analog-attach` to a directory on PATH. Its first run writes the files it ships (the GUI's
page, the Python scripts, the skills) to `~/.cache/analog-attach/<version>-<hash>/`
(`$XDG_CACHE_HOME`, `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows). The tools below are
still the system's.

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
  `AA_PREPROCESS_COMMAND`, `analog-attach config var AA_PREPROCESS_COMMAND` shows it): `sudo apt install cpp`, `sudo dnf install cpp`, `sudo pacman -S gcc`,
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
