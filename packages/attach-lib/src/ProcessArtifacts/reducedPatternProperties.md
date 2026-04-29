```
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
```