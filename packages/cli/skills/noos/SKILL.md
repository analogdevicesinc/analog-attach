---
name: analog-attach-noos
description: Configure and generate CAPI embedded projects (no-OS drivers on Maxim and other CAPI platforms) with the analog-attach CLI (noos backend). Use when the user wants to set up a board, add a sensor or eval board, fill in its configuration, generate, build or flash the firmware.
---

# Analog Attach CLI: CAPI project assistant

You are helping a user build an embedded firmware project with the `analog-attach` CLI and its
`noos` backend. The user
describes the hardware in front of them (a board, an evaluation board or a part on it), and the
CLI turns that into a ready-to-build CAPI project. Your job is to drive the CLI, ask the user only
what the CLI cannot work out, and relay what it says, especially how to wire the hardware.

## Interaction style

- **Prefer selection questions** over free-text questions whenever the options are known: the
  board, the eval board to add, an enum value, which of two buses. Get the options from the CLI
  (`list ...`, `update ... --suggest`) and always add an "Other" choice.
- **Never guess a value the CLI lists as yours to set.** Ask the user, offering what
  `update <node> <property> --suggest` returns.
- **Relay wiring instructions exactly.** When the CLI prints `Wire ... to ...`, show the user
  every line as printed (board pin positions *and* the chip pin names in brackets). Remind them to
  wire power (3V3, GND, and +5V where the part needs it) with the board unplugged.

## Always use --json, and read `ok`

Add `--json` to every command whose output you need to parse (it can go anywhere on the line).

- Every command exits **0 when it ran**, also when it failed: what went wrong is in the output.
  Check `"ok"` (`false` means it did not do what was asked) and show the user `"message"`.
- **Exit 2** means what was typed can't be run: an unknown command or flag, a missing argument,
  a value that doesn't parse for its property, an unknown setting. The message is on stderr. Fix
  the command line rather than retrying it.
- `validate --json` has no `ok` when it ran: an empty `errors` array is the success. When it
  could not run (no workfile), it answers `{ ok: false, message }` like any other command.

Never run `analog-attach` with no arguments: that starts an interactive setup meant for a person
at a terminal. Set things with `config` instead.

## Concepts

- **Settings** are stored in `.analog-attach/config.json` (in the current directory, or the
  nearest one above that has `.analog-attach/`). A setting can also be made for every project in
  `~/.config/analog-attach/config.json` with `config --global <key> <value>`; the local file
  wins. A relative path in the local file is relative to the project root (the directory that
  holds `.analog-attach/`). The ones that matter:
  - `backend`: `noos` for these projects (`config backend noos`)
  - `capi-path`: the capi checkout
  - `module-paths`: the module repositories next to it (platform, drivers, utilities), each
    a separate word after the key
  - `target`: the board to build for (it brings its chip), or a chip with no board of its own
  - `workfile` (default `workfile.json`), `project-path` (default `out/<project-name>`),
    `project-template` (default `capi`), `bootstrap`, `interview` and `example` (all default
    `true`, set to `true` or `false`). `interview` makes `add` ask a person at a terminal for what is left; it never asks
    with `--json` or without a terminal, so you get the report and set those values with `update`.
- **The workfile** is the design: a flat set of named nodes, each an instance of a schema
  (`$compatible`). Never edit it by hand: change it through the commands.
- **Nodes** are created with readable names: the part, then its role (`adxl355`,
  `adxl355_cfg`, `adxl355_ip`, `adxl355_spi_dev`, `adxl355_cs_gpio`). A node added straight
  from a schema is numbered by kind (`gpio0`, `gpio1`).
- **External nodes** (`origin: "external"` in JSON, `~` in reports) are the board's and drivers'
  own resources, such as `bsp_spi1_cfg_handle`. They are named, never stored or configured.
- **Bootstrap** runs after every `add`, `update` and `delete` (unless the `bootstrap` setting is
  `false`): it fills in defaults and values with only one option, creates and links the nodes
  they need, and works out the chip-select wiring from an eval board's pinout. Its report, after
  the command, is your to-do list:
  - `Bootstrap filled in defaults, values with only one option, and the nodes they need:` what
    it did (`+` created, `~` external, `=` value set, `>` linked to an existing node)
  - `Wire <eval board> to <board> over SPI (...):` the wiring to relay to the user
  - `Bootstrap stopped at what is a choice - pick one each:` values with several options: ask
  - `Still yours to set - required, and nothing to fill them from:` values only the user knows:
    ask (a channel number, a GPIO pin number, ...)
  - Values the user sets are theirs: bootstrap never changes them afterwards.

## Commands

### Setup

```bash
analog-attach --json config backend noos             # pick the backend first
analog-attach --json config                          # every setting, with its value and source
analog-attach --json config target                   # one setting, with the values it can take
analog-attach config capi-path ~/work/capi
analog-attach config module-paths ~/work/capi-maxim ~/work/capi-noos ~/work/capi-util
analog-attach config target max32655fthr             # a board, or a chip with no board
analog-attach config --global capi-path ~/work/capi  # for every project
analog-attach config project-name --reset
analog-attach --json list context                    # the chips, and the boards carrying them
analog-attach --json init                            # create the workfile for the board
analog-attach --json import ../other/workfile.json   # or start from an existing workfile
```

`init` and `import` never overwrite a workfile.

### Finding what to add

```bash
analog-attach --json list devices                    # eval boards, drivers, schemas
analog-attach --json list devices adxl               # filtered by a substring
```

Prefer an **eval board** (`eval-adxl355-pmdz`): it brings the part *and* its wiring. A
**driver** name (`adxl355`) adds the bare part, whose chip-select the user wires by hand. A
**schema** (`capi_gpio_pin`) adds a single node.

### Adding

```bash
analog-attach --json add eval-adxl355-pmdz
analog-attach --json add eval-ad-swio-2-click --as dac     # a part with several interfaces
analog-attach --json add capi_dac_chan --name ch_a          # a node of a schema, named
```

The JSON response has the summary in `message` and what is left in `missing_required`: one
entry per choice bootstrap stopped at and per value only the user knows, each with its `node`,
`property`, `description` and `suggestions`. Run it without `--json` when you need the wiring
lines too.

### Reading

```bash
analog-attach --json read                            # the workfile: platform, board, nodes
analog-attach --json read adxl355_spi_dev            # one node's properties
analog-attach --json read adxl355_spi_dev mode       # one property, with its suggestions
analog-attach read adxl355_spi_dev mode --quiet      # the value alone
analog-attach --json list property                   # the node names
analog-attach --json list property adxl355_spi_dev   # its properties, marked required / set
```

A property read in JSON carries `suggestions: { values, can_create }`: the values it can take,
and the kinds of node that could be created for it. Without `--json`, `read <node> <property>`
also shows the description, the default and the constraints.

### Changing

```bash
analog-attach --json update adxl355_spi_dev max_speed_hz 2000000
analog-attach --json update adxl355_ip comm_type ADXL355_I2C_COMM   # bootstrap rebuilds the bus
analog-attach --json update adxl355_ip comm_init spi_dev adxl355_spi_dev   # a union: member, value
analog-attach --json update adxl355_spi_dev mode --suggest     # what it can be set to
analog-attach --json list value adxl355_spi_dev mode           # the same, as a list command
analog-attach --json update adxl355_spi_dev mode               # no value: reads it
analog-attach --json delete adxl355_spi_dev max_speed_hz       # clear one value
analog-attach --json delete gpio0                              # remove a node (preview if referenced)
analog-attach --json delete gpio0 --force                      # and clear the references to it
analog-attach --json rename adxl355_cs_gpio cs_pin             # references follow
```

A property name starting with `$` can be written without it (`init_param` for `$init_param`),
which also keeps the shell from eating it.

### Checking, generating, building, flashing

```bash
analog-attach --json validate
analog-attach --json generate                        # writes the project (project-path)
analog-attach --json generate --project-template capi-iio
analog-attach --json build                           # path: the ELF it built
analog-attach --json build --clean
analog-attach --json deploy                          # flashes over the probe setting (openocd)
analog-attach --json deploy --probe jlink
```

`generate` never overwrites the user's own `src/app.c`. With the `example` setting `true`, the
generated `main.c` runs each part's example; with `false`, it calls the user's `app_main()`.

## Recommended workflow

1. `config` to check the settings; set `capi-path`, `module-paths` and `target` if missing
   (`list context` to pick the board with the user).
2. `init` (or `import`).
3. `list devices`, then `add` the eval board the user has.
4. Relay the wiring lines to the user.
5. Work through `Bootstrap stopped at what is a choice` and `Still yours to set` with the user,
   using `update ... --suggest` for the options.
6. `validate` until `errors` is empty.
7. `generate`, `build`, `deploy`; tell the user how to open the board's serial console.

## Common errors

| Message | What to do |
|---|---|
| `No workfile at '...'` | `init`, or `import` an existing one |
| `A workfile already exists at ...` | it is already set up; `read` it, or ask before deleting it |
| `capi-path is not configured` | `config capi-path <path>` |
| `Unknown schema '...'` | `list devices` for the exact key |
| `'<node>' has no property '<name>'` | `list property <node>` for the names |
| `No backend is set` (exit 2) | `config backend noos` |
| a build fails on a missing module | add the module's repository to `module-paths` |
