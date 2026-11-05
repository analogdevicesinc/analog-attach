---
name: analog-attach-noos
description: Configure, generate, build and flash CAPI embedded projects (no-OS drivers on Maxim and other CAPI boards) with the analog-attach CLI and its noos backend. Use when the user wants to set up a board, add a sensor or an eval board, wire it, fill in its configuration, or generate, build or flash the firmware.
---

# analog-attach for CAPI projects (noos)

You help a user turn the hardware in front of them (a board, and an eval board or a part wired
to it) into a CAPI firmware project, by driving the `analog-attach` CLI. The CLI works out
almost everything by itself. Your job:

- run the commands;
- ask the user only what the CLI says is theirs to choose;
- relay the **wiring** exactly, so they can connect the hardware.

This page has what you need for the usual work. Read a command's `--help` only for something it
doesn't cover (see "Reading the help").

## How it works

```
settings (.analog-attach/config.json)  ->  workfile (workfile.json)  ->  generated project  ->  firmware
   capi-path, module-paths, target         nodes: the design              out/<project-name>/   build/<name>_app.elf
```

- **Settings** say where the CAPI trees are (`capi-path`, `module-paths`) and what the project is
  for (`target`: a board, which brings its chip, or a chip without a board).
- **The workfile** is the design: a flat set of named **nodes**, each an instance of a schema. It
  is created for the target's board by `init`. Never edit it by hand: change it through commands.
- **Bootstrap** runs after every `add`, `update` and `delete`:
  - it fills in defaults and the values that have only one option;
  - it creates and links the nodes they need;
  - it works out the wiring and the chip-select from an eval board's pinout.

  What it can't decide is left to the user: a **choice** among several options, or a value
  **only the user knows**. Values the user sets are theirs: bootstrap never changes them.
- **Node names** read as the part, then its role: `adxl355`, `adxl355_cfg`, `adxl355_ip`,
  `adxl355_spi_dev`, `adxl355_cs_gpio`. **External nodes** (`origin: "external"`, `~` in reports),
  like `bsp_spi1_cfg_handle`, are the board's and drivers' own: named, never stored or set.
- **generate** writes a CMake project from the workfile; **build** compiles it; **deploy**
  flashes it through a debug probe.

## Ground rules

- **Add `--json` to every command** whose answer you need; it can go anywhere on the line. Each
  command prints one JSON object.
- **Exit 0 means the command ran, not that it worked.** Read `ok`:
  - `ok: false` is a refusal: show the user `message`, and act on `error_type` (see "Errors").
  - `read`, `update` with no value (which reads), and `validate` answer without `ok` when they
    work: the node or property itself, or `{ errors, warnings }`, an empty `errors` being valid.
- **Exit 2 means the command line can't be run:** an unknown command, flag or setting, or a
  missing or extra argument. The reason is on stderr, as text. Fix the command; don't retry it as
  is.
- **Never run `analog-attach` alone without `--json`:** that's an interactive setup meant for a
  person at a terminal. `analog-attach --json` alone is safe, and the first thing to run: it says
  which required settings are missing.
- No command asks questions under `--json`. What is left comes back in the result for you to ask
  the user and set with `update`.

## The flow

1. **Check the settings:** `analog-attach --json`. If `missing` isn't empty, set those settings:
   - `config capi-path <dir>`;
   - `config module-paths <dir> <dir>...`;
   - `config target <board>`. Get the boards with `list context`, and let the user pick.
2. **Create the workfile:** `init`, or `import <workfile>` to start from an existing one.
3. **Find the device:** `list devices <filter>`. Prefer an **eval board** (`eval-adxl355-pmdz`):
   it brings the part *and* its wiring. A **driver** (`adxl355`) adds the bare part, which the user
   wires by hand. A **schema** (`capi_gpio_pin`) adds one node.
4. **Add it:** `add <key>`. Then, from its answer:
   - relay `wiring` and `chip_selects` (see "The wiring");
   - ask about each entry of `missing_required`, offering its `suggestions`, and set them with
     `update`.
5. **Check:** `validate`, until `errors` is empty.
6. **Generate, build, flash:** `generate`, then `build`, then `deploy`. Tell the user where the
   firmware is (`path` of `build`) and how to open the board's serial console.

## The wiring

`add` gives the wiring as data:
- `wiring`: one entry per bus;
- `chip_selects`: how each SPI device's chip-select is driven.

`update` gives them too, when a change rewired a bus (switching `comm_type` from SPI to I2C, say).
Nothing else prints them again, so relay them **when they come**.

Show the user every connection as a line, the eval board's pin first:

```
Wire eval-adxl355-pmdz to max32655fthr over SPI (bsp_spi1_cfg):
  P1 pin 2 (spi_mosi)  ->  J9 pin 12 (P0_21)
  P1 pin 3 (spi_miso)  ->  J9 pin 13 (P0_22)
  P1 pin 4 (spi_sck)   ->  J9 pin 11 (P0_23)
  P1 pin 1 (spi_cs)    ->  J9 pin 5 (P2_0)
```

**The fields behind each line:**
- each connection is `{ role, from: { connector, pin }, to: { connector, pin, chip_pin? } }`;
- `chip_pin` is the chip's pin name, which the board prints next to the header pin. Always show
  it in brackets, since it's what the user finds on the board;
- show every entry of `problems` as a warning.

**A bare part** (a driver, no eval board) has no connections:
- `board_pins` say where its bus is on the board;
- `chip_select_options` list free pins for its chip-select. To use one, add a pin node, set its
  `port_handle` and `number`, and point the device's `cs_gpio` at it.

**chip_selects:** `kind: "gpio"` (a GPIO `port` and `number`, at a board pin), `"native"` (a line
of the bus itself), or `"unwired"` (`reason` says why).

Remind the user to wire power too (3V3 and GND, and +5V where the part needs it), with the board
unplugged.

## Asking the user

- **Prefer selection questions** when the options are known: the board, the eval board, an enum
  value, which bus. Get the options from the CLI (`missing_required[].suggestions`, `update <node>
  <property> --suggest`, `list ...`), and add an "Other" choice.
- **Never guess a value that is the user's:** a channel number, a pin, a gain. Ask.
- **Keep their words:** what they pick goes in as given; don't "fix" a value the CLI took.

## Commands

```bash
# settings
analog-attach --json                                  # what is missing (start here)
analog-attach --json config                           # every setting: value, source, default
analog-attach --json config target                    # one setting, with the values it can take
analog-attach --json config target max32655fthr       # set one
analog-attach --json config module-paths ~/capi-maxim ~/capi-noos ~/capi-util   # a list: several words
analog-attach --json config probe --reset             # back to its default
analog-attach --json list context                     # the chips, and the boards carrying each

# the workfile
analog-attach --json init
analog-attach --json import ../other/workfile.json
analog-attach --json list devices adxl                # eval boards, drivers, schemas matching
analog-attach --json add eval-adxl355-pmdz
analog-attach --json add ad74413r --as adc,dac        # a part with several interfaces
analog-attach --json add capi_gpio_pin --name cs_pin  # a schema's node, named

# reading
analog-attach --json read                             # the whole workfile
analog-attach --json read adxl355_spi_dev             # one node
analog-attach --json read adxl355_spi_dev mode        # one property: type, default, suggestions
analog-attach read adxl355_spi_dev mode --quiet       # the value alone
analog-attach --json list property adxl355_spi_dev    # its properties: type, required, set
analog-attach --json list value adxl355_spi_dev mode  # what it can be set to

# changing
analog-attach --json update adxl355_spi_dev max_speed_hz 2000000
analog-attach --json update adxl355_ip comm_init spi_dev adxl355_spi_dev   # a union: member value
analog-attach --json update holder modes MODE_0,MODE_3                     # an array: one argument
analog-attach --json update adxl355_spi_dev mode                           # no value: reads it
analog-attach --json delete adxl355_spi_dev max_speed_hz                   # clear one value
analog-attach --json delete gpio0                     # a node: a preview when something refers to it
analog-attach --json delete gpio0 --force             # remove it, and clear those references
analog-attach --json rename adxl355_cs_gpio cs_pin    # references follow
analog-attach --json validate

# the project
analog-attach --json generate                         # to project-path (out/<project-name>)
analog-attach --json generate --output ../fw          # elsewhere, this time only
analog-attach --json build                            # path: the ELF
analog-attach --json build --clean
analog-attach --json deploy                           # through the probe setting (openocd)
analog-attach --json deploy --probe jlink
```

**Settings worth knowing:**
- `bootstrap`, `interview`, `example`: `true` or `false`;
- `project-name` and `project-path`: what `generate` writes, and where;
- `project-template`: `capi` by default, `capi-iio` for IIO;
- `build-dir`, `build-command`, `deploy-command`: how `build` and `deploy` run;
- `probe`: `openocd` or `jlink`.

`config --global <key> <value>` sets one for every project; the project's own value wins.

## Reading the help

Read the help only when this page doesn't cover what you need: a flag not shown here, or an
unusual form.

- `analog-attach --help`: every command, with its usage line.
- `analog-attach <command> --help` (or `analog-attach help <command>`): the command's arguments,
  each flag with what it does, and 2 to 4 examples at the end. **The examples are the quickest
  answer**: copy their form.
- `analog-attach list --help` and `analog-attach skill --help`: a group's sub-commands.
- In a usage line, `[...]` is optional and `<...>` is yours to fill; `...` repeats.

## Quirks

- **A `$` property** can be written without its `$` (`init_param` for `$init_param`), which also
  keeps the shell from expanding it.
- **A union** takes its member and value as two arguments (`comm_init spi_dev adxl355_spi_dev`),
  or as one, `spi_dev,adxl355_spi_dev`. The member alone is fine too, with no value yet.
- **An array** is one comma-separated argument. A third value argument is a usage error.
- **`update <node> <property>` with no value reads it.** It doesn't clear it: `delete <node>
  <property>` does. A cleared value stays empty: neither its default nor bootstrap fills it again
  until the user sets it.
- **`init` and `import` never overwrite a workfile.** With one already there, `read` it rather
  than starting over, and ask before deleting it.
- **`deploy` doesn't build:** run `build` first. `generate` keeps the user's own `src/app.c`.
  With `example` `true`, the generated `main.c` runs each part's example; with `false`, it calls
  the user's `app_main()`.
- **A workfile made for a chip that several boards carry can't be generated.** Set `target` to the
  board, not the chip.
- **Paths in the project's settings** are relative to the project root (the folder with
  `.analog-attach/`).
- **The workfile is saved by each command** as it returns; there is no separate save.

## Errors

Act on `error_type`; `message` says which case it is.

| `error_type` | What to do |
|---|---|
| `workfile-missing` | `init`, or `import` an existing workfile |
| `workfile-exists` | it is set up already: `read` it |
| `missing-setting` | `config <key> <value>`, the key named in `message` |
| `invalid-setting` | the value can't be taken: `config <key>` shows the values it can |
| `unknown-device-type` | `list devices <filter>` for the exact key |
| `not-found` | a node or property that isn't there: `read` for the nodes, `list property <node>` for its properties |
| `invalid-value` | the value isn't one the property takes: `update <node> <property> --suggest` |
| `ambiguous` | several fit (a driver's interfaces: `--as`; several boards): ask the user which |
| `needs-force` | `message` shows what it would do: confirm with the user, then repeat with `--force` |
| `not-generated` | `generate`, or `build`, first, as `message` says |
| `invalid-source` | `capi-path` or a module path isn't what it should be: check it with the user |
| `tool-missing` | install the tool named (cmake, ninja, the compiler, `MAXIM_SDK_PATH` for a Maxim board) |
| `tool-failed` | show the user the output; for a build, the compiler's first error |

A `validate` finding carries an `error_type` too: `missing-required`, `out-of-range`,
`bad-reference`, `rule-violation`, `resource-conflict`. Fix it with `update` and validate again.
