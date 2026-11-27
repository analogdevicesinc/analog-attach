Quick Start
===========

From an installed Analog Attach (see :doc:`/install/index`) to an overlay on
the board, with the CLI. The example adds an ADXL345 accelerometer
(``adi,adxl345``) to a Raspberry Pi 4 running Kuiper: on the I2C bus
``i2c_arm`` (also labelled ``i2c1``) at address ``0x1d``, with its interrupt on
GPIO 27, rising edge. The Linux kernel tree is in ``~/linux``. Outputs are
shortened where marked with ``…``.

#. Create the project folder and point it to the kernel tree. Setting
   ``linux`` builds the binding caches:

   .. code-block:: text

      $ mkdir -p ~/work/rpi4-adxl345 && cd ~/work/rpi4-adxl345
      $ analog-attach config backend linux
      Set backend = linux
      $ analog-attach config linux ~/linux
      Indexing device bindings and compiling binding schemas...
      Set linux = /home/user/linux; Indexed 20263 compatibles from 4479 bindings and compiled binding schemas in 6.3s

#. Choose the board's devicetree and name the overlay:

   .. code-block:: text

      $ analog-attach config devicetree ~/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
      Set devicetree = /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
      $ analog-attach config workfile overlay.dtso
      Set workfile = /home/user/work/rpi4-adxl345/overlay.dtso (not created yet: 'analog-attach init' creates it)

#. Create the overlay and the build and deploy scripts:

   .. code-block:: text

      $ analog-attach init
      Workspace ready

        Linux:         /home/user/linux
        Devicetree:    /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
        Overlay:       /home/user/work/rpi4-adxl345/overlay.dtso (created)
        aa_build.sh:   /home/user/work/rpi4-adxl345/aa_build.sh (created)
        aa_deploy.sh:  /home/user/work/rpi4-adxl345/aa_deploy.sh (created)
        Variables:     BOARD_IP = analog.local, BOARD_USER = analog, BOARD_PASSWORD as a secret (set now)
      …

#. Find the device:

   .. code-block:: text

      $ analog-attach list devices adxl345
      adi,adxl345
        Analog Devices ADXL345/ADXL375 3-Axis Digital Accelerometers
      …

#. Add it on ``i2c_arm`` at ``0x1d`` (the name sets ``reg``):

   .. code-block:: text

      $ analog-attach add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel
      Added adxl345@1d (label: accel) to /home/user/work/rpi4-adxl345/overlay.dtso
      Missing required: interrupt-parent, interrupts
      Set them with: update accel <property> <value>

#. Set the interrupt, GPIO 27 on a rising edge:

   .. code-block:: text

      $ analog-attach update accel interrupt-parent '&gpio'
      Set interrupt-parent on accel
      $ analog-attach update accel interrupts 27 IRQ_TYPE_EDGE_RISING
      Set interrupts on accel

#. Validate. ``i2c_arm`` is disabled in the base devicetree, so enable it:

   .. code-block:: text

      $ analog-attach validate
      accel:
        warning: (node): parent i2c@7e804000 is not enabled (status "disabled"): Linux won't probe adxl345@1d
          note: Enable it: enable /soc/i2c@7e804000
      No errors! (1 warning(s))
      $ analog-attach enable i2c_arm
      Enabled i2c_arm in /home/user/work/rpi4-adxl345/overlay.dtso
      $ analog-attach validate
      No errors!

#. Build the ``.dtbo``. ``dtc`` warns about ``reg`` because it compiles the
   fragment without its target bus; the warnings are expected:

   .. code-block:: text

      $ analog-attach build
      Building /home/user/work/rpi4-adxl345/overlay.dtso with AA_BUILD
      dtc -@ -I dts -O dtb -o /home/user/work/rpi4-adxl345/build/overlay.dtbo /home/user/work/rpi4-adxl345/overlay.dtso
      …
      Build completed successfully

        /home/user/work/rpi4-adxl345/build/overlay.dtbo

#. Give the board's address (the default is ``analog.local``) and deploy.
   ``deploy`` asks for the board's password (user ``analog``), copies the
   overlay to the boot folder, adds ``dtoverlay=overlay`` to ``config.txt``
   and reboots the board:

   .. code-block:: text

      $ analog-attach config var BOARD_IP 10.42.0.196
      Set variable BOARD_IP = 10.42.0.196
      $ analog-attach deploy
      …
      Deploying /home/user/work/rpi4-adxl345/build/overlay.dtbo with AA_DEPLOY
      Checking analog@10.42.0.196
      Copying overlay.dtbo to analog@10.42.0.196:<boot folder>/overlays/overlay.dtbo
      …
      Rebooting analog@10.42.0.196
      Deploy completed successfully

#. When the board is back, check that the driver probed. The device
   ``adxl345`` is listed, with its ``accel_x``, ``accel_y`` and ``accel_z``
   channels:

   .. code-block:: bash

      iio_info -u ip:10.42.0.196 | grep -A3 adxl345

The full walkthrough, with the wiring and the readings, is
:doc:`/use-cases/linux/cli/index`. To do the same in the GUI, see
:doc:`/use-cases/linux/ui/index`, or watch the walkthrough video of
:ref:`use-case-ui-ai-agent`, which shows the GUI from setup to a running
board.
