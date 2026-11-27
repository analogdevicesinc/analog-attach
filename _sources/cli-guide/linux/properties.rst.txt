.. _cli-properties:

Properties
==========

Once a device is in the overlay (see :ref:`cli-devices`), its properties say
how it is wired: its address, its interrupt line, its GPIOs, its supplies. This
page shows how to find what a node needs, what values a property can take, and
how to set and remove them.

The running example finishes the ADXL345 that ``add`` left with two required
properties missing:

.. code-block:: text

   $ analog-attach read accel
   accel: adxl345@1d {
       compatible = "adi,adxl345";
       reg = <0x1d>;
   };
   Missing required: interrupt-parent, interrupts

What a node can have
--------------------

``list property`` lists the properties the node's binding defines, with their
types. ``set`` marks those the node has, ``required`` those it must have:

.. code-block:: text

   $ analog-attach list property accel
   compatible        (set, required)  enum("adi,adxl346", "adi,adxl345" | adi,adxl345 | adi,adxl375)
   reg               (set, required)  number[1]
   interrupts        (required)       (number, number, enum(IRQ_TYPE_NONE | IRQ_TYPE_EDGE_RISING | …))[3]
   interrupt-parent                   enum(gpio | gicv2 | aon_intr)
   status                             enum(okay | disabled | reserved | fail | fail-needs-probe)
   …

Give a property to see its description and constraints:

.. code-block:: text

   $ analog-attach list property accel reg
   reg (required): number[1]
     Chip select used by the device.

``read <node> <property>`` shows a property's current value with the same
explanation, and the suggestions (see :ref:`cli-workfile`).

What values a property can take
-------------------------------

``list value`` lists the values that fit, each ready to pass to ``update``. For
a reference such as ``interrupt-parent``, those are the nodes of the base and
the overlay that can be named:

.. code-block:: text

   $ analog-attach list value accel interrupt-parent
   gpio   gpio — interrupt controller, #interrupt-cells = <2>; the node's own
   gicv2  gicv2 — interrupt controller, #interrupt-cells = <3>

``update --suggest <node> <property>`` answers the same, and sets nothing. For
the wiring (``reg``, ``interrupts``, ``*-gpios``), the values come from your
board's schematic: the suggestions only tell you what the binding accepts.

Set a property
--------------

``update <node> <property> <value>...`` sets a property, replacing the value it
had. The ADXL345's interrupt pin is on GPIO 27, rising edge:

.. code-block:: text

   $ analog-attach update accel interrupt-parent gpio
   Set interrupt-parent on accel
   $ analog-attach update accel interrupts 27 IRQ_TYPE_EDGE_RISING
   Set interrupts on accel
   $ analog-attach read accel interrupts
   interrupts = <27 1>;
     (adi,adxl345.yaml)

Set ``interrupt-parent`` before ``interrupts``: the interrupt controller decides
how many cells ``interrupts`` has.

``update`` can set a property of a base node too. The overlay then changes it
on the board: ``update i2c_arm clock-frequency 400000``.

Value syntax
~~~~~~~~~~~~

The values after the property name are joined with spaces, so
``update accel interrupts 27 1`` and ``update accel interrupts "27 1"`` are the
same.

.. list-table::
   :header-rows: 1
   :widths: 25 35 40

   * - Value
     - Example
     - Written as
   * - Numbers, decimal or hexadecimal
     - ``update accel reg 0x1d``
     - ``reg = <0x1d>;``
   * - Several cells
     - ``update accel interrupts 27 1``
     - ``interrupts = <27 1>;``
   * - Macros (``IRQ_TYPE_…``, ``GPIO_…``)
     - ``update accel interrupts 27 IRQ_TYPE_EDGE_RISING``
     - ``interrupts = <27 1>;`` (the macro's value)
   * - A label, with or without ``&``
     - ``update accel interrupt-parent gpio``
     - ``interrupt-parent = <&gpio>;``
   * - Rows, separated by ``,``
     - ``update adc reset-gpios gpio 5 0, gpio 6 0``
     - ``reset-gpios = <&gpio 5 0>, <&gpio 6 0>;``
   * - Words, where the binding expects strings
     - ``update accel status okay``
     - ``status = "okay";``
   * - No value: a flag
     - ``update accel wakeup-source``
     - ``wakeup-source;``
   * - Negative numbers
     - ``update adc offset -5``
     - ``offset = <(-5)>;``

Quote what your shell would change: a property name that starts with ``#``
(``update adc '#address-cells' 1``), and a string with spaces.

Checks and warnings
~~~~~~~~~~~~~~~~~~~

``update`` checks each value against the node's binding:

* A value that can't be built is refused, and nothing is written:

  .. code-block:: text

     $ analog-attach update accel interrupts 27 RISING
     'RISING' is not a number, a known macro, or a label in the base tree/overlay

* A value the binding doesn't allow is written, with a warning on standard
  error, so that you can set values the binding is stricter about than the
  driver:

  .. code-block:: text

     $ analog-attach update accel status bogus
     warning: status takes one of okay, disabled, reserved, fail, fail-needs-probe, got bogus
     Set status on accel
     $ analog-attach update accel interrupts 27 1 5
     warning: interrupts takes 2 values, got 3
     Set interrupts on accel

* A property the binding doesn't define is written without checking:

  .. code-block:: text

     $ analog-attach update accel foo-bar 3
     Property foo-bar not defined by adi,adxl345 binding; written without schema validation
     Set foo-bar on accel

``validate`` reports what is still wrong (see :ref:`cli-validate-build-deploy`).

The address: ``reg``
~~~~~~~~~~~~~~~~~~~~

Setting ``reg`` also renames the node, so that its unit address matches:

.. code-block:: text

   $ analog-attach update accel reg 0x53
   Set reg on accel; renamed to adxl345@53

``update`` warns when another device on the bus already uses that address or
chip select. ``rename accel adxl345@53`` does the same from the other side (see
:ref:`cli-devices`).

Child nodes
~~~~~~~~~~~

Some devices have child nodes, such as the channels of an ADC. When the name
is a child node of the binding, ``update`` with no value creates it and lists
its required properties. Then set them with the child's path:

.. code-block:: text

   $ analog-attach update adc channel@0
   Added channel@0 to adc
   Missing required: diff-channels
   Set them with: update adc/channel@0 <property> <value>
   $ analog-attach update adc/channel@0 diff-channels 0 1
   Set diff-channels on adc/channel@0

On a terminal, ``update`` asks for the child's required properties, as ``add``
does.

Remove a property
-----------------

.. code-block:: text

   $ analog-attach delete accel wakeup-source
   Removed wakeup-source from accel in /home/user/work/rpi4-adxl345/overlay.dtso

``delete`` removes what the overlay sets. A property of the base devicetree
stays as the base has it.

Let the shell complete it
-------------------------

With shell completion installed, :kbd:`Tab` completes node paths, property
names and values from the binding and the board, for example after
``analog-attach update accel interrupt-parent``. See :doc:`/cli-guide/shell-completion`.

Next steps
----------

:ref:`cli-validate-build-deploy`: check the overlay against the bindings, then
build and deploy it.
