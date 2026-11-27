Workfile
========

The workfile is the devicetree overlay that Analog Attach creates and edits.
Which file it is, is decided by the ``workfile`` setting
(:doc:`/reference/configuration-file`).

How the workfile is created
---------------------------

#. The ``workfile`` setting names the file. Set it with
   ``analog-attach config workfile <name>`` or when answering the questions of
   a bare ``analog-attach`` run.
#. ``analog-attach init`` checks that the Linux kernel tree and the base
   devicetree are configured and load correctly. It does not read or validate
   the overlay.
#. If the named file exists, ``init`` keeps it. Otherwise it creates it at that
   path.

``init`` never overwrites a file and never picks another name. If the path
names something that is not a file, or its folder does not exist, ``init``
refuses and tells you to configure another with
``analog-attach config workfile <name>``.

``init`` changes no setting, builds no cache and adds no device. Use
``analog-attach add`` for that.

A new workfile is an empty overlay, with a blank line before the root node
(28 bytes, ending in a newline):

.. code-block:: dts

   /dts-v1/;
   /plugin/;

   / {
   };

The first command that writes the file prints it again as described below,
without the blank line.

How the workfile is written afterwards
--------------------------------------

* Every command that changes the workfile rewrites the **whole file**, printed
  from the parsed tree and indented with tabs.
* **Comments and the original layout are not kept.** A comment you add by hand
  is dropped the next time a command writes the file.
* The workfile can't contain preprocessor directives (``#include``,
  ``#define``) or macros such as ``IRQ_TYPE_EDGE_FALLING``. A file that does
  not parse is reported with its line and column, and must be fixed by hand.

.. note::

   The base devicetree is different: it is preprocessed before it is read, so
   it can use includes and macros.

Overlay syntax
--------------

The ``overlay-syntax`` setting selects how the overlay is printed. It applies
to the whole file on every write, whatever syntax the file was in.

.. list-table::
   :header-rows: 1

   * - Value
     - Output
   * - ``fragment`` (default)
     - ``fragment@<n> { target = <&label>; __overlay__ { ... }; };``
       inside ``/ { ... };``. A target given by path uses
       ``target-path = "<path>";``.
   * - ``reference``
     - ``&label { ... };`` at the top level, or ``&{/path} { ... };``.

The same overlay in both syntaxes:

.. code-block:: dts

   /* overlay-syntax = fragment */
   /dts-v1/;
   /plugin/;
   / {
   	fragment@0 {
   		target = <&spi0>;
   		__overlay__ {
   			status = "okay";
   		};
   	};
   };

   /* overlay-syntax = reference */
   /dts-v1/;
   /plugin/;
   &spi0 {
   	status = "okay";
   };

A complete workfile
-------------------

The overlay of the examples in the :ref:`cli-guide`: an ADXL345 at ``0x1d``
on the I2C bus ``i2c_arm`` of a Raspberry Pi 4, its interrupt on GPIO 27,
rising edge, and the bus enabled. It is what these commands write, with
``overlay-syntax`` ``fragment``:

.. code-block:: bash

   analog-attach add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel
   analog-attach update accel interrupt-parent '&gpio'
   analog-attach update accel interrupts 27 IRQ_TYPE_EDGE_RISING
   analog-attach enable i2c_arm

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

``IRQ_TYPE_EDGE_RISING`` is written as its value, ``1``, since the workfile
can't hold macros. With ``overlay-syntax`` ``reference`` the same overlay is:

.. code-block:: dts

   /dts-v1/;
   /plugin/;
   &i2c_arm {
   	status = "okay";
   	accel: adxl345@1d {
   		compatible = "adi,adxl345";
   		reg = <0x1d>;
   		interrupt-parent = <&gpio>;
   		interrupts = <27 1>;
   	};
   };

``analog-attach build`` compiles it, with the starter ``aa_build.sh``, into
the ``build`` folder (the ``build-dir`` setting), named after the workfile:

.. list-table::
   :header-rows: 1

   * - ``output``
     - Files written
   * - ``overlay`` (default)
     - ``build/overlay.dtbo``, the compiled overlay.
   * - ``devicetree``
     - ``build/overlay.dts``, the base devicetree with the overlay applied and
       preprocessed, and ``build/overlay.dtb``, compiled from it.

See :ref:`cli-validate-build-deploy` for the output of ``build``.
