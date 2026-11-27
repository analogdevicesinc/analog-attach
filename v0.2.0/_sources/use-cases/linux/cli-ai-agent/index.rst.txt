.. _use-case-cli-ai-agent:

Use case: CLI with an AI agent
==============================

Goal
----

Add an ADXL345 accelerometer to a Raspberry Pi 4 by asking an AI agent in a
terminal: Claude Code, with the ``analog-attach-linux`` skill, runs the
``analog-attach`` commands, and you answer its questions and approve the
deploy. At the end the overlay is on the board and the acceleration reads back
over the network.

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
       Claude Code, ``ssh``, ``scp`` and ``sshpass`` for the deploy, and the
       libiio tools (``iio_info``) to read the part
   * - Software versions
     - Analog Attach 0.2.0; the ADI Linux tree (``analogdevicesinc/linux``,
       its Raspberry Pi branch) in ``~/linux``

Steps
-----

Step 1: Wire the Click
~~~~~~~~~~~~~~~~~~~~~~

With the Pi off, connect the Click as in the table above.

Step 2: Install the skill
~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   analog-attach skill install analog-attach-linux

This copies the skill to ``~/.claude/skills/analog-attach-linux/``, where
Claude Code finds it. See :doc:`/ai-agents/index`.

Step 3: Start the agent in the project folder
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code-block:: bash

   mkdir -p ~/work/rpi4-adxl345 && cd ~/work/rpi4-adxl345
   claude

The project can be new: the agent sets it up. It asks for the kernel tree and
the board rather than guessing them. Answer ``~/linux`` and
``bcm2711-rpi-4-b.dts``, or set the project up first (see
:ref:`cli-configuration`).

Step 4: Ask for the device
~~~~~~~~~~~~~~~~~~~~~~~~~~

Type, for example:

   Add an ADXL345 accelerometer on the Raspberry Pi's I2C bus at 0x1d,
   interrupt on GPIO 27 rising edge, then validate and build.

The agent runs ``analog-attach`` commands with ``--json`` and reads their
answers. Claude Code shows each command and asks before it runs one you
haven't allowed. The commands differ from run to run; a run goes like this:

.. list-table::
   :header-rows: 1
   :widths: 55 45

   * - Command
     - What it is for
   * - ``analog-attach --json config``
     - What the project has set. For a new project, ``config backend``,
       ``config linux``, ``list context rpi-4``, ``config devicetree``,
       ``config workfile`` and ``init`` follow.
   * - ``analog-attach --json list devices adxl345``
     - The compatible: ``adi,adxl345``.
   * - ``analog-attach --json list overlay adi,adxl345``
     - Whether the kernel tree has an overlay to start from
       (``i2c-sensor-overlay.dts``). The agent may offer it.
   * - ``analog-attach --json list parent adi,adxl345``
     - The buses. You named the I2C bus, so it takes ``i2c_arm`` (``i2c1``),
       or asks which one.
   * - ``analog-attach --json add adi,adxl345 --parent i2c_arm --name adxl345@1d``
     - The node, at ``0x1d``. The answer lists ``interrupt-parent`` and
       ``interrupts`` in ``missing_required``.
   * - ``analog-attach --json list value adxl345 interrupt-parent``
     - The interrupt controllers: ``gpio`` for a GPIO line.
   * - ``analog-attach --json update adxl345 interrupt-parent '&gpio'``
     - The GPIO controller as the interrupt parent.
   * - ``analog-attach --json update adxl345 interrupts 27 IRQ_TYPE_EDGE_RISING``
     - GPIO 27, rising edge, as you said.
   * - ``analog-attach --json validate``
     - A warning: the bus is disabled, Linux won't probe the device.
   * - ``analog-attach --json enable i2c_arm``
     - Turns the bus on in the overlay.
   * - ``analog-attach --json validate``
     - No errors.
   * - ``analog-attach --json build``
     - ``build/overlay.dtbo``.

When it is done, the agent says what it wrote, and offers to deploy.

Step 5: Deploy
~~~~~~~~~~~~~~

Deploy copies the overlay to the Pi and **reboots it**, so the agent asks
first. Tell it the Pi's address and password, for example *deploy it to
10.42.0.196, user analog*. It then runs:

.. code-block:: bash

   analog-attach --json config var BOARD_IP 10.42.0.196
   BOARD_PASSWORD=… analog-attach --json deploy

The password goes in the environment of ``deploy`` only, never in a file.
Approve the command when Claude Code asks. To keep the password out of the
conversation, run the deploy yourself instead: ``analog-attach deploy`` asks
for it, hidden.

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

With the board lying flat, X and Y are close to 0 and Z reads about 253: 1 g.
You can also ask the agent to explain the workfile, or to change it: each
change is another ``update``, and the agent validates again.

The workfile, as in :doc:`/use-cases/linux/cli/index` (the node's name and
label are the agent's choice and may differ):

.. code-block:: dts

   /dts-v1/;
   /plugin/;
   / {
   	fragment@0 {
   		target = <&i2c_arm>;
   		__overlay__ {
   			status = "okay";
   			adxl345: adxl345@1d {
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

- **The agent doesn't use analog-attach.** Check that the skill is installed
  (``analog-attach skill install`` lists it as ``installed``), and start
  ``claude`` again after installing it.
- **The agent guesses the wiring.** Say the bus, address and interrupt in the
  prompt, as above, and check what it set before you deploy:
  ``analog-attach read adxl345``.
- **No adxl345 in iio_info.** See the troubleshooting of
  :doc:`/use-cases/linux/cli/index`.

Next steps
----------

- :ref:`use-case-ui-ai-agent`: an agent in the GUI, as its Assistant.
- :doc:`/ai-agents/index`: the skill, and what the agent does on its own.
