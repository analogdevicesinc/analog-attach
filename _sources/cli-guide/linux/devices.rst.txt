.. _cli-devices:

Devices
=======

This page shows how to find a device in the kernel's bindings, add it to the
overlay on the right bus, and then rename, move, turn off or remove nodes. How
to set the properties of a node is in :ref:`cli-properties`.

The running example adds an ADXL345 accelerometer (``adi,adxl345``) at I2C
address ``0x1d`` on the Raspberry Pi 4's ``i2c_arm`` bus, with its interrupt on
GPIO 27.

Find the device
---------------

``list devices`` searches the compatible strings of the kernel tree's
bindings. Give it part of the part number:

.. code-block:: text

   $ analog-attach list devices adxl
   adi,adxl312  iio/accel
   adi,adxl313  iio/accel
   adi,adxl314  iio/accel
   adi,adxl345  iio/accel
   adi,adxl346  iio/accel
   …

The second column is the binding's category (its folder under
``Documentation/devicetree/bindings``). When the filter is a compatible, or
only one compatible contains it, ``list devices`` describes that device:

.. code-block:: text

   $ analog-attach list devices adi,adxl345
   adi,adxl345
     Analog Devices ADXL345/ADXL375 3-Axis Digital Accelerometers
     …
     binding: /home/user/linux/Documentation/devicetree/bindings/iio/accel/adi,adxl345.yaml
     40 properties, 0 child node patterns

Without a filter, ``list devices`` lists every compatible of the tree.

.. tip::

   The kernel tree may already have an overlay with the device. ``list overlay
   adi,adxl345`` lists them; you can import one as a whole (see
   :ref:`cli-workfile`) or copy the device's node from it (see
   `Start from an example or an overlay`_).

Find the bus
------------

``list parent`` lists the nodes of the base devicetree the device can sit on:
for the ADXL345, which has an SPI and an I2C interface, every SPI and I2C
controller. Each is shown by its label, ready for ``--parent``, then its
path:

.. code-block:: text

   $ analog-attach list parent adi,adxl345
   spi     /soc/spi@7e204000
   spi1    /soc/spi@7e215080
   …
   i2c0if  /soc/i2c@7e205000
   i2c1    /soc/i2c@7e804000
   i2c3    /soc/i2c@7e205600
   …

A node can have several labels: ``i2c1`` and ``i2c_arm`` are the same
controller, ``/soc/i2c@7e804000``. ``list node`` shows them all:

.. code-block:: text

   $ analog-attach list node i2c_arm
   /soc/i2c@7e804000  &i2c_arm &i2c1  brcm,bcm2711-i2c, brcm,bcm2835-i2c  (off)

   1 node matches "i2c_arm".
   Use: analog-attach read <path>

``(off)`` means the base devicetree leaves the bus disabled. See `Turn nodes on
and off`_.

Add the device
--------------

Give the compatible, the bus, a label to refer to the node later and, for an
I2C device, its address in the node name:

.. code-block:: text

   $ analog-attach add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel
   Added adxl345@1d (label: accel) to /home/user/work/rpi4-adxl345/overlay.dtso
   Missing required: interrupt-parent, interrupts
   Set them with: update accel <property> <value>

``add`` writes the node with its ``compatible`` and its ``reg``, which follows
the unit address of the name. It then lists the required properties still to
set. Set them with ``update`` (see :ref:`cli-properties`).

.. list-table:: Options of ``add``
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Use
   * - ``--parent <node>``
     - The bus, as ``list parent`` shows it, or any node path. Without it, the
       node goes under the first bus ``list parent`` shows, and a note says
       which. **Always give it**: Analog Attach can't know how the device is
       wired.
   * - ``--label <label>``
     - The node's label. Without it, one is made up from the compatible.
   * - ``--name <name>``
     - The node's name. ``adxl345@1d`` also sets ``reg = <0x1d>``. A name
       without ``@`` keeps the unit address Analog Attach picks.
   * - ``--template <template>``
     - What the node starts from (see below). Default: ``required``.
   * - ``--dry-run``
     - Show the node ``add`` would write, and write nothing.
   * - ``--quiet``
     - On a terminal, list the missing properties instead of asking for them.

To see the node before writing it, add ``--dry-run``:

.. code-block:: text

   $ analog-attach add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel --dry-run
   Would add adxl345@1d (label: accel) to /home/user/work/rpi4-adxl345/overlay.dtso
   accel: adxl345@1d {
   	compatible = "adi,adxl345";
   	reg = <0x1d>;
   };

A compatible that the bindings don't have is refused, with the closest ones:

.. code-block:: text

   $ analog-attach add adi,adxl34
   Unknown compatible 'adi,adxl34'. Did you mean adi,adxl314, adi,adxl345, adi,adxl346? See: analog-attach list devices

On a terminal: the questions
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

On a terminal, ``add`` asks for what is missing. Without ``--parent``, it first
asks for the bus: type a letter, a label or a path. Then it asks for each
required property, with the binding's suggestions as lettered options:

.. code-block:: text

   $ analog-attach add adi,adxl345 --label accel
   Where does adi,adxl345 go? (Enter takes a, a letter picks, or type a label or path, Ctrl-D stops)
     a) spi  /soc/spi@7e204000
     …
     m) i2c6  /soc/i2c@7e205c00
   parent [a]: i2c_arm
   Added adi,adxl345@0 (label: accel) to /home/user/work/rpi4-adxl345/overlay.dtso
   Set reg = <0x2a> (from example 1); renamed to adi,adxl345@2a

   2 required properties to set (Enter takes the default, a letter picks an option, - skips, Ctrl-D stops)

   [1/2] interrupt-parent
     (adi,adxl345.yaml)
     a) gicv2 — interrupt controller, #interrupt-cells = <3>; inherited from /
     b) gpio — interrupt controller, #interrupt-cells = <2>
     c) aon_intr (disabled)
   interrupt-parent [a]: b
   Set interrupt-parent on accel

   [2/2] interrupts
     (adi,adxl345.yaml)
   interrupts 1/2 (number): 27
     interrupts = <27>;
     a) IRQ_TYPE_NONE
     b) IRQ_TYPE_EDGE_RISING
     …
   interrupts 2/2 [a]: b
     interrupts = <27 IRQ_TYPE_EDGE_RISING>;
   Set interrupts on accel

   All required properties are set.

* :kbd:`Enter` takes the default shown in brackets, ``-`` skips a property,
  and :kbd:`Ctrl-D` stops the questions (what is set stays set).
* Before the questions, ``add`` sets what the binding allows only one value
  for, and takes ``spi-max-frequency`` (SPI) or ``reg`` (I2C) from the
  binding's first example for that bus. Here it set ``reg = <0x2a>``, the
  example's address: the ADXL345 Click is at ``0x1d``, so set it with
  ``update accel reg 0x1d``. That renames the node to ``adi,adxl345@1d``
  (see :ref:`cli-properties`).

Piped, with ``--json`` or with ``--quiet``, ``add`` asks nothing and lists the
missing properties instead. To turn the questions off for good, run
``analog-attach config interview false``.

Start from an example or an overlay
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

``--template`` copies a whole node, children and references included:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Template
     - The node starts as
   * - ``required``
     - A bare node, then the missing required properties (the default).
   * - ``example:<N>``
     - Example ``N`` of the binding (1 is the first), as written.
   * - ``overlay:<name>``
     - The device's node from an overlay of the kernel tree (a name from
       ``list overlay``) or from a file. Without ``--parent``, it goes where
       the overlay puts it.

.. code-block:: text

   $ analog-attach add adi,adxl345 --parent i2c_arm --label accel --template example:1 --dry-run
   Copied example 1 of adi,adxl345.yaml (i2c)
   error: 1 reference points to a node neither the base nor the overlay has:
     accel  interrupt-parent → &gpio0
     fix with: update <node> <property> <value>, or delete <node> <property>
   Would add accelerometer@2a (label: accel) to /home/user/work/rpi4-adxl345/overlay.dtso
   accel: accelerometer@2a {
   	compatible = "adi,adxl345";
   	reg = <0x2a>;
   	interrupt-parent = <&gpio0>;
   	interrupts = <0 4>;
   };

A copied node keeps its name, ``reg`` and references as written: here the
example's address, interrupt and ``&gpio0``, which the Raspberry Pi 4 doesn't
have. ``add`` lists such references as errors to fix with ``update``.
``--name`` and ``--label`` apply to the copy.

List the nodes
--------------

``list node`` lists every node of the base devicetree with the overlay
applied, in tree order, with its labels and compatibles. Give a filter to see
the nodes whose name, label or compatible contains it:

.. code-block:: text

   $ analog-attach list node accel
   /soc/i2c@7e804000/adxl345@1d  &accel  adi,adxl345  (new)

   1 node matches "accel".
   Use: analog-attach read <path>

A node is tagged ``(new)`` when the overlay adds it, ``(changed)`` when the
overlay sets something on it, and ``(off)`` when its status isn't ``okay``.
``list property`` with no argument lists only the overlay's nodes.

Turn nodes on and off
---------------------

The Raspberry Pi 4 base devicetree leaves ``i2c_arm`` disabled, so Linux would
not probe the ADXL345. Enable it in the overlay:

.. code-block:: text

   $ analog-attach enable i2c_arm
   Enabled i2c_arm in /home/user/work/rpi4-adxl345/overlay.dtso

This writes ``status = "okay"`` on the bus. ``disable`` writes ``status =
"disabled"``, for example to turn off a base node that your device replaces,
such as a ``spidev`` on the same chip select:

.. code-block:: text

   $ analog-attach disable accel
   Disabled accel in /home/user/work/rpi4-adxl345/overlay.dtso
   $ analog-attach enable accel
   Enabled accel (as the overlay adds it: status removed from /home/user/work/rpi4-adxl345/overlay.dtso)

When the node already has the status you ask for without the overlay (a node
the overlay adds is enabled), the overlay's own ``status`` is removed rather
than written. ``validate`` warns about a device on a disabled bus (see
:ref:`cli-validate-build-deploy`).

Rename and move a node
----------------------

``rename`` changes a node's name. A name without ``@`` keeps the unit address;
a name with one changes it, and ``reg`` follows:

.. code-block:: text

   $ analog-attach rename accel adxl345
   Renamed accel to adxl345 in /home/user/work/rpi4-adxl345/overlay.dtso
   $ analog-attach rename accel adxl345@53
   reg first cell set to 0x53
   Renamed accel to adxl345@53 in /home/user/work/rpi4-adxl345/overlay.dtso

``move`` puts a node under another parent, for example another I2C bus:

.. code-block:: text

   $ analog-attach move accel i2c3
   Moved accel to i2c3 in /home/user/work/rpi4-adxl345/overlay.dtso

A move to a parent the device's binding doesn't allow is refused. ``move``
keeps the node's name and ``reg``, and doesn't check for an address clash on
the new bus: run ``validate`` afterwards.

Delete nodes and properties
---------------------------

.. code-block:: text

   $ analog-attach delete accel interrupts
   Removed interrupts from accel in /home/user/work/rpi4-adxl345/overlay.dtso
   $ analog-attach delete accel
   Deleted accel from /home/user/work/rpi4-adxl345/overlay.dtso

A node with children, and the whole overlay (``delete`` with no path), are
only previewed. Add ``--force`` to delete them:

.. code-block:: text

   $ analog-attach delete
   Would delete 1 node(s) and 4 property(ies)
     adxl345@1d
   $ analog-attach delete --force
   Deleted all overlay content from /home/user/work/rpi4-adxl345/overlay.dtso

``delete``, ``rename`` and ``move`` only change what the overlay adds. A node
of the base devicetree can't be removed by an overlay; disable it instead:

.. code-block:: text

   $ analog-attach delete i2c_arm
   i2c_arm is part of the base device tree (/home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts), not this overlay; delete only removes overlay-added nodes

Next steps
----------

* :ref:`cli-properties`: set ``interrupt-parent`` and ``interrupts``.
* :ref:`cli-validate-build-deploy`: check, build and deploy the overlay.
