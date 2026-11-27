# The ruleset vocabulary

Everything analog-attach reads from the CAPI repos, key by key: what each key means, where
it lives, and what reads it. The examples are taken from the real files (capi, capi-noos,
capi-maxim), so each one can be looked up.

Nothing about a part or a board is written into analog-attach itself. A key exists only when
the files cannot say a fact any other way. Anything that can be deduced from what the files
already say is deduced instead; the [last section](#deduced-not-declared) lists those rules,
because a reviewer will look for keys that are not there.

- [Where the files are](#where-the-files-are)
- [module.yml](#moduleyml)
- [The ruleset index](#the-ruleset-index-analog-attachmoduleyml)
- [board.yml](#boardyml)
- [The platform's interfaces_file](#the-platforms-interfaces_file)
- [Ruleset files](#ruleset-files)
- [Fields](#fields)
- [`$override`](#override)
- [Deduced, not declared](#deduced-not-declared)

## Where the files are

The `capi-path` and `module-paths` settings name the repo roots. Every module under them
is indexed by its `module.yml`. A module that describes C symbols points at its ruleset
index with `rulesets_file:`, and that index lists one ruleset file per symbol.

```
capi/module.yml                           rulesets_file: analog-attach/module.yml
capi/analog-attach/module.yml             the index: groups, bsp_kinds, chip_select
capi/analog-attach/spi/capi_spi_device.yaml   one ruleset: one C symbol
```

`include:` names another ruleset by its bare C symbol, never by path. C symbols are unique
across the ecosystem already, so a reference works unchanged across repos (capi-noos's
adxl355 rulesets include `capi_spi_device`).

## module.yml

Only the keys below are read. Others are ignored rather than refused: these files belong to
other repos and grow keys without asking.

| Key | On | Meaning |
|---|---|---|
| `name`, `type` | every module | `interface` (capi), `platform`, `platform_board`, `driver_collection`, `driver_category`, `driver`, `eval_board`, `middleware` (capi-iio), `utility` (capi-util) |
| `rulesets_file` | any module | path to its ruleset index |
| `provides.interfaces` | driver | the CAPI interfaces it implements (`[accel_sensor]`, `[adc, dac]`); this is what makes it a candidate for a driver-backed field |
| `build.kconfig`, `build.sources`, `build.includes` | driver | its build facts, carried into the generated project |
| `drivers` | driver category | the drivers under it |
| `boards`, `socs`, `metadata.vendor` | platform | the boards and chips it supports |
| `interfaces_file` | platform | its ops tables, see [below](#the-platforms-interfaces_file) |
| `pinout.connectors` | platform board, eval board | the connectors and their pins |
| `implements.driver` | eval board | the part it carries |

### Pinouts

A connector has an `id`, a `type` and its `pins`. Each pin has a `pin` number and,
depending on what it is, a `mnemonic`, a `role` and a `gpio`:

```yaml
# capi-noos/boards/eval-adxl355-pmdz/module.yml: the part's side
- name: "P1 (12-pin PMOD)"
  id: P1
  type: pmod_12            # two connectors of the same type mate: pin N to pin N
  pins:
    - {pin: 1, mnemonic: CS, role: spi_cs}

# capi-maxim/boards/max32655fthr/module.yml: the board's side
- pin: 5
  mnemonic: P2_0
  gpio: {port: MXC_GPIO2, number: 0}
```

`role` is `<bus>_<signal>` (`spi_cs`, `spi_sck`, `i2c_sda`, ...). A part's pins have roles. A
board's pins have the GPIO behind them.

## The ruleset index (`analog-attach/module.yml`)

```yaml
schema_version: "1.0"
rulesets:
  structs:
    - adxl355_init_param.yaml
  externs:
    - adxl355_capi_accel_ops.yaml
  iio:
    - iio/capi_iio_adxl355.yaml
```

| Key | Meaning |
|---|---|
| `rulesets` | groups of ruleset files. The group names are free, with two exceptions below. |
| `rulesets.iio` | a driver's IIO side: its IIO device and what only it uses. Never offered for a generic handle's fields; under `template: capi-iio`, the descriptor in it is the driver's root. |
| `bsp_kinds` | on capi only: board.yml peripheral kind to the C type it has (`spi: capi_spi_config`) |
| `chip_select` | on capi only: which fields carry a SPI device's chip-select |
| `example` | on a driver: code the generated main.c runs once everything is up, see below |

A group also names a header: when a non-driver module ships `inc/capi_<group>.h` (capi's
`spi` group, `capi_spi.h`), the generated project includes it for that group's symbols.

### `bsp_kinds`

A board's BSP already defines its peripherals (`bsp_spi1_cfg`), so an application references
them and never builds them. analog-attach makes each one an extern. The only missing fact is
its C type, and `interface:` cannot give it (`gpio_port` and `gpio_pin` both say `interface:
gpio`). One table on capi covers every board of every platform:

```yaml
bsp_kinds:
  spi:       capi_spi_config
  i2c:       capi_i2c_config
  gpio_port: capi_gpio_port_config
```

A kind with no row is skipped with a warning.

### `chip_select`

Which fields hold a SPI device's chip-select. These are CAPI names, so they are data rather
than code:

```yaml
chip_select:
  device:      capi_spi_device   # the struct a SPI part is attached through
  gpio_list:   cs_gpio           # its list of GPIO chip-selects
  native_mask: native_cs         # its native chip-select bitmask
  pin_number:  number            # on the pin type cs_gpio includes
  pin_port:    port_handle
```

Bootstrap writes these from the wiring, `validate` flags two devices sharing a line, and the
eval-board rules leave them to the user on a bare part.

### `example`

What the generated main.c does with a driver's part, so a build shows the part working.
Both are Eta template files, beside the index; `loop` is required, `setup` is not:

```yaml
# capi-noos/drivers/accel/adxl355/analog-attach/module.yml
example:
  setup: examples/setup.eta   # once: out of standby
  loop: examples/loop.eta     # every pass: read and print
```

```c
/* examples/loop.eta */
double x, y, z, temp;

ret = capi_accel_sensor_get_xyz(<%= it.handle %>, &x, &y, &z);
if (ret)
	return ret;
...
printf("<%= it.handle %>: x %.4f g, ...\r\n", x, y, z, temp);
```

Each is rendered once per handle the driver backs, given `it.handle` (the handle's C name)
and `it.symbol` (its type: `capi_adc`, `capi_adc_chan`, ...), and wrapped in braces of its
own, so two parts can declare the same locals. A template that renders nothing for a handle
skips it: ad74413r shows nothing on its chip handles, only on its channels. A `loop` that
renders empty leaves a setup-only block, such as a DAC output set once.

main.c runs the setups, then the loops every 500 ms, printing on the console. It is
regenerated by every `generate`, so it follows the devices in the workfile. The user's own
code goes in `app_main()`, in `src/app.c`, which `generate` writes once and never again.
The `example` setting picks which of the two main.c runs; with no console on the board, or
under `capi-iio`, it is `app_main()`.

## board.yml

The peripherals a board's BSP defines, grouped by kind. The keys are the C symbols. Only
`pins:` and a GPIO port's `extra.port` are read, to join the BSP with the pinout:

```yaml
peripherals:
  spi:
    bsp_spi1_cfg:
      interface: spi
      pins:
        sck:  {connector: J9, pin: 11}
        mosi: {connector: J9, pin: 12}
        miso: {connector: J9, pin: 13}
        cs:
          - {connector: J9, pin: 5}              # a GPIO the app drives
          - {connector: PMOD, pin: 1, native_cs: 0}   # one of the controller's own lines
  gpio_port:
    bsp_gpio2_cfg:
      extra: {port: MXC_GPIO2}
```

`pins:` refers to the pinout by connector `id` and `pin`, never the other way round:
module.yml is platform-generic and must not depend on a platform's board.yml. A `cs` entry
is a chip-select line the board uses with that bus. One declared line is what wires a
jumpered part with nothing stated; two declared lines are a question for the user.

## The platform's interfaces_file

The platform's ops tables, one per interface that has one (capi-maxim: `sdk/interfaces.yml`):

```yaml
interfaces:
  - {name: spi, header: [maxim_capi_spi.h], ops_symbol: maxim_capi_spi_ops, capi_header: [capi_spi.h]}
  - {name: time, header: [], ops_symbol: null, capi_header: [capi_time.h]}
```

Every workfile for the platform carries them. `maxim_capi_spi_ops` fits a field declaring
`capability: spi`. A node pointing at a table pulls `header` and `capi_header` into the
generated project. An interface with no `ops_symbol` yields no table. A missing or broken
file is a warning: the workfile then has no ops tables, and the ops fields are the user's.

## Ruleset files

One file per C symbol. `$type` says what kind of symbol it is. Every kind has `$symbol` (its
identity, what `include:` names) and `$description`.

### `$type: struct`

A C struct the application initializes. Its fields are the other keys (see [Fields](#fields)),
plus:

| Key | Meaning |
|---|---|
| `$header` | the header declaring it, included by the generated project |
| `$override` | rules over its fields and the nodes it reaches, see [`$override`](#override) |
| `$capability` | on a platform's extra struct only: the interface it extends, matched against a `platform_extra` field's `capability:` |

Every field of the C struct gets a field here, even one no application fills, so the
ruleset describes the struct one to one.

### `$type: descriptor`

A handle an init function produces: `capi_spi_init(&handle, &config)`.

```yaml
$type: descriptor
$symbol: capi_adc_chan
$init_function: capi_adc_chan_init
$remove_function: capi_adc_chan_deinit
$init_param:
  include: capi_adc_chan_config
  pointer: true
  required: true
adc_handle:            # a member the init function fills in
  include: capi_adc
  pointer: true
  readonly: true
```

| Key | Meaning |
|---|---|
| `$init_function`, `$remove_function` | the calls that bring it up and down |
| `$init_param` | the config it is brought up from, always the first field |
| `$handle` | the C type of the handle. Default `<symbol>_handle`; only a handle named otherwise says so (`capi_iio_adxl355` → `capi_iio_adxl355_dev`). |
| `$init_template`, `$remove_template` | an Eta template file, for a handle whose bring-up is not `init(&handle, &config)`. No CAPI ruleset needs one yet. |

The other fields are the handle's members, all `readonly`.

### `$type: extern`

A global the module already compiles: a driver's ops table, never emitted, only referenced.

```yaml
$type: extern
$symbol: adxl355_capi_accel_ops
$provides: capi_accel_sensor_ops     # the C type it has
$header: adxl355_capi_driver.h
```

### `$type: enum`

A C enum: `values` (names, or numbers), with an optional `default`.

## Fields

Each field of a struct or descriptor is a key whose value says what it holds:

| Field | Holds |
|---|---|
| `type: <C type>` | a number (`uint8_t`, `uint32_t`, `int16_t`, ...), or `bool` |
| `type: string` | a string |
| `type: enum` | one of its own `values`, for a field with no enum ruleset of its own |
| `include: <symbol>` | a struct, handle, enum or extern by its symbol |
| `include_type: <kind>` | any ruleset of a kind (`descriptor`, `struct`, ...); an eval board's `part` |
| `type: union` | one of several `members`, each an include |
| `type: array` | `size` copies of an `element` |
| `type: driver_init_param` | the init_param of whichever driver implements `interface` |
| `type: driver_ops` | the ops table of whichever driver implements `interface` |
| `type: platform_ops` | one of the platform's ops tables, by `capability` |
| `type: platform_extra` | a platform's extra struct, by `capability` |
| `type: raw` | C text, emitted as written |

And what each one can say about itself:

| Key | Meaning |
|---|---|
| `required` | it must have a value for the workfile to be valid |
| `default` | the value it starts with. On an include of an enum, the field's own default wins over the enum's. |
| `minimum`, `maximum`, `values` | the values it accepts |
| `format: hex` | an integer field shown and generated in hex (`0x1D`). Integer types only. |
| `pointer` | the field is a pointer to what it includes. Without it, an include of a struct embeds that struct: the node is written inside its owner (`.device = { ... }`) and has no global of its own |
| `count: <field>` | an include is a list, and that field holds its length |
| `readonly` | a member the init function fills in: referenceable, never set |
| `disabled` | the field is not used: an `$override` case sets it, and an array can say so itself |
| `interface` | on a driver-backed field: the CAPI interface the driver must provide |
| `capability` | on a platform field: which interface's table or extra fits |
| `$post_init` | on an include: C to run once the node bound there is up, see below |

### `$post_init`

What main.c does with the node bound to a field, once that node is ready. It is an inline
Eta template that is given `it.target` (the C expression for the node), `it.node`,
`it.owner` and `it.field`:

```yaml
# capi/analog-attach/spi/capi_spi_device.yaml: a chip-select is driven high before use
cs_gpio:
  include: capi_gpio_pin
  $post_init: |
    ret = capi_gpio_pin_set_direction(<%= it.target %>, CAPI_GPIO_OUTPUT);
    if (ret)
        return ret;
    ret = capi_gpio_pin_set_raw_value(<%= it.target %>, CAPI_GPIO_HIGH);
    if (ret)
        return ret;
```

The rule sits on the field, not the part: every part's chip-select pin gets it.

## `$override`

A list of rules over a struct's own fields and the nodes it reaches. Each rule is
unconditional, an `$if`, or a `$switch`:

```yaml
$override:
  - $switch:
      $on: comm_type
      $cases:
        ADXL355_SPI_COMM:
          comm_init:
            value: spi_dev                 # the union member this case selects
          comm_init.spi_dev:               # the node that member points at
            max_speed_hz:
              default: 1000000
              maximum: 10000000
            mode:
              values: [CAPI_SPI_MODE_0]
            $any_of:                       # it must be selectable
              - cs_gpio
              - native_cs: {not: 0}
  - $if:
      rx_dma_handle:
        value: $any                        # set to anything
    $then:
      dma_handle:
        required: true
```

What a rule can do to a field: `default`, `required`, `description`, `disabled`,
`minimum`, `maximum`, `pointer`, `values` (narrow an enum or a number), `allowed` (narrow the
symbols a reference may name), and `value` (force it). A rule's `description` is added under
the field's own rather than replacing it, labelled with the `$symbol` of the ruleset that
declares the rule: the field says what it is, the rule what it means for one part.

A condition tests one field: `value: <x>`, `value: $any` (it is set), or `not: <x>` /
`not: [<x>, ...]` (it is set, and is none of these). Several fields in one condition must
all hold.

### Reaching other nodes

A part constrains the generic structs it sits on: adxl355 limits the SPI device's mode. A
rule reaches a field of another node three ways:

| Spelling | Reaches |
|---|---|
| `comm_init.spi_dev: {...}` | the node a union member points at (`<union>.<member>`) |
| `controller: {$node: {...}}` | the node a plain include points at. `controller: {...}` alone constrains the reference itself (`required`, `allowed`), so the node's fields go under `$node`. |
| `$parent: {...}` | a field of a node that includes this one |

`$this` names the declaring node explicitly. `$node` and the dotted form cannot be used
under `$parent`, because the path is walked from the node declaring the rule.

### `$any_of`

At least one of its members must hold: a bare field name means "is set", and
`field: {condition}` means that condition. It needs two or more members. It is a
requirement, not a value, so bootstrap does not fill it. The chip-select it names is
settled from the wiring instead.

## Deduced, not declared

These are worked out from the files above, so no key says them. They are spelled out here
because each looks like it would need one.

- **A driver's root.** `add adxl355` adds a descriptor whose config has a driver-backed field
  for an interface the driver provides (`capi_accel_sensor`). A handle whose config includes
  another candidate root hangs off it, so it is not one. An ADC channel names its ADC. A
  driver with two roots (ad74413r: an ADC and a DAC) asks for `--as`.
- **Which driver fills a field.** The candidates are the structs (or, for ops, the externs)
  of every driver providing the field's `interface`, outside its `iio` group, except a struct
  another of the driver's candidates includes: that one is a part of it. ad7156's handle takes
  the adapter's `ad7156_capi_init_param`, which embeds `ad7156_init_param` as `device`. Those from a
  part already in the workfile are *strong*, the rest *weak*. Bootstrap takes the only
  strong one. Suggestions list strong ones first. A struct already filling a driver-backed
  field at the other level (device config versus channel config) belongs to that level. So
  once `ad74413r_init_param` fills the ADC's config, a channel gets `ad74413r_channel_config`.
- **Which ops table.** A driver providing several interfaces ships one table per interface,
  and each is the one whose `$provides` ends in `<interface>_ops` (`capi_adc_ops`).
- **Pinning a driver.** `add <driver>` puts the driver's init_param in its root's config:
  its only candidate, or `<driver>_init_param` when it has several (ad74413r's chip and
  channel structs). With `--as adc,dac`, every side shares that one chip.
- **Eval boards.** `add <eval board>` adds a node for the board (stored, never generated) and
  the part its `implements.driver` names. Only a part an eval-board node reaches is wired. `add
  <driver>` alone is a bare part whose wiring is the user's. Deleting the eval board leaves a
  bare part.
- **Wiring.** Where each part pin lands: a stated wire, else two connectors of one `type`
  mating, else the board declaring exactly one pin for it in board.yml `pins:`. The
  chip-select follows from where `spi_cs` lands. See `src/registry/wiring.ts`.
- **Init order.** A handle comes up after every handle it reaches, and every part before any
  channel. A channel is a driver-backed handle that reaches another one: two sides of one
  chip each init the chip, so a second side brought up after a channel would wipe it.

How bootstrap applies these is in [src/bootstrap/README.md](../src/bootstrap/README.md).
