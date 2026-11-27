.. _cli-configuration:

Configuration
=============

A project is a folder with a ``.analog-attach/`` folder in it. Its settings
tell Analog Attach which Linux kernel tree has the bindings, which board
devicetree the overlay is for, and which overlay file to edit. This page shows
how to set them up and change them from the command line. Every setting, its
default and where it is stored are listed in
:doc:`/reference/configuration-file`.

The examples on this page set up a project for a Raspberry Pi 4 in
``~/work/rpi4-adxl345``, with ADI's Linux kernel in ``~/linux``.

The guided setup
----------------

On a terminal, run ``analog-attach`` with no arguments in the project folder.
It checks the tools, then asks for what is still missing, one step at a time,
and saves each answer as you give it:

.. code-block:: text

   $ cd ~/work/rpi4-adxl345
   $ analog-attach
   ? What does this project target?
   ❯ Linux device tree overlays (linux)
   Saved backend = linux to ~/work/rpi4-adxl345/.analog-attach/config.json.

   analog-attach setup
   ===================

   This checks the tools and sets up the workspace: a Linux kernel source tree, a base device tree and the overlay file.

   ✓ dtc: 1.7.0
   ✓ cpp: 13.2.0
   ✓ dt-schema: 2026.9

   Step 1: Linux kernel source tree
   …
   ✓ linux = /home/user/linux

   Step 2: Base device tree (context)
   …
   ✓ devicetree = /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts

   Step 3: Overlay workfile
   …
   ✓ workfile = /home/user/work/rpi4-adxl345/overlay.dtso

   Indexing device bindings and compiling binding schemas...
   Indexed 23309 compatibles from 5196 bindings and compiled binding schemas in 5.1s

   Workspace ready
   …

* **Step 1** searches your home folder for Linux kernel trees and lists the
  ones it finds. You can also type a path (:kbd:`Tab` completes it).
* **Step 2** lets you search the ``.dts`` files of one architecture of the
  tree, or type a path. For a Raspberry Pi 4, pick ``arm``, then type
  ``rpi-4`` to narrow the list.
* **Step 3** asks for the name of the overlay file, with a free name as the
  default. ``.dtso`` is added when you leave it out.

At the end the setup runs ``init``, which creates the overlay and the build
and deploy scripts (see :ref:`cli-workfile`).

If dt-schema is missing or is another version, the setup offers to install it
with ``pipx``. A step whose setting is already set and valid is skipped, so you
can stop with :kbd:`Ctrl-C` and run ``analog-attach`` again later: it carries
on where you stopped.

.. note::

   The guided setup only runs on a terminal. Piped, or with ``--json``,
   ``analog-attach`` alone prints its usage and the settings still missing.
   Use the commands below instead.

Set up a project with commands
------------------------------

The same setup, one command at a time. This is the way to do it in a script.

#. Choose the backend:

   .. code-block:: bash

      analog-attach config backend linux

#. Point to the Linux kernel tree. This also builds the binding caches, which
   takes about a minute:

   .. code-block:: text

      $ analog-attach config linux ~/linux
      Indexing device bindings and compiling binding schemas...
      Set linux = /home/user/linux; Indexed 23309 compatibles from 5196 bindings and compiled binding schemas in 5.1s

#. Find the base devicetree of your board. ``list context`` lists the ``.dts``
   files of the tree whose path contains the filter:

   .. code-block:: text

      $ analog-attach list context rpi-4
      /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts
      /home/user/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-400.dts
      /home/user/linux/arch/arm64/boot/dts/broadcom/bcm2711-rpi-4-b.dts
      /home/user/linux/arch/arm64/boot/dts/broadcom/bcm2711-rpi-400.dts

      4 devicetrees in /home/user/linux.
      Use: analog-attach config devicetree <path>

   Then set it:

   .. code-block:: bash

      analog-attach config devicetree ~/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts

#. Name the overlay file and create it:

   .. code-block:: text

      $ analog-attach config workfile overlay.dtso
      Set workfile = /home/user/work/rpi4-adxl345/overlay.dtso (not created yet: 'analog-attach init' creates it)
      $ analog-attach init

   ``init`` is described in :ref:`cli-workfile`.

The first ``config`` that writes a setting creates ``.analog-attach/`` in the
current folder. Later commands find the project from any of its subfolders:
they use the nearest ``.analog-attach/`` upward.

Show the settings
-----------------

``config`` alone shows every setting, its value and where the value comes
from, then the variables of the build and deploy scripts (see
:ref:`cli-variables`). Required settings are marked ``*``:

.. code-block:: text

   $ analog-attach config
   Local:  ~/work/rpi4-adxl345/.analog-attach/config.json
   Global: ~/.config/analog-attach/config.json

     General
     * backend         linux                                                   local

     Workspace
     * linux           ~/linux                                                 local
     * devicetree      ~/linux/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts  local
       workfile        ~/work/rpi4-adxl345/overlay.dtso                        local
       overlay-syntax  fragment                                                default
       interview       true                                                    default

     Build
       output          overlay                                                 default
       build-dir       build                                                   default

     * required

     Variables
       AA_PROJECT             ~/work/rpi4-adxl345        system, build, deploy and preprocess
       …

Give a key to see one setting, with its description and the values it takes:

.. code-block:: text

   $ analog-attach config output
   output

     Value:        overlay  (default)
     Description:  What 'build' makes and 'deploy' copies: overlay (default, a
                   .dtbo) or devicetree (the base with the overlay applied, a .dts
                   and its .dtb); the scripts get it as $AA_OUTPUT
     Options:      overlay, devicetree

A key that doesn't exist is an input error. The message lists the valid keys:

.. code-block:: text

   $ analog-attach config nope
   Unknown config field: nope. Valid fields: backend, linux, devicetree, workfile, overlay-syntax, interview, output, build-dir, var.

Change, reset and share settings
--------------------------------

.. code-block:: bash

   analog-attach config overlay-syntax reference     # set it in this project
   analog-attach config overlay-syntax --reset       # back to the default
   analog-attach config interview false --global     # a default for all your projects

* A value is checked when you set it. A value outside the setting's options is
  refused, and the file is left as it was.
* ``--reset`` removes the setting from the file. The answer says what applies
  now, for example ``Reset overlay-syntax (default: fragment)``.
* ``--global`` writes ``~/.config/analog-attach/config.json`` instead of the
  project's file. A project's own value still wins over the global one.
  ``backend`` and the variables belong to the project and can't be global.

Rebuild the binding caches
--------------------------

The binding caches are built when you set ``linux``, and never again on their
own. After you update the kernel tree (for example with ``git pull``) or
install another dt-schema, rebuild them:

.. code-block:: text

   $ analog-attach config --reload
   Indexing device bindings and compiling binding schemas...
   Indexed 23309 compatibles from 5196 bindings and compiled binding schemas in 5.1s
   Rebuilt the binding index and validation.json.

When the caches are older than the bindings, commands still run, with a
warning on standard error that tells you to run ``config --reload``.

.. _cli-variables:

Variables
---------

``build`` and ``deploy`` run commands of the project: ``AA_BUILD`` and
``AA_DEPLOY``, by default the scripts ``./aa_build.sh`` and ``./aa_deploy.sh``
that ``init`` writes. The preprocessor of the base devicetree is a third one,
``AA_PREPROCESS_COMMAND``. These commands get their input in environment
variables. ``config var`` lists them all:

.. code-block:: text

   $ analog-attach config var
     Variables
       AA_PROJECT             ~/work/rpi4-adxl345                     system, build, deploy and preprocess
       AA_OUTPUT              overlay                                 system, build and deploy
       AA_BUILD_DIR           ~/work/rpi4-adxl345/build               system, build and deploy
       AA_DTSO                ~/work/rpi4-adxl345/overlay.dtso        system, build and deploy
       AA_DTBO                ~/work/rpi4-adxl345/build/overlay.dtbo  system, build and deploy
       AA_DTS                 (not set)                               system, build
       AA_DTB                 (not set)                               system, build and deploy
       AA_DTC                 /usr/bin/dtc                            system, build
       AA_LINUX               ~/linux                                 system, build, deploy and preprocess
       AA_PREPROCESS_INPUT    (not set)                               system, preprocess
       AA_PREPROCESS_OUTPUT   (not set)                               system, preprocess
       AA_BUILD               ./aa_build.sh                           executable (default), run by build
       AA_DEPLOY              ./aa_deploy.sh                          executable (default), run by deploy
       AA_PREPROCESS_COMMAND  cpp -nostdinc -undef -x assembler-with-cpp …  executable (default), run by preprocess
       BOARD_IP               analog.local                            project, build, deploy and preprocess
       BOARD_USER             analog                                  project, build, deploy and preprocess
       BOARD_PASSWORD         (secret, not in the environment)        secret, deploy

There are four kinds:

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - Kind
     - What it is
   * - ``system``
     - Computed by Analog Attach from the settings: the overlay file, the
       build folder, the output file, the ``dtc`` to use. Their names start
       with ``AA_``. You can't set them.
   * - ``executable``
     - A command Analog Attach runs: ``AA_BUILD`` (run by ``build``),
       ``AA_DEPLOY`` (run by ``deploy``) and ``AA_PREPROCESS_COMMAND`` (run on
       each devicetree it reads).
   * - ``project``
     - A value of yours, passed to every command: the board's address and user
       for the deploy script, for example.
   * - ``secret``
     - A project variable whose value is never stored, such as a password.
       Only ``deploy`` gets it.

Set the board's address and user, and make the password a secret:

.. code-block:: text

   $ analog-attach config var BOARD_IP 192.168.2.10
   Set variable BOARD_IP = 192.168.2.10
   $ analog-attach config var BOARD_USER analog
   Set variable BOARD_USER = analog
   $ analog-attach config var BOARD_PASSWORD --secret
   Set variable BOARD_PASSWORD as a secret

``init`` sets these three when it writes the starter deploy script, to the
defaults of a Kuiper image: ``analog.local``, ``analog`` and the secret
``BOARD_PASSWORD``. Change them for your board as above.

A secret's value is taken from the environment ``deploy`` runs in
(``BOARD_PASSWORD=… analog-attach deploy``), or asked for, hidden, when
``deploy`` runs on a terminal. It is never written to a file or shown.

To run another command instead of a script:

.. code-block:: text

   $ analog-attach config var AA_BUILD "make overlay"
   Set variable AA_BUILD = make overlay
   $ analog-attach config var AA_BUILD --reset
   Reset variable AA_BUILD (default ./aa_build.sh)

Remove a variable with ``config var <NAME> --reset``. Variables are stored in
the project's ``.analog-attach/config.json``, never in the global file. See
:ref:`cli-validate-build-deploy` for how the scripts use them.

Next steps
----------

* :ref:`cli-workfile`: create the overlay and read it.
* :ref:`cli-devices`: add the first device.
