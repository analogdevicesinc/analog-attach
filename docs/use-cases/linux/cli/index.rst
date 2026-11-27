.. _use-case-cli:

Use case: Configure a device with the CLI only
==============================================

Goal
----

Add an ADXL345 accelerometer to a Raspberry Pi 4 from the command line, with
no GUI: write the overlay, validate it, build it, deploy it to the board, and
read the acceleration back over the network.

What you need
-------------

.. list-table::
   :header-rows: 1

   * - Item
     - Details
   * - Board / carrier
     - Raspberry Pi 4 Model B, running ADI Kuiper
   * - Evaluation board / part
     - MikroElektronika Accel Click (ADXL345), set for I2C at address
       ``0x1d`` with its jumpers
   * - Wiring
     - Five jumper wires from the Click to the Pi's 40-pin header:

       ========== ==========================
       Click      Raspberry Pi header
       ========== ==========================
       3V3        pin 1 (3.3 V)
       GND        pin 6 (GND)
       SDA        pin 3 (GPIO 2, I2C1 SDA)
       SCL        pin 5 (GPIO 3, I2C1 SCL)
       INT        pin 13 (GPIO 27)
       ========== ==========================
   * - Cables and power
     - The Pi's USB-C power supply; an Ethernet cable from the Pi to the host.
       Here the host shares its connection over that cable, and the Pi gets
       ``10.42.0.196``. Any address the host can reach works.
   * - Host
     - Linux machine with Analog Attach installed (see :doc:`/install/index`),
       ``ssh``, ``scp`` and ``sshpass`` for the deploy, and the libiio tools
       (``iio_info``) to read the part
   * - Software versions
     - Analog Attach 0.2.0; the ADI Linux tree (``analogdevicesinc/linux``,
       its Raspberry Pi branch) in ``~/linux``

Steps
-----

Step 1: Wire the Click
~~~~~~~~~~~~~~~~~~~~~~

With the Pi off, connect the Click as in the table above. On the Pi 4,
GPIO 2 and 3 are the I2C bus the kernel calls ``i2c1``, labelled ``i2c_arm``
in its devicetree.

Step 2: Set up the project
~~~~~~~~~~~~~~~~~~~~~~~~~~

Create the project folder and give it the backend, the kernel tree, the
board's devicetree and a name for the overlay. Setting ``linux`` builds the
binding caches:

.. code-block:: text

   $ mkdir -p ~/work/rpi4-adxl345 && cd ~/work/rpi4-adxl345
   $ analog-attach config backend linux
   Set backend = linux
   $ analog-attach config linux ~/linux
   Indexing device bindings and compiling binding schemas...
   Set linux = /home/user/linux; Indexed 20263 compatibles from 4479 bindings and compiled binding schemas in 6.3s
   $ analog-attach list context rpi-4-b
   /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
   /home/user/linux/arch/arm64/boot/dts/broadcom/bcm2711-rpi-4-b.dts

   2 devicetrees in /home/user/linux.
   Use: analog-attach config devicetree <path>
   $ analog-attach config devicetree ~/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
   Set devicetree = /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
   $ analog-attach config workfile overlay.dtso
   Set workfile = /home/user/work/rpi4-adxl345/overlay.dtso (not created yet: 'analog-attach init' creates it)
   $ analog-attach init
   Workspace ready
   …

On a terminal, ``analog-attach`` with no arguments asks for the same, step by
step (see :ref:`cli-configuration`).

Step 3: Find the device and its bus
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: text

   $ analog-attach list devices adxl345
   adi,adxl345
     Analog Devices ADXL345/ADXL375 3-Axis Digital Accelerometers
   …
   $ analog-attach list parent adi,adxl345
   spi  /soc/spi@7e204000
   …
   i2c1  /soc/i2c@7e804000
   …

``list parent`` lists each bus by its first label: ``i2c1`` is the bus on
GPIO 2 and 3, and ``i2c_arm`` is another label of it. ``list overlay
adi,adxl345`` shows that the kernel tree has an overlay for it
(``i2c-sensor-overlay.dts``); this use case writes the node by hand instead.

Step 4: Add the ADXL345 and set its interrupt
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

The name ``adxl345@1d`` sets ``reg`` to ``0x1d``:

.. code-block:: text

   $ analog-attach add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel
   Added adxl345@1d (label: accel) to /home/user/work/rpi4-adxl345/overlay.dtso
   Missing required: interrupt-parent, interrupts
   Set them with: update accel <property> <value>

On a terminal, without ``--quiet``, ``add`` asks for the two missing
properties instead. The interrupt is GPIO 27, so its controller is ``gpio``:

.. code-block:: text

   $ analog-attach list value accel interrupt-parent
   gpio	gpio — interrupt controller, #interrupt-cells = <2>; the node's own
   gicv2	gicv2 — interrupt controller, #interrupt-cells = <3>
   $ analog-attach update accel interrupt-parent '&gpio'
   Set interrupt-parent on accel
   $ analog-attach update accel interrupts 27 IRQ_TYPE_EDGE_RISING
   Set interrupts on accel

Step 5: Validate
~~~~~~~~~~~~~~~~

.. code-block:: text

   $ analog-attach validate
   accel:
     warning: (node): parent i2c@7e804000 is not enabled (status "disabled"): Linux won't probe adxl345@1d
       note: Enable it: enable /soc/i2c@7e804000
   No errors! (1 warning(s))

``i2c_arm`` is disabled in the Pi 4's base devicetree. Enable it in the
overlay and validate again:

.. code-block:: text

   $ analog-attach enable i2c_arm
   Enabled i2c_arm in /home/user/work/rpi4-adxl345/overlay.dtso
   $ analog-attach validate
   No errors!

Step 6: Build and deploy
~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: text

   $ analog-attach build
   Building /home/user/work/rpi4-adxl345/overlay.dtso with AA_BUILD
   dtc -@ -I dts -O dtb -o /home/user/work/rpi4-adxl345/build/overlay.dtbo /home/user/work/rpi4-adxl345/overlay.dtso
   …
   Build completed successfully

     /home/user/work/rpi4-adxl345/build/overlay.dtbo

``dtc`` warns about ``reg`` because it compiles the fragment without the bus it
targets; those warnings are expected for an overlay.

The starter deploy script logs in as ``BOARD_USER`` at ``BOARD_IP``, by default
``analog`` at ``analog.local``. Set the Pi's address, then deploy:

.. code-block:: text

   $ analog-attach config var BOARD_IP 10.42.0.196
   Set variable BOARD_IP = 10.42.0.196
   $ analog-attach deploy

``deploy`` asks for ``BOARD_PASSWORD`` (or takes it from the environment:
``BOARD_PASSWORD=… analog-attach deploy``), copies ``overlay.dtbo`` to the
boot folder's ``overlays/``, adds ``dtoverlay=overlay`` to ``config.txt``, and
reboots the Pi. It ends with ``Deploy completed successfully``.

Result
------

When the Pi is back, the ADXL345 is an IIO device:

.. code-block:: bash

   iio_info -u ip:10.42.0.196 | grep -A3 adxl345

lists ``adxl345`` with its channels ``accel_x``, ``accel_y`` and ``accel_z``.
Read the raw values on the Pi:

.. code-block:: text

   $ ssh analog@10.42.0.196
   $ cd /sys/bus/iio/devices/iio:device0     # the device whose name is adxl345
   $ cat name in_accel_x_raw in_accel_y_raw in_accel_z_raw
   adxl345
   2
   1
   253

With the board lying flat, X and Y are close to 0 and Z reads about 253: 1 g,
gravity, at about 3.9 mg per count. Tilt the board and the values follow.

The workfile:

.. code-block:: dts

   /dts-v1/;
   /plugin/;
   / {
   	fragment@0 {
   		target = <&i2c_arm>;
   		__overlay__ {
   			status = "okay";
   			accel: adxl345@1d {
   				compatible = "adi,adxl345";
   				reg = <0x1d>;
   				interrupt-parent = <&gpio>;
   				interrupts = <27 1>;
   			};
   		};
   	};
   };

Troubleshooting
---------------

- **No adxl345 in iio_info.** On the Pi, ``sudo i2cdetect -y 1`` should show
  ``UU`` at ``1d``. A number there means the driver didn't bind: check
  ``dmesg`` and that ``dtoverlay=overlay`` is in ``config.txt``. A number at
  ``53`` instead means the Click's address jumper is the other way: set
  ``update accel reg 0x53`` (the node becomes ``adxl345@53``), then build and
  deploy again. Nothing at all: check the wiring.
- **Deploy can't reach the Pi.** ``analog.local`` needs mDNS; use the Pi's IP
  address in ``BOARD_IP``. See :doc:`/troubleshooting/index`.

Next steps
----------

- :doc:`/use-cases/linux/ui/index`: the same with the GUI.
- :doc:`/use-cases/linux/cli-ai-agent/index`: the same with an AI agent.
- :ref:`cli-guide`: every command in detail.
