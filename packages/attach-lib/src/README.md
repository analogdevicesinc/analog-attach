# AttachLib

## Why

- There is a lot of tribal knowledge in the embedded space, reliable documentation is hard to find 
- A push to make writing devicetrees more accessible has already been done in the form of [devicetree bindings](https://docs.kernel.org/devicetree/index.html#devicetree-bindings) which should be human readable and machine parsable
- For now the only tooling leveraging this is [dt-schema](https://github.com/devicetree-org/dt-schema) which defines a meta-schema for the bindings that is used to impose a specific way that a schema can be written 
- Trying to actually use a binding as a reference won't get you very far without a lot of prior knowledge
- Devicetrees offer a lot of hidden information about the nodes in them and how those might be used
- Combining information provided from bindings with information provided from devicetrees and using some of that tribal knowledge, a more clearer picture can be painted for someone who just want's to add a device to a devicetree

## How

### Prerequisites

- Local cache of the bindings from a linux repo + the dt-schema bindings
- A preprocessed devicetree that will be parsed by [dts](./dts/README.md)

### Procedure

####  1. Parse file to object

We use a [$RefParser](https://github.com/APIDevTools/json-schema-ref-parser) to parse and resolve all the [$ref](https://www.learnjsonschema.com/2019-09/core/ref/) in the binding and it's referenced bindings.

The [$RefParser](https://github.com/APIDevTools/json-schema-ref-parser) uses a [custom resolver](https://apidevtools.com/json-schema-ref-parser/docs/plugins/resolvers.html) that looks for the files in the local cache of bindings.

The resulting object is cast to a [DtBindingSchema](./DtBindingSchema.ts) which is just a type based on the [base schema](https://github.com/devicetree-org/dt-schema/blob/main/dtschema/meta-schemas/base.yaml) 

#### 2. Iron out binding quirks

The [$RefParser](https://github.com/APIDevTools/json-schema-ref-parser) preserves the root properties over what a [$ref](https://www.learnjsonschema.com/2019-09/core/ref/) might bring.

Bindings sometimes mark properties that are $ref'd with a `true` to signal that the definition from $ref applies, for such cases we have to look in the [$RefParser](https://github.com/APIDevTools/json-schema-ref-parser) in the [$refs](https://apidevtools.com/json-schema-ref-parser/docs/ref-parser.html#refs) and find the right definition.

#### 3. Merge root binding redefinitions with source of original definition

Common properties that are ref'd might get additional constraints.
In such cases we want to merge the common definition in the more specific one from the root binding.

Example:

```
spi-max-frequency:
  maximum: 2000000
```

with 

```
 spi-max-frequency: 
  description: "Maximum SPI clocking speed of the device in Hz."
  type: integer
  typeSize: 32
  minimum: 0
  maximum: 4294967295
```

turn into 

```
 spi-max-frequency: 
  description: "Maximum SPI clocking speed of the device in Hz."
  type: integer
  typeSize: 32
  minimum: 0
  maximum: 2000000
```

This applies to `allOf` referencing and also plain `$ref`.

#### 4. Plant canaries

Now we insert in every `then`/`else` branch a "canary" that will act as an `assert(false)` so that we can feed the binding in a jsonschema validator and whenever we get an update to the data we can run the validation and have "the canary die" on the branches that need to be applied.

#### 5. Populate with tribal knowledge 

TODO : https://github.com/analogdevicesinc/linux/blob/main/Documentation/devicetree/bindings/iio/imu/adi%2Cadis16475.yaml#L50
with https://github.com/analogdevicesinc/linux/blob/2449a083d718d25dcb5b83afa3aa765c3ed8529d/Documentation/devicetree/bindings/spi/spi-controller.yaml#L120

??? default behavior for spi-cpol, spi-cpha and other stuff like -ns/-kbps that are taken from bindings that aren't ref'd ???

After extracting all the information possible from the bindings we introduce information from the devicetree:

1. Each property shall be inspected and if there is a [*preprocess rule*](#preprocess-rules) for it, it shall be executed
2. The result shall be a modification to the binding in whatever form needed to express the new information

Additional properties like `status` can be added in this phase.

#### 6. Make the binding jsonschema compatible

Binding need some modification to be fully compatible with jsonschema.

Most of the time it's only a matter of adding a `type` to a property, and mostly it's about `array` properties.

Sometimes it's needed to make a binding compatible with a certain jsonschema draft version:
  1. `additionalProperties` => `unevaluatedProperties`
  2. `items` (in certain cases) => `prefixItems`

#### Result and How to use

TBD

### Preprocess rules

A preprocess rule is tribal knowledge in the form of queries to the devicetree.

For example a binding can't meaningfully describe a `clocks` property because it has no notion of the rest of the devicetree, the input could be a simple phandle to a defined clock or addressing a clock generator with a phandle and an address.

Raspberry 4 logical clock definition: 

```
 clocks {

  clk_osc: clk-osc {
   compatible = "fixed-clock";
   #clock-cells = <0>;
   clock-output-names = "osc";
   clock-frequency = <19200000>;
  };

  ad7124_mclk: clock@0 {
    #clock-cells = <0>;
    compatible = "fixed-clock";
    clock-frequency = <614400>;
  };

  clk_usb: clk-usb {
   compatible = "fixed-clock";
   #clock-cells = <0>;
   clock-output-names = "otg";
   clock-frequency = <480000000>;
  };
 };
```

Raspberry 4 physical clock controller:

```

  clocks: cprman@7e101000 {
   compatible = "brcm,bcm2835-cprman";
   #clock-cells = <1>;
   reg = <0x7e101000 0x2000>;





   clocks = <&clk_osc>,
    <&dsi0 0>, <&dsi0 1>, <&dsi0 2>,
    <&dsi1 0>, <&dsi1 1>, <&dsi1 2>;
  };


```

[Xilinx clock generator:](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/2739601409/Common+Clock+Framework+for+Zynq)

```
 clkc: clkc@100 {
    bootph-all;
    #clock-cells = <1>;
    compatible = "xlnx,ps7-clkc";
    fclk-enable = <0xf>;
    clock-output-names = "armpll", "ddrpll", "iopll", "cpu_6or4x",
      "cpu_3or2x", "cpu_2x", "cpu_1x", "ddr2x", "ddr3x",
      "dci", "lqspi", "smc", "pcap", "gem0", "gem1",
      "fclk0", "fclk1", "fclk2", "fclk3", "can0", "can1",
      "sdio0", "sdio1", "uart0", "uart1", "spi0", "spi1",
      "dma", "usb0_aper", "usb1_aper", "gem0_aper",
      "gem1_aper", "sdio0_aper", "sdio1_aper",
      "spi0_aper", "spi1_aper", "can0_aper", "can1_aper",
      "i2c0_aper", "i2c1_aper", "uart0_aper", "uart1_aper",
      "gpio_aper", "lqspi_aper", "smc_aper", "swdt",
      "dbg_trc", "dbg_apb";
    reg = <0x100 0x100>;
   };

```