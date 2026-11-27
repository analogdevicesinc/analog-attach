Troubleshooting
===============

Common problems, with the message you see and the fix. How the CLI reports
problems in general is in :doc:`/cli-guide/error-reporting` and
:ref:`ui-error-reporting`. The examples use the project of the
:ref:`cli-guide`, in ``~/work/rpi4-adxl345``.

The binding caches are missing or out of date
---------------------------------------------

.. code-block:: text

   $ analog-attach validate
   Configuration errors:
     compat-index.json not found or unreadable in /home/user/work/rpi4-adxl345/.analog-attach/linux
     validation.json not found or unreadable in /home/user/work/rpi4-adxl345/.analog-attach/linux/validation-cache

   Run 'analog-attach config --reload' to build the binding caches.

The caches are built when you set ``linux``. They are missing if
``.analog-attach/linux/`` was deleted or the project was copied without it.
After a ``git pull`` of the kernel tree or another dt-schema, commands warn
that the caches are out of date. In both cases, rebuild them:

.. code-block:: bash

   analog-attach config --reload

``cpp``, ``dtc`` or dt-schema is not found
------------------------------------------

The tools come from your system, not from the package (see
:doc:`/install/index`). Each command checks them and names the one to install:

.. code-block:: text

   $ analog-attach validate
   AA_PREPROCESS_COMMAND: cpp not found on PATH (needed to preprocess /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts) — The C preprocessor command run on each devicetree read: it preprocesses $AA_PREPROCESS_INPUT into $AA_PREPROCESS_OUTPUT

   Install cpp: 'sudo apt install cpp'.

.. code-block:: text

   $ analog-attach validate
   Configuration errors:
     dt-mk-schema not found on PATH
     dtc not found on PATH
     dt-validate not found on PATH

   Install dt-schema 2026.9: 'pipx install dtschema==2026.9', then 'pipx inject dtschema ruamel.yaml.clib' (and 'pipx ensurepath' when pipx's bin directory isn't on PATH).
   Install dtc: 'sudo apt install device-tree-compiler'.

Run the install commands it gives. If pipx installed dt-schema but the command
still isn't found, run ``pipx ensurepath`` and open a new terminal. Only
dt-schema 2026.9 is accepted: another version is reported with the command
that replaces it.

The device is on a disabled bus
-------------------------------

.. code-block:: text

   $ analog-attach validate
   accel:
     warning: (node): parent i2c@7e804000 is not enabled (status "disabled"): Linux won't probe adxl345@1d
       note: Enable it: enable /soc/i2c@7e804000
   No errors! (1 warning(s))

The overlay builds, but the kernel won't probe the device, because its bus is
off in the base devicetree. On the Raspberry Pi 4, ``i2c_arm`` is disabled
until something enables it. Enable it in the overlay:

.. code-block:: bash

   analog-attach enable i2c_arm

An include of the base devicetree is not found
----------------------------------------------

.. code-block:: text

   $ analog-attach validate
   devicetree: preprocessing /home/user/work/rpi4-adxl345/board/my-rpi4.dts failed:
   /home/user/work/rpi4-adxl345/board/my-rpi4.dts:1:10: fatal error: bcm2711-rpi-4-b.dts: No such file or directory
       1 | #include "bcm2711-rpi-4-b.dts"
         |          ^~~~~~~~~~~~~~~~~~~~~
   compilation terminated. — Path to target base DTS file

The base devicetree is preprocessed with ``cpp`` before it is read. By default
``cpp`` looks in the file's own folder and in the kernel tree's ``include/``.
A board devicetree kept outside the kernel tree (in a Buildroot or Yocto
layer, for example) often includes files from somewhere else. Add their folder
with ``-I`` to the project variable ``AA_PREPROCESS_COMMAND``:

.. code-block:: bash

   analog-attach config var AA_PREPROCESS_COMMAND \
     'cpp -nostdinc -undef -x assembler-with-cpp -P -I "$AA_LINUX/include" -I "$AA_LINUX/arch/arm/boot/dts/broadcom" -o "$AA_PREPROCESS_OUTPUT" "$AA_PREPROCESS_INPUT"'

``config var AA_PREPROCESS_COMMAND --reset`` goes back to the default. In the
GUI, set it in **Settings** → **Project** (see :ref:`ui-build-deploy-commands`).

Deploy can't reach the board
----------------------------

The starter ``aa_deploy.sh`` first logs in to the board over SSH. When the
board doesn't answer, the deploy stops before it copies anything:

.. code-block:: text

   $ analog-attach deploy
   Deploying /home/user/work/rpi4-adxl345/build/overlay.dtbo with AA_DEPLOY
   Checking analog@analog.local
   aa_deploy.sh: analog@analog.local does not answer over SSH (exit status 255)
   Deploy failed: AA_DEPLOY exited with status 1

* Check that the board is on and on the network: ``ping <address>``.
* ``analog.local`` is the starter's default and needs mDNS on your network.
  If it doesn't resolve, use the board's IP address:
  ``analog-attach config var BOARD_IP 10.42.0.196``.
* Check the user (``config var BOARD_USER``). With a wrong password the
  script says ``refused the password``, and the GUI asks for it again.
* ``ssh``, ``scp`` and ``sshpass`` must be installed on your machine; the
  script names the one that is missing.

Run ``analog-attach config var`` to see the values the script gets.

The device doesn't probe: wrong address
---------------------------------------

The overlay validates and deploys, but the board has no device: no IIO device
appears, and ``i2cdetect`` on the board shows a number instead of ``UU`` at
the address the device answers on, and nothing at the address in the
overlay. Validation checks the overlay against the bindings, not against the
hardware, so an address that is valid but wrong goes through.

Check the address on the board (``sudo i2cdetect -y 1`` for ``i2c_arm`` on a
Raspberry Pi), and the address jumper of the part: the ADXL345 is at ``0x1d``
or ``0x53``. Then set ``reg``. The node is renamed to match:

.. code-block:: text

   $ analog-attach update accel reg 0x53
   Set reg on accel; renamed to adxl345@53

Build and deploy again.

Reporting a problem
-------------------

If something doesn't work and this guide doesn't help, you can:

* create a new issue on
  `GitHub <https://github.com/analogdevicesinc/analog-attach/issues>`__, or
* open a question or thread on
  `EngineerZone <https://ez.analog.com/sw-interface-tools/>`__.

Include:

* the output of ``analog-attach --version``, and your Linux distribution and
  ``node --version``;
* the command that failed, as you typed it (or the GUI action and the
  command the console showed for it), and its full output. With ``--json``,
  the JSON line;
* the output of ``analog-attach config`` (remove anything private from the
  paths);
* the workfile, and the name of the base devicetree and of the kernel tree's
  branch;
* for deploy problems, the board, its OS image, and how it is connected.
