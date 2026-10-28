---
name: attach-noos-capi
description: Configure and generate CAPI embedded projects (no-OS drivers on Maxim and other CAPI platforms) with the attach-noos CLI. Use when the user wants to set up a board, add a sensor or eval board, fill in its configuration, generate, build or flash the firmware.
---

# Analog Attach CLI: CAPI project assistant

You are helping a user build an embedded firmware project with the `attach-noos` CLI. The user
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
- A **non-zero exit** means the CLI itself could not run the command: a typo in the command or a
  flag. Fix the command line rather than retrying it.
- `validate --json` has no `ok`: an empty `errors` array is the success.

Never run `attach-noos` with no arguments: that starts an interactive setup meant for a person
at a terminal. Set things with `config` instead.

## Concepts

- **Settings** come from `~/.config/analog-attach/config.json`, overridden by a project's own
  `.analog-attach.json` (searched for upward from the current directory). The ones that matter:
  - `capi-path`: the capi checkout
  - `module-paths`: the module repositories next to it (platform, drivers, utilities),
    separated like PATH
  - `board`: the target board; setting it also sets `platform`, its chip
  - `workfile` (default `workfile.json`), `project-path` (default `out/<project-name>`),
    `project-template` (default `capi`), `bootstrap` and `example` (both default `true`)
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
attach-noos --json config                          # every setting, with its value and source
attach-noos --json config board                    # one setting, with the values it can take
attach-noos config capi-path ~/work/capi
attach-noos config module-paths ~/work/capi-maxim:~/work/capi-noos:~/work/capi-util
attach-noos config board max32655fthr              # also sets platform
attach-noos config project-name demo --local       # for this project folder only
attach-noos config project-name --reset
attach-noos --json list context                    # the chips, and the boards carrying them
attach-noos --json init                            # create the workfile for the board
attach-noos --json import ../other/workfile.json   # or start from an existing workfile
```

`init` and `import` never overwrite a workfile.

### Finding what to add

```bash
attach-noos --json list devices                    # eval boards, drivers, schemas
attach-noos --json list devices adxl               # filtered by a substring
```

Prefer an **eval board** (`eval-adxl355-pmdz`): it brings the part *and* its wiring. A
**driver** name (`adxl355`) adds the bare part, whose chip-select the user wires by hand. A
**schema** (`capi_gpio_pin`) adds a single node.

### Adding

```bash
attach-noos --json add eval-adxl355-pmdz
attach-noos --json add eval-ad-swio-2-click --as dac     # a part with several interfaces
attach-noos --json add capi_dac_chan --name ch_a          # a node of a schema, named
```

Run it without `--json` when you need bootstrap's report (the wiring, the choices, what is
left): the JSON response only has the summary in `message`.

### Reading

```bash
attach-noos --json read                            # the workfile: platform, board, nodes
attach-noos --json read adxl355_spi_dev            # one node's properties
attach-noos --json read adxl355_spi_dev mode       # one property, with its suggestions
attach-noos read adxl355_spi_dev mode --quiet      # the value alone
attach-noos --json list property                   # the node names
attach-noos --json list property adxl355_spi_dev   # its properties, marked required / set
```

A property read in JSON carries `suggestions: { values, can_create }`: the values it can take,
and the kinds of node that could be created for it. Without `--json`, `read <node> <property>`
also shows the description, the default and the constraints.

### Changing

```bash
attach-noos --json update adxl355_spi_dev max_speed_hz 2000000
attach-noos --json update adxl355_ip comm_type ADXL355_I2C_COMM   # bootstrap rebuilds the bus
attach-noos --json update adxl355_ip comm_init spi_dev adxl355_spi_dev   # a union: member, value
attach-noos --json update adxl355_spi_dev mode --suggest     # what it can be set to
attach-noos --json list value adxl355_spi_dev mode           # the same, as a list command
attach-noos --json update adxl355_spi_dev mode               # no value: reads it
attach-noos --json delete adxl355_spi_dev max_speed_hz       # clear one value
attach-noos --json delete gpio0                              # remove a node (preview if referenced)
attach-noos --json delete gpio0 --force                      # and clear the references to it
attach-noos --json rename adxl355_cs_gpio cs_pin             # references follow
```

A property name starting with `$` can be written without it (`init_param` for `$init_param`),
which also keeps the shell from eating it.

### Checking, generating, building, flashing

```bash
attach-noos --json validate
attach-noos --json generate                        # writes the project (project-path)
attach-noos --json generate --project-template capi-iio
attach-noos --json build                           # path: the ELF it built
attach-noos --json build --clean
attach-noos --json deploy                          # flashes over the probe setting (openocd)
attach-noos --json deploy --probe jlink
```

`generate` never overwrites the user's own `src/app.c`. With the `example` setting `true`, the
generated `main.c` runs each part's example; with `false`, it calls the user's `app_main()`.

## Recommended workflow

1. `config` to check the settings; set `capi-path`, `module-paths` and `board` if missing
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
| `Note: ... uses old setting names` | harmless; any `config` write renames them |
| `'capi_path' is now called 'capi-path'` | use the new name it gives |
| a build fails on a missing module | add the module's repository to `module-paths` |
