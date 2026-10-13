# Bootstrap

Fills in a workfile wherever there is no room for choice, and keeps what it filled in
line with the rules. With it, `attach-noos add eval-adxl355-pmdz` on a max32655fthr workfile
gives a valid workfile, the wiring to make it true on the bench, and nothing left to decide.

The law: **bootstrap supplies values, the engine enforces rules.** Bootstrap never decides
anything that is a choice. When there is exactly one sensible answer it writes it. When
there are several, or none, it stops and says so, and `validate` reports what is missing.

## When it runs

After every command that changes the workfile (`add`, `update`, `delete`), when the
`bootstrap` setting is on (the default). Running it twice changes nothing.

## What it does, in order

Each run repeats these steps, one change at a time, until none applies:

1. **Revise** what bootstrap already owns (see [Ownership](#ownership)).
   - A plain value is set to what its fill rule gives now, or removed when it gives nothing.
   - A reference is removed when the node it names no longer fits there. Example: the union
     member no longer matches `comm_type`.
   - A list's count follows its list.
2. **Drop** what is no longer used (see [Deleting](#deleting)).
3. **Fill** an unset value that has exactly one sensible value:
   - its default (the schema's, or one an `$override` supplies), or
   - the only value an override leaves it, or
   - a value an override forces, or
   - for a list's count, the length of the list.
4. **Link** an unset *required* reference that has exactly one option (see
   [Options](#options)). That may create a node, which opens the next fills and links.
5. **Chip-select.** A SPI device with no chip-select gets the one its part's wiring settles
   (see [Wiring](#wiring)).

Steps 1 and 2 come first so that every fill and link is judged against a workfile that
already follows the current rules. Optional references and lists are never filled.
A requirement from `$any_of` (the chip-select) is left to step 5.

## Options

An option for a reference is one of:

- a **hidden resource**: a board peripheral from board.yml, a driver's ops table, or the
  handle wrapping one (`bsp_spi1_cfg_handle`);
- an **existing node** that fits:
  - Handles (descriptors: controllers, ports, the ADC handle), externs and hidden nodes are
    shared, so they are an option even when something already uses them. Two devices on
    one bus share its controller.
  - A plain struct (a device, an init_param, a pin) belongs to whatever points at it. It is
    an option only while nothing does: an unused node, left by the user or by an earlier
    run, is there to be reused.
- a **new node** of the type, only when nothing above fits.

Exactly one option means it is taken. Two or more is a choice, and none means nothing
provides it. Either way the reference stays unset and is listed in the report's `choices`.

## Adding a part

`attach-noos add` puts one node in the workfile, and bootstrap builds everything below it:

| Command | Adds |
|---|---|
| `add <eval board>` | the eval-board node (stored, never generated) and the part it carries, which its pinout then wires |
| `add <driver>` | the part alone: a bare part, whose chip-select is the user's |
| `add <driver> --as adc,dac` | one handle per side, all on one chip |
| `add <schema>` | that one node, nothing pinned |

The part is its driver's root handle (`registry/roots.ts`). `pin_driver()` then names the
driver once, so nothing below has to be guessed. It creates the root's config and puts the
driver's init_param in its driver-backed `extra`: its only candidate, or `<driver>_init_param`
when it has several. Each further `--as` side gets its own
handle and config, but the same init_param: one chip, several interfaces.

## Driver-backed fields

A config's `extra` and `ops` name only an interface (`type: driver_init_param, interface:
adc`). The candidates are what every driver providing it ships, outside its `iio` group, and
not a struct another of its candidates includes (ad7156_init_param is embedded in the
adapter's ad7156_capi_init_param); ops tables are matched by `<interface>_ops`. They are ranked by what the workfile already
holds (`rank_driver_candidates()`):

- **Elimination across levels.** A struct already filling a driver-backed field of a device
  config is that device's, so it is never offered to a channel config, and the other way
  round. A channel config is one that names a handle (`capi_adc_chan_config.adc_handle`).
  Between two device configs, as with the ADC and DAC sides of one chip, nothing is taken.
- **Strong and weak.** Of what is left, the structs of a driver that already has a node in
  the workfile are strong; the rest are weak.

Bootstrap takes the strong options when there are any, else the weak ones, and links only
when that leaves exactly one. So a channel added next to an ad74413r gets
`ad74413r_channel_config`, even with another ADC driver configured. Suggestions list strong
before weak.

## Hidden nodes

Board and driver resources (externs, and the handles wrapping them) are real nodes while
the workfile is in memory: referenced, validated and generated like any other. They are
never written to the file. A load rebuilds the ones a stored node names, from the name
alone (`registry/hidden.ts`).

## Ownership

Each stored node lists the values bootstrap set in `"$auto": [...]`:

```json
"capi_spi_device": {
  "$compatible": "capi_spi_device",
  "$auto": ["controller", "mode", "cs_gpio", "cs_gpio_num"],
  "controller": "bsp_spi1_cfg_handle",
  "max_speed_hz": 2000000,
  ...
}
```

- A value bootstrap writes (a default included) is bootstrap's, and is listed.
- A value the user writes is the user's. Editing a bootstrap value takes it off the list.
- A value the user clears (`attach-noos delete <node> <property>`) is written as `null`. It
  is the user's "nothing": unset to everything else, but bootstrap does not fill it back in.
  Deleting a node clears the references to it the same way, so bootstrap does not rebuild
  it straight back.
- Bootstrap only ever revises or removes values on the list. The user's are never touched.

Hand edits to the workfile JSON are not supported.

## Deleting

A stored node is deleted when both hold:

- it lost its last reference during this command, by the user's edit or by bootstrap; and
- bootstrap owns every value it holds.

Deletion cascades: removing a SPI device leaves its chip-select pin unreferenced, so the
pin goes too. A root was never referenced, so it is never deleted. A node that lost its
last reference but holds a value the user wrote stays, and is reported as `dangling`.

"During this command" needs what was referenced before the edit, because an `update` can
drop a reference before bootstrap runs. Commands pass it as `referenced_before`
(`referenced_nodes()` taken before the edit).

## Wiring

For a part bound to a bus device, the part's eval-board pinout, the board's pinout and the
board's board.yml `pins:` together decide where each pin lands (`registry/wiring.ts`). The
order is: a stated wire, then same-standard mating (a Pmod into a Pmod port), then the
board's own declaration, which only counts if it names exactly one pin.

For SPI, that also settles the chip-select: a native line of the controller, or a GPIO pin
node on the right port. Lines another SPI device already uses are skipped. A GPIO is one
physical pin, so it is taken whatever bus it selects for. A native line is taken only on
its own controller. When no free line is left, bootstrap stops and lists free header pins
as hints. `validate` flags two devices that share a chip-select, however they got there.

The chip-select fields follow the wiring, not the fill rule, so step 1 leaves them alone.
Only an eval-board node in the workfile wires a part, and its `part` link is not a
reference: deleting the eval board removes the chip-select bootstrap wired from it (and
then the pin node), leaving exactly the bare part `add <driver>` gives.

## The report

`bootstrap()` returns what it did:

| Field          | What                                                                 |
|----------------|----------------------------------------------------------------------|
| `revised`      | owned values changed or removed to follow the rules                  |
| `filled`       | values filled, and why (default, only value, override)               |
| `linked`       | references set, and whether the node was created or is hidden        |
| `chip_selects` | chip-selects settled from the wiring                                 |
| `wiring`       | per bus device touched, or on an eval board with its CS still open: the connections, problems and free CS pins |
| `choices`      | required references left open, with their options                    |
| `deleted`      | stored nodes deleted                                                 |
| `dangling`     | nodes left unused that hold user values                              |

The CLI prints it after each command (`attach-no-os-cli/src/commands/bootstrap_run.ts`).

The keys all of this reads are listed in [docs/vocabulary.md](../../docs/vocabulary.md).

## Files

- `bootstrap.ts`: the steps, the options and the report.
- `../registry/hidden.ts`: hidden candidates and handle names.
- `../registry/wiring.ts`: where pins land, and the chip-select.
- `../registry/roots.ts`: the root a driver is added through (`add adxl355`).
- `../registry/drivers.ts`: driver-backed candidates, and their ranking.
- `../registry/eval_boards.ts`: the eval-board node.
- `../validator/chip_select.ts`: the shared chip-select check.
