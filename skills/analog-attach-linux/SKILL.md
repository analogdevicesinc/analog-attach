---
name: analog-attach-linux
description: Configure Linux devicetree overlays with the analog-attach CLI. Use when the user wants to add a device to an overlay, set its properties, or validate, build and deploy the .dtbo.
license: Apache-2.0
metadata:
  version: "0.1.0"
  displayName: Analog Attach for Linux (ADI DataX™)
  program: datax
  owner: "@dragospetri"
  maintainers: "@dragospetri"
  author: Analog Devices, Inc.
  tags:
    - linux
    - devicetree
    - overlay
    - analog-attach
---

# Analog Attach CLI - Device Tree Configuration Assistant

You are helping a user configure Linux device tree overlays for hardware devices using the `analog-attach` CLI tool and its `linux` backend.

## Purpose

Use this skill when the user wants to attach a device (an ADC, a sensor, a regulator, …) to a board through a devicetree overlay: find the device's binding, pick the bus it is wired to, set its properties, check them against the binding, then build the `.dtbo` and deploy it. The CLI knows the kernel's bindings and the board's base devicetree. Your job is to run its commands, ask the user what only they know (how the device is wired), and never guess it.

**The CLI documents itself.** Before you use a command for the first time, read its help: `analog-attach <command> --help` (`analog-attach list parent --help`, …), one command at a time, as you come to it. The help has the arguments, the value syntax, the templates and examples; this file has only what the help can't tell you.

## Asking the user

Ask with **interactive selection questions** (form-style, selectable options) wherever the valid options are known, and **always include an "Other" option**: the device from `list devices`, the bus from `list parent` (show ALL of them), enum values, the `list value` suggestions, which optional properties or channels to set up.

## Reading the CLI's output

- Run every command with `--json` (anywhere on the line): one JSON line on stdout.
- **Check `ok`, not the exit code.** A refusal (not found, a duplicate, a bad value, a missing setting) exits 0 with `ok: false`. Exit 2 is an input error (a malformed path, a missing argument, an unknown flag), its message on stderr.
- **Read stderr too.** Notes and warnings never go into the JSON: the parent `add` picked, `reg` clashes, value counts, a property the binding doesn't define, references that point nowhere.
- **Act on `error_type`, not on the wording**, and follow `hints`:
  - `missing-setting` → set what `hints` names with `config`.
  - `cache-missing` → `config --reload`.
  - `tool-missing` → show the user the install command from `hints`; don't run it (it needs root, or a specific pipx version).
  - `needs-force` → explain what would happen and re-run with `--force` only once the user agrees.
  - `resource-conflict` → another device has that chip select or address (see Workflow, step 5).
- A `severity: "warn"` answer succeeded, but has something to fix.

## Prerequisites and setup

As an AI tool, don't run a bare `analog-attach`: it is an interactive setup meant for a person. Run `analog-attach --json config` first to see what is set, then set what is missing and create the workfile:

```bash
analog-attach --json config backend linux
analog-attach --json config linux ~/linux              # a kernel tree; builds the binding caches (about a minute)
analog-attach --json list context rpi-4                # the tree's base .dts files for a part of the board's name
analog-attach --json config devicetree <path>          # the user's board, from list context
analog-attach --json config workfile overlay.dtso      # init creates it
analog-attach --json init
```

Ask the user for the kernel tree and the board rather than picking one. The CLI needs `dtc` 1.6.0 or later, `cpp` and dt-schema 2026.9 exactly on PATH.

## Workflow

1. **Find the device.** Ask the user which chip they have, then search with part of its name (`list devices adxl`, `list devices ad7124`), which lists the compatibles that contain it; if they aren't sure, start broader (`list devices adi`). A search that matches one compatible describes that device in full, every property of its binding: that is more than you need here, as `add` and `list property` tell you what to set. Once you have the compatible, don't search for it again. Then run `list overlay <compatible>`: when an overlay for the board already exists in the Linux tree, offer it as a starting point (`import <name>` for the whole overlay, or `add <compatible> --template overlay:<name>` for the device node alone) before building the node by hand.
2. **Find the bus.** `list parent <compatible>`, then ask the user which bus the device is wired to, showing every parent returned. A device whose only parent is the root (`regulator-fixed`, `fixed-clock`) needs no question.
3. **Add the device.** `add <compatible> --parent <bus> --label <label>`. Always pass `--parent`: without it the CLI takes the first bus in the base tree's order, which says nothing about the wiring. Always pass `--label`, so later commands can name the node by it. The response's `missing_required` lists the required properties still to set, in the order to set them (`interrupt-parent` before `interrupts`), each with its description and suggestions. `add --dry-run` shows the node without writing it.
4. **Set the properties.** For each property, ask the user, offering the suggestions. **Don't guess wiring:** for `reg`, `interrupt-parent`, `interrupts`, `reset-gpios` and the other `*-gpios`, run `list value <label> <prop>` and pick from the result with the user; interrupt trigger types and reset polarity depend on the peripheral. Set values with `update <label> <prop> <value…>`. Create child nodes (channels) with `update <label> channel@N`, then set theirs the same way. `list property <label>` shows what the node has, what is required and what the binding allows; `read <label> <prop>` explains a property.
5. **Validate.** `validate`, fix what it reports with `update`, and re-run until `errors` is empty. Act on the `warnings` too: a bus the base leaves disabled must be enabled (`enable <bus>`), or Linux won't probe the device; a `reg` clash means another device has that chip select or address: change the device's `reg`, or `disable` the base node it replaces (a `spidev` on the same chip select), as the user prefers. Before declaring success, run `validate --full` once (see Limitations).
6. **Build and deploy, when the user asks.** A validated overlay is the end of the job otherwise: offer to build it, don't build unasked. `build` compiles the overlay into a `.dtbo` in `build/`. `deploy` copies it to the board and **reboots the board**: confirm with the user first. The starter `aa_deploy.sh` expects a Raspberry Pi running Kuiper at `analog.local`, user `analog`; for another board set `config var BOARD_IP <address>` and `config var BOARD_USER <user>`. The password comes from the environment only: ask the user for it and run `BOARD_PASSWORD=… analog-attach --json deploy`.

## Limitations

- **The CLI can't know the wiring.** The bus `add` picks without `--parent`, and the one `--template example:<N>` picks, are guesses from the base tree's order. The bus, chip select, interrupt line and GPIOs must come from the user.
- **No interview for AI tools.** On a terminal `add` asks for the missing properties and fills the ones the binding pins to one value. Under `--json` it asks nothing and fills nothing: those come back in `missing_required`, with their single value as the suggestion. Set them with `update`.
- **Copied nodes keep their references.** `import` and the copied templates (`example:<N>`, `overlay:<name>`) take names, `reg` and phandles as written. Targets aren't remapped, `reg` may clash with a sibling, and references to nodes the base doesn't have are reported (`unresolved` in the JSON, errors on stderr) but still written. Fix them with `update` before deploying.
- **`adi,ad5593r`** (I2C) shares ad5592r's binding, so `list parent` offers SPI buses for it. Pick the I2C bus with the user and pass `--parent`.
- **`validate` without `--full`** checks only the nodes the overlay writes, not the properties it sets on base nodes (`status`, `pinctrl-0`, `cs-gpios` on `spi0`). `--full` checks the whole devicetree with the overlay applied; it takes a few seconds. A base node the overlay touches brings its own findings, which aren't the overlay's to fix (the RPi 4's spi0 `dmas`: `'dma-names', 'dmas' were unexpected`); tell the user about them rather than changing the base node.
- **The starter scripts** target a Raspberry Pi running Kuiper. For a board that only boots a full devicetree (Zynq, such as the Cora Z7S), `config output devicetree` makes `build` write the base with the overlay applied, and `deploy` copy that `.dtb`. For any other way of deploying, edit `aa_deploy.sh`, or set the command `deploy` runs instead: `config var AA_DEPLOY '<command>'` (`AA_BUILD` for `build`; `--reset` goes back to the script). `config var` lists them.
- **The binding caches** are built when `linux` is set, never automatically after that. After the kernel's bindings change, or after installing another dt-schema, run `config --reload`.

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `No backend is set` (exit 2) | No `backend` in the settings | `config backend linux` |
| `Unknown compatible '<compatible>'. Did you mean …?` | Not a compatible of the kernel's bindings | Offer the suggestions, or search with `list devices <part of the name>` |
| `'X' is not a number, a known macro, or a label` | An unknown word where cells are expected | Check the spelling; a label must exist in the base or the overlay first |
| `interrupts` has the wrong number of cells | The inherited interrupt controller isn't the one wired | `update <label> interrupt-parent <controller>` first (`gpio`, from `list value`) |
| `is part of the base device tree` | `delete`, `rename` or `move` on a base node | Base nodes can't be removed: `disable <path>` instead |
| `Not found: imu1/reg (the property is a separate argument…)` | Path and property joined with `/` | The property is its own argument: `delete imu1 reg` |
| `# ` in a property name breaks the command | The shell takes `#` as a comment | Quote it: `update adc '#address-cells' 1` |
