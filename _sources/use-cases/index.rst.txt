Use Cases
=========

Step-by-step walkthroughs on real hardware. Each one has the same layout, see
:ref:`use-case-template`.

.. toctree::
   :maxdepth: 2

   linux/ui/index
   linux/cli/index
   linux/ui-ai-agent/index
   linux/cli-ai-agent/index
   template

The hardware used:

.. list-table::
   :header-rows: 1

   * - Use case
     - Board
     - Part
   * - :doc:`linux/ui/index`, :doc:`linux/cli/index`,
       :doc:`linux/cli-ai-agent/index`
     - Raspberry Pi 4 Model B with ADI Kuiper
     - MikroElektronika Accel Click (ADXL345), on I2C
   * - :ref:`use-case-ui-ai-agent`
     - Alif Ensemble DK-E8, a board that boots one full devicetree rather than
       overlays
     - MikroElektronika ADAC Click (AD5593R), on I2C

The three Raspberry Pi use cases configure the same part on the same board,
so you can compare the GUI, the CLI and an AI agent. To add a use case, copy
:ref:`use-case-template` into a new folder next to these.
