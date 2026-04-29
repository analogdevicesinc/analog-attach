```
# SPDX-License-Identifier: (GPL-2.0-only OR BSD-2-Clause)
%YAML 1.2
---
$id: http://devicetree.org/schemas/iio/adc/adi,ad4695.yaml#
$schema: http://devicetree.org/meta-schemas/core.yaml#

title: Analog Devices Easy Drive Multiplexed SAR Analog to Digital Converters

maintainers:
  - Michael Hennerich <Michael.Hennerich@analog.com>
  - Nuno Sá <nuno.sa@analog.com>

description: |
  A family of similar multi-channel analog to digital converters with SPI bus.

  * https://www.analog.com/en/products/ad4695.html
  * https://www.analog.com/en/products/ad4696.html
  * https://www.analog.com/en/products/ad4697.html
  * https://www.analog.com/en/products/ad4698.html

properties:
  compatible:
    enum:
      - adi,ad4695
      - adi,ad4696
      - adi,ad4697
      - adi,ad4698

  reg:
    minItems: 1
    maxItems: 1
    items:
      items:
        - minimum: 0
          maximum: 256

  spi-max-frequency:
    type: integer
    typeSize: 32
    minimum: 0
    maximum: 80000000

  spi-cpol: true
  spi-cpha: true

  spi-rx-bus-width:
    description:
      Bus width to the SPI bus used for read transfers.
      If 0 is provided, then no RX will be possible on this device.
    type: integer
    typeSize: 32
    minimum: 1
    maximum: 4
    enum: [0, 1, 2, 4, 8]
    default: 1

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
    oneOf:
      - type: boolean
        const: true
      - type: 'null'
    description:
      When this flag is present, the REF Overvoltage Reduced Current protection
      is disabled.

  adi,no-ref-high-z:
    oneOf:
      - type: boolean
        const: true
      - type: 'null'
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

  spi-cs-high:
    oneOf:
      - type: boolean
        const: true
      - type: 'null'
    description:
      The device requires the chip select active high.

  spi-lsb-first:
    oneOf:
      - type: boolean
        const: true
      - type: 'null'
    description:
      The device requires the LSB first mode.

  spi-cs-setup-delay-ns:
    description:
      Delay in nanoseconds to be introduced by the controller after CS is
      asserted.

  spi-cs-hold-delay-ns:
    description:
      Delay in nanoseconds to be introduced by the controller before CS is
      de-asserted.

  spi-cs-inactive-delay-ns:
    description:
      Delay in nanoseconds to be introduced by the controller after CS is
      de-asserted.

  spi-rx-delay-us:
    description:
      Delay, in microseconds, after a read transfer.

  rx-sample-delay-ns:
    description: SPI Rx sample delay offset, unit is nanoseconds.
      The delay from the default sample time before the actual
      sample of the rxd input signal occurs.

  spi-tx-bus-width:
    description:
      Bus width to the SPI bus used for write transfers.
      If 0 is provided, then no TX will be possible on this device.
    type: integer
    typeSize: 32
    minimum: 0
    maximum: 0xffffffff
    enum: [0, 1, 2, 4, 8]
    default: 1

  spi-tx-delay-us:
    description:
      Delay, in microseconds, after a write transfer.

  stacked-memories:
    description: Several SPI memories can be wired in stacked mode.
      This basically means that either a device features several chip
      selects, or that different devices must be seen as a single
      bigger chip. This basically doubles (or more) the total address
      space with only a single additional wire, while still needing
      to repeat the commands when crossing a chip boundary. The size of
      each chip should be provided as members of the array.
    type: array
    items:
        type: integer
        typeSize: 64
        minimum: 0
        maximum: 0xffffffffffffffff
    minItems: 2
    maxItems: 4

  parallel-memories:
    description: Several SPI memories can be wired in parallel mode.
      The devices are physically on a different buses but will always
      act synchronously as each data word is spread across the
      different memories (eg. even bits are stored in one memory, odd
      bits in the other). This basically doubles the address space and
      the throughput while greatly complexifying the wiring because as
      many busses as devices must be wired. The size of each chip should
      be provided as members of the array.
    type: array
    items:
        type: integer
        typeSize: 64
        minimum: 0
        maximum: 0xffffffffffffffff
    minItems: 2
    maxItems: 4

  st,spi-midi-ns:
    description: |
      Only for STM32H7, (Master Inter-Data Idleness) minimum time
      delay in nanoseconds inserted between two consecutive data frames.

  multi-die:
    oneOf:
      - type: boolean
        const: true
      - type: 'null'
    description:
      The device consists of multiple memory die.

  in1-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in3-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in5-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in7-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in9-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in11-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in13-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  in15-supply: 
      description:
          Optional voltage supply for odd numbered channels when they are used as
          the negative input for a pseudo-differential channel.

  channel@0:
    type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@1:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@2:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@3:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@4:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@5:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@6:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@7:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@8:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@9:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg
      
  channel@a:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@b:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@c:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@d:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@e:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

  channel@f:
          type: object
    unevaluatedProperties: false
    description:
      Describes each individual channel. In addition the properties defined
      below, bipolar from adc.yaml is also supported.

    properties:
      reg:
        maxItems: 1
        maximum: 15

      common-mode-channel:
        description:
          Describes the common mode channel for single channels. 0xFF is REFGND
          and OxFE is COM. Macros are available for these values in
          dt-bindings/iio/adc/adi,ad4695.h. Values 1 to 15 correspond to INx
          inputs. Only odd numbered INx inputs can be used as common mode
          channels.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff
        enum: [1, 3, 5, 7, 9, 11, 13, 15, 0xFE, 0xFF]
        default: 0xFF

      adi,no-high-z:
        description:
          Enable this flag if the input pin requires the Analog Input High-Z
          Mode to be disabled for proper operation.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      $nodename:
        pattern: "^channel(@[0-9a-f]+)?$"
        description:
          A channel index should match reg.

      label:
        description: Unique name to identify which channel this is.

      bipolar:
        description: If provided, the channel is to be used in bipolar mode.
        oneOf:
          - type: boolean
            const: true
          - type: 'null'

      diff-channels:
        maxItems: 2
        minItems: 2
        description:
          Many ADCs have dual Muxes to allow different input pins to be routed
          to both the positive and negative inputs of a differential ADC.
          The first value specifies the positive input pin, the second
          specifies the negative input pin.
        type: array
        items:
          type: integer
          typeSize: 32
          minimum: 0
          maximum: 0xffffffff

      single-channel:
        description:
          When devices combine single-ended and differential channels, allow the
          channel for a single element to be specified, independent of reg (as for
          differential channels). If this and diff-channels are not present reg
          shall be used instead.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

      settling-time-us:
          description:
            Time between enabling the channel and first stable readings.

      oversampling-ratio:
        description:
          Oversampling is used as replacement of or addition to the low-pass filter.
          In some cases, the desired filtering characteristics are a function the
          device design and can interact with other characteristics such as
          settling time.
        type: integer
        typeSize: 32
        minimum: 0
        maximum: 0xffffffff

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
            __canary__: false
            bipolar: false

    anyOf:
      - oneOf:
          - required:
              - reg
              - diff-channels
          - required:
              - reg
              - single-channel
      - required:
          - reg

required:
  - compatible
  - reg
  - avdd-supply
  - vio-supply

allOf:
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

  # the internal reference buffer always requires high-z mode
  - if:
      required:
        - refin-supply
    then:
      properties:
        __canary__: false
        adi,no-ref-high-z: false

  # limit channels for 8-channel chips
  - if:
      properties:
        compatible:
          contains:
            enum:
              - adi,ad4697
              - adi,ad4698
    then:
      properties:
        __canary__: false

        in9-supply: false

        in11-supply: false

        in13-supply: false

        in15-supply: false

        channel@0:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@1:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@2:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@3:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@4:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@5:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@6:
          properties:
            reg:
              maximum: 7
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]
 
        channel@7:
          properties:
            reg:
              maximum: 7
            common-mode-channel:
              enum: [1, 3, 5, 7, 0xFE, 0xFF]

        channel@8: false

        channel@9: false

        channel@a: false

        channel@b: false

        channel@c: false

        channel@d: false

        channel@e: false

        channel@f: false

unevaluatedProperties: false

examples:
  - |
    #include <dt-bindings/gpio/gpio.h>
    #include <dt-bindings/iio/adc/adi,ad4695.h>

    spi {
        #address-cells = <1>;
        #size-cells = <0>;

        adc@0 {
            compatible = "adi,ad4695";
            reg = <0>;
            spi-cpol;
            spi-cpha;
            spi-max-frequency = <80000000>;
            avdd-supply = <&power_supply>;
            ldo-in-supply = <&power_supply>;
            vio-supply = <&io_supply>;
            refin-supply = <&supply_5V>;
            com-supply = <&supply_2V5>;
            in3-supply = <&supply_2V5>;
            reset-gpios = <&gpio 1 GPIO_ACTIVE_LOW>;

            #address-cells = <1>;
            #size-cells = <0>;

            /* Pseudo-differential channel between IN0 and REFGND. */
            channel@0 {
                reg = <0>;
            };

            /* Pseudo-differential channel between IN1 and COM. */
            channel@1 {
                reg = <1>;
                common-mode-channel = <AD4695_COMMON_MODE_COM>;
                bipolar;
            };

            /* Pseudo-differential channel between IN2 and IN3. */
            channel@2 {
                reg = <2>;
                common-mode-channel = <3>;
                bipolar;
            };
        };
    };

```