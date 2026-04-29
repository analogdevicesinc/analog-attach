# Process for binding interpretation

## Introduction

Bindings can't be used directly to generate a configuration UI for a new device node, they have a simple purpose, validation.
Most constructs in bindings are very simple and could be turned into UI with things like [RJSF](https://github.com/rjsf-team/react-jsonschema-form), but such libraries can't handle more complex cases like combining `anyOf`/`allOf`/`oneOf` with `if/then/else` or `not` constructs.

Bindings also have a very simple scope, they are documentation for devicetree nodes of certain devices and this implies that naturally they would be written in such a way that you could have a configuration UI for each and every binding. A research regarding ADI bindings has been done [here](./BINDINGS.md).

## Workflow

Let's take the [adi,ad4695](https://github.com/analogdevicesinc/linux/blob/main/Documentation/devicetree/bindings/iio/adc/adi%2Cad4695.yaml) binding as example.
It's a pretty complex binding that contains a lot of the pain points when trying to generate UI from a binding.

### Properties

```
properties:
  compatible:
    enum:
      - adi,ad4695
      - adi,ad4696
      - adi,ad4697
      - adi,ad4698

  reg:
    maxItems: 1

  spi-max-frequency:
    maximum: 80000000

  spi-cpol: true
  spi-cpha: true

  spi-rx-bus-width:
    minimum: 1
    maximum: 4

  avdd-supply:
    description: Analog power supply.

  vio-supply:
    description: I/O pin power supply.

  ldo-in-supply:
    description: Internal LDO Input. Mutually exclusive with vdd-supply.

  vdd-supply:
    description: Core power supply. Mutually exclusive with ldo-in-supply.

  ref-supply:
    description:
      External reference voltage. Mutually exclusive with refin-supply.

  refin-supply:
    description:
      Internal reference buffer input. Mutually exclusive with ref-supply.

  com-supply:
    description: Common voltage supply for pseudo-differential analog inputs.

  adi,no-ref-current-limit:
    $ref: /schemas/types.yaml#/definitions/flag
    description:
      When this flag is present, the REF Overvoltage Reduced Current protection
      is disabled.

  adi,no-ref-high-z:
    $ref: /schemas/types.yaml#/definitions/flag
    description:
      Enable this flag if the ref-supply requires Reference Input High-Z Mode
      to be disabled for proper operation.

  cnv-gpios:
    description: The Convert Input (CNV). If omitted, CNV is tied to SPI CS.
    maxItems: 1

  reset-gpios:
    description: The Reset Input (RESET). Should be configured GPIO_ACTIVE_LOW.
    maxItems: 1

  pwms:
    description: PWM signal connected to the CNV pin.
    maxItems: 1

  interrupts:
    minItems: 1
    items:
      - description: Signal coming from the BSY_ALT_GP0 pin (ALERT or BUSY).
      - description: Signal coming from the GP2 pin (ALERT).
      - description: Signal coming from the GP3 pin (BUSY).

  interrupt-names:
    minItems: 1
    items:
      - const: gp0
      - const: gp2
      - const: gp3

  gpio-controller: true

  "#gpio-cells":
    const: 2
    description: |
      The first cell is the GPn number: 0 to 3.
      The second cell takes standard GPIO flags.

  '#trigger-source-cells':
    description: |
      First cell indicates the output signal: 0 = BUSY, 1 = ALERT.
      Second cell indicates which GPn pin is used: 0, 2 or 3.

      For convenience, macros for these values are available in
      dt-bindings/iio/adc/adi,ad4695.h.
    const: 2

  "#address-cells":
    const: 1

  "#size-cells":
    const: 0
```

For the sake of simplicity we don't go over the steps needed to populate certain properties with information from a provided devicetree, we can just use them as is.

```
$ref: /schemas/spi/spi-peripheral-props.yaml#
```

Additionally the binding references the common spi properties.

```
required:
  - compatible
  - reg
  - avdd-supply
  - vio-supply
```

Out of all the properties these are the ones initially deemed required.

### Pattern Properties

```
patternProperties:
  "^in(?:[13579]|1[135])-supply$":
    description:
      Optional voltage supply for odd numbered channels when they are used as
      the negative input for a pseudo-differential channel.

  "^channel@[0-9a-f]$":
    type: object
    $ref: adc.yaml
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        $ref: /schemas/types.yaml#/definitions/flag
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.

    required:
      - reg

    allOf:
      # bipolar mode can't be used with REFGND
      - if:
          properties:
            common-mode-channel:
              const: 0xFF
        then:
          properties:
            bipolar: false
```

These pattern properties conform most of the time to a simple regex.
With a fairly simple to write function, one can determine all the possible options that validate the regex and transform this `patternProperties` into `properties`.

Also the `$ref` will be dereferenced.

Resulting `properties` are [here](./ProcessArtifacts/reducedPatternProperties.md).

### allOf Resolution

```
- oneOf:
      - required:
          - ldo-in-supply
      - required:
          - vdd-supply

  - oneOf:
      - required:
          - ref-supply
      - required:
          - refin-supply
```

These types of rules will create a ChooseOne relationship between the mentioned properties.

```
  - if:
      required:
        - refin-supply
    then:
      properties:
        adi,no-ref-high-z: false
```

These types of rules will be transformed like this :

```
  - if:
      required:
        - refin-supply
    then:
      properties:
        __canary__ : false
        adi,no-ref-high-z: false
```

So when getting back the data from the frontend like :

```
{
  "compatible" : "adi,ad4695",
  "reg" : 0,
  "avdd-supply" : "power_supply",
  "vio-supply" : "io_supply"
  "refin-supply" : "supply_5V"
}
```

We feed it to the validator like this :

```
{
  "compatible" : "adi,ad4695",
  "reg" : 0,
  "avdd-supply" : "power_supply",
  "vio-supply" : "io_supply"
  "refin-supply" : "supply_5V",
  "__canary__" : true
}
```
NOTE: `__canary__` must be added to each subnode and the validator library must be triggered with all `unevaluatedProperties`(`additionalProperties` as legacy) set to true. 

Which in turn will trigger an error like (depends on library):

```
boolean schema is false.
false schema at "#/allOf/0/then/properties/__canary__/false schema"
Instance location: "/__canary__"

should match "then" schema.
if at "#/allOf/0/if"
Instance location: ""
```

This means we have to check the rest of the `then` branch to apply changes to what is sent to the frontend.
This rule would trigger us to search in the list of properties and mark this one as disabled.

```
- if:
      properties:
        compatible:
          contains:
            enum:
              - adi,ad4697
              - adi,ad4698
    then:
      patternProperties:
        "^in(?:9|1[135])-supply$": false
        "^channel@[0-7]$":
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
        "^channel@[8-9a-f]$": false
```

Here we have a more interesting rule.
This would have been preprocessed by the pattern [properties flatten step](#pattern-properties) an transformed like [this](./ProcessArtifacts/reducedPatternPropertiesFromThen.md).

Using the canary technique here would trigger us to search in the list of properties and mark them as disabled or update their definition.

The resulting binding would look like [this](./ProcessArtifacts/processedBinding.md).

This binding shall be a control binding to manage complex operations like `if/then/else` by leveraging validators.

This binding shall then first be populated with data extracted from a devicetree and then turned into a JSON that's (TBD)Protocol compliant.