# Analog Attach

Configure Analog Devices parts for a board running Linux, from a command line or a page in the
browser: devicetree overlays (`.dtso`) checked against the Linux kernel's bindings, built into a
`.dtbo` and deployed to the target over SSH.

The tool is the `analog-attach` CLI (`packages/cli`). `analog-attach gui` serves a GUI for it in the
browser (`packages/gui`), where every action is an `analog-attach` command.

## Requirements

- Node.js 22 or newer.
- A Linux kernel source tree (its bindings and includes).
- On PATH:
  - `dtc` 1.6.0 or newer, to build and validate;
  - `cpp` (gcc), to preprocess the devicetree's includes;
  - dt-schema 2026.9, to validate:
    `pipx install dtschema==2026.9`, then `pipx inject dtschema ruamel.yaml.clib`;
  - `ssh` and `scp`, to deploy.

  `analog-attach` alone on a terminal (the setup) checks them and gives the command that
  installs one missing or too old; so does a command that needs it.

## Installation

Download `analog-attach-cli-<version>.tgz` from the
[releases](https://github.com/analogdevicesinc/analog-attach/releases), then
`npm install -g ./analog-attach-cli-<version>.tgz`. From source, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Usage

```sh
analog-attach config                 # the project's settings: the backend (`linux`), the kernel tree, the target
analog-attach init                   # create the workfile, an overlay
analog-attach import <source>        # or start it from an existing source
analog-attach list devices adxl      # what can be added
analog-attach add <device>           # add a device
analog-attach read                   # the workfile; `read <node>` a node, `read <node> <property>` one value
analog-attach update <node> <property> <value>
analog-attach delete <node> [<property>]
analog-attach validate
analog-attach build                  # the .dtbo
analog-attach deploy                 # to the target over SSH
analog-attach gui                    # the same, in the browser
```

`analog-attach --help` lists every command (`rename`, `completion` and the others),
`analog-attach <command> --help` explains one, and `analog-attach --help --all` prints them all.
With `--json`, every answer has the form `packages/cli/docs/spec/04-protocol` describes.

`analog-attach skill install analog-attach-linux` installs the skill that drives the CLI for an
AI agent: Claude Code by default, or `--agent codex`, `gemini` or `all`. `analog-attach skill
install` alone lists the skills.

The user guide is in [`docs/`](docs/README.md) (Sphinx).

## Repository

| Package | What it is |
|---|---|
| `packages/cli` | The `analog-attach` CLI and its specification (`docs/spec`) |
| `packages/gui` | The browser GUI `analog-attach gui` serves |
| `packages/linux-lib` | Devicetree parsing, the Linux bindings, validation |
| `skills` | The AI agent skill `analog-attach skill install` installs |
| `skill-evals` | Evaluations of the skills |
| `docs` | The user guide (Sphinx, adi-doctools) |

## Issues

See [GitHub Issues](https://github.com/analogdevicesinc/analog-attach/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

See [LICENSE](LICENSE.txt).
