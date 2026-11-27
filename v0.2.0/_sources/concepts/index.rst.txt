Concepts
========

The words this guide uses, with a short definition each. The GUI and CLI
guides use them the same way.

Project and settings
--------------------

A *project* is a directory that contains a ``.analog-attach/`` folder. The tool
finds it by walking up from the current directory to the nearest directory that
has one. If none is found, the current directory is used.

The project's settings are stored in ``.analog-attach/config.json``. A second,
optional file in your home directory holds defaults shared by all projects.
The tool keeps its caches and scratch files in ``.analog-attach/linux/``.

See :doc:`/reference/configuration-file` for every setting.

Linux tree, base devicetree and bindings
----------------------------------------

The *Linux tree* (the ``linux`` setting) is a kernel source tree, the one your
board runs. Analog Attach takes two things from it: the *bindings*, YAML files
in ``Documentation/devicetree/bindings/`` that say which properties each
device takes, and the includes the devicetrees use.

The *base devicetree* (the ``devicetree`` setting) is the ``.dts`` of your
board, for example ``bcm2711-rpi-4-b.dts`` for a Raspberry Pi 4. It describes
what is on the board already: the buses, the GPIO controller, their labels.
The overlay is written against it.

Workfile and overlay
--------------------

The *workfile* is the devicetree overlay (a ``.dtso`` file) that you build up
with ``add`` and ``update``. The ``workfile`` setting names it, and
``analog-attach init`` creates it. See :doc:`/reference/linux/workfile`.

A devicetree is a tree of *nodes*, one per device or bus, each with
*properties*. A device node sits under the bus it is wired to, and its
properties say what the driver needs: ``compatible`` picks the driver, ``reg``
is its address on the bus, ``interrupts`` its interrupt line. A *label*
(``accel:``) names a node so that others can refer to it as ``&accel``. An
*overlay* adds nodes and properties to a base devicetree: here, a node for the
ADXL345 under the I2C bus ``i2c_arm``. For an introduction, see the
`devicetree usage guide <https://docs.kernel.org/devicetree/usage-model.html>`__
and the
`overlay notes <https://docs.kernel.org/devicetree/overlay-notes.html>`__
of the kernel documentation.

Validation
----------

*Validation* checks the nodes of the overlay, as they sit in the base
devicetree, against the bindings of the Linux tree with dt-validate (from
dt-schema): required properties, types, allowed values and ranges. Analog
Attach adds its own checks: addresses and chip selects that clash or don't fit
the bus, references to nodes that don't exist, and devices on a bus that is
disabled. ``validate --full`` also checks the whole devicetree with the overlay
applied. The GUI validates after every change.

Validation checks the overlay against the bindings, not against your
hardware: it can't tell that a part is at another address than the one you
gave.

Build and deploy
----------------

*Build* compiles the workfile with ``dtc`` into an overlay blob (``.dtbo``) in
the project's ``build/`` folder. For a board that boots one devicetree and has
no overlay support, set ``output`` to ``devicetree``: the build then writes the
base devicetree with the overlay applied (``.dts``) and compiles it (``.dtb``).

*Deploy* puts the result on the board. Both are scripts of the project,
``aa_build.sh`` and ``aa_deploy.sh``, which ``init`` writes and which you can
edit. The starter ``aa_deploy.sh`` copies the ``.dtbo`` to a Raspberry Pi over
SSH, into the boot folder's ``overlays/``, adds ``dtoverlay=<name>`` to
``config.txt`` and reboots the board. The firmware applies the overlay at boot,
and the kernel probes the new device.

The scripts get what they need in environment variables: the files from
Analog Attach (``AA_DTSO``, ``AA_DTBO``, …), and the board from *project
variables* such as ``BOARD_IP`` (see :ref:`cli-variables`).

JSON protocol
-------------

Every command accepts ``--json``. It then prints one line of JSON on standard
output instead of text: ``ok`` says whether the command did what was asked,
``message`` and ``error_type`` say why not, and the rest is the command's
answer (the properties of a node, the findings of validation). The text output
is for people. Scripts, CI and AI agents read the JSON instead of parsing the
text. See :ref:`ref-json-protocol`.
