My First DTS
============

This tutorial walks you through creating your first device tree overlay using
Analog Attach. By the end, you will have a working overlay that configures an
AD7124-8 ADC on SPI, complete with clock and voltage regulator definitions.

The video below demonstrates the complete workflow for creating an AD7124 overlay
using the Plug and Play editor.

.. video:: https://raw.githubusercontent.com/analogdevicesinc/analog-attach/doc_resources/resources/ad7124-overlay-creation-with-AA.mp4

   Step by step guide to creating a dtso file with Analog Attach

Final Result
------------

After following the steps in the video, your ``.dtso`` file should look like this:

.. code-block:: dts

   /dts-v1/;
   /plugin/;

   &spi0 {
       status = "okay";
       ad7124-8@1 {
           status = "okay";
           compatible = "adi,ad7124-8";
           reg = <1>;
           clocks = <&ad7124_mclk>;
           clock-names = "mclk";
           interrupts = <25 2>;
           interrupt-parent = <&gpio>;
           refin1-supply = <&vref>;
           spi-max-frequency = <500000>;

           channel@0 {
               reg = <0>;
               diff-channels = <0 19>;
           };

           channel@1 {
               reg = <1>;
               diff-channels = <1 19>;
           };
       };
   };

   &{/clocks} {
       status = "okay";
       ad7124_mclk: fixed-clock {
           status = "okay";
           compatible = "fixed-clock";
           #clock-cells = <0>;
           clock-frequency = <614400>;
       };
   };

   &{/} {
       status = "okay";
       vref: regulator-fixed {
           status = "okay";
           compatible = "regulator-fixed";
           regulator-name = "fixed-supply";
           regulator-min-microvolt = <2500000>;
           regulator-max-microvolt = <2500000>;
           regulator-boot-on;
       };
   };

This overlay:

- Attaches an AD7124-8 ADC to ``spi0`` at chip select 1
- Configures two differential input channels
- Defines a fixed clock source for the ADC
- Creates a fixed voltage regulator for the reference input
