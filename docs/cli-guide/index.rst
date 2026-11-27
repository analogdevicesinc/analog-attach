.. _cli-guide:

CLI Guide
=========

Everything the GUI does is available from the command line, with no browser.
Every command accepts ``--json`` for machine-readable output.

.. toctree::
   :maxdepth: 1

   configuration
   linux/workfile
   linux/devices
   linux/properties
   linux/validate-build-deploy
   scripting
   shell-completion
   error-reporting

The pages follow the order of a first project:

* :ref:`cli-configuration`: set up the project with the guided setup or
  ``config``, and the variables of the build and deploy scripts.
* :ref:`cli-workfile`: ``init``, ``import`` and ``read``.
* :ref:`cli-devices`: find a device and its bus, ``add`` it, and ``rename``,
  ``move``, ``enable``, ``disable`` or ``delete`` nodes.
* :ref:`cli-properties`: ``read``, ``list property``, ``list value`` and
  ``update``.
* :ref:`cli-validate-build-deploy`: ``validate``, ``build`` and ``deploy``.
* :ref:`cli-scripting`: ``--json`` and use in scripts and CI.
* :doc:`shell-completion` and :doc:`error-reporting`.

Two more commands are described elsewhere: ``gui`` starts the GUI (see
:ref:`ui-starting`), and ``skill`` installs the skill of an AI agent (see
:doc:`/ai-agents/index`). Every command, with its options, is listed in
:ref:`ref-commands`.

The examples use a Raspberry Pi 4 with an ADXL345 accelerometer
(``adi,adxl345``) on its I2C bus ``i2c_arm``: the project is in
``~/work/rpi4-adxl345`` and the Linux kernel tree in ``~/linux``. Outputs are
shortened where marked with ``…``.

Getting help
------------

.. code-block:: bash

   analog-attach --help              # the commands
   analog-attach add --help          # one command, with examples
   analog-attach help add            # the same
   analog-attach --help --all        # the help of every command

.. _cli-node-paths:

Naming nodes
------------

Commands that take a node accept three forms:

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Form
     - Example
     - Means
   * - Label
     - ``accel``, ``i2c_arm``
     - The node with that label, in the base devicetree or the overlay.
   * - Label-first
     - ``i2c_arm/adxl345@1d``
     - The child ``adxl345@1d`` of the node labelled ``i2c_arm``.
   * - Absolute
     - ``/soc/i2c@7e804000/adxl345@1d``
     - The node at that path.

Write a label without ``&``: ``i2c_arm``, not ``&i2c_arm``. A node path is one
argument, and a property is a separate argument: ``read accel reg``, not
``read accel/reg``. ``list node`` shows every node with its path and labels.

Options can go anywhere after the command name, and ``--json`` anywhere on the
line. To pass a value that starts with ``-`` and a letter, put ``--`` before
it: ``update accel label -- -x``. Negative numbers need no ``--``.
