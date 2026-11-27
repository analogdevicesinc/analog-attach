Installation
============

Requirements
------------

.. list-table::
   :header-rows: 1

   * - Requirement
     - Why it is needed
     - How to install
   * - Node.js 22 or newer
     - Runs the CLI and the GUI server
     - From your distribution if it ships 22 or newer, else from
       `nodejs.org <https://nodejs.org/en/download>`__ (or ``nvm install 22``).
       Check with ``node --version``.
   * - Linux kernel source tree
     - Provides the bindings and includes used for validation
     - A clone of the kernel your board runs: the
       `ADI Linux tree <https://github.com/analogdevicesinc/linux>`__, or the
       board vendor's. The Raspberry Pi examples of this guide use the ADI
       tree's Raspberry Pi branch (``rpi-6.12.y``, for example):
       ``git clone --depth 1 -b rpi-6.12.y https://github.com/analogdevicesinc/linux.git``
   * - ``cpp``
     - Preprocesses the includes and macros of the base devicetree
     - ``sudo apt install cpp``
   * - ``dtc`` 1.6.0 or newer
     - Compiles the overlay, for validation and build
     - ``sudo apt install device-tree-compiler``
   * - dt-schema 2026.9
     - Validates against the kernel bindings (``dt-validate``,
       ``dt-mk-schema``)
     - ``pipx install dtschema==2026.9``, then
       ``pipx inject dtschema ruamel.yaml.clib``. The guided setup offers to
       run these for you.
   * - Deploy tools
     - The starter ``aa_deploy.sh`` copies the build to a Raspberry Pi over SSH
     - ``sudo apt install openssh-client sshpass`` (``ssh``, ``scp`` and
       ``sshpass``). A board with its own ``aa_deploy.sh`` needs what that
       script runs.

``dtc``, ``cpp`` and dt-schema are not part of the package: Analog Attach looks
for them on ``PATH`` each time it runs. Only the version 2026.9 of dt-schema is
accepted. When one is missing or has the wrong version, the command says which,
and the command that installs it (see :doc:`/troubleshooting/index`). The
guided setup (``analog-attach`` with no arguments) checks all three first.

Getting the package
-------------------

Analog Attach is **not** published to the npm registry. The npm package is
attached to each GitHub release.

1. Open the `v0.2.0 release <https://github.com/analogdevicesinc/analog-attach/releases#release-v0.2.0>`__.
2. Download ``analog-attach-cli-0.2.0.tgz`` from the *Assets* section.
3. Install it with npm:

   .. code-block:: bash

      npm install -g ./analog-attach-cli-0.2.0.tgz

This puts the ``analog-attach`` command on your ``PATH``.

If npm can't write to its global folder (an ``EACCES`` error, typical when
Node.js comes from the distribution and the prefix is ``/usr``), don't use
``sudo``. Give npm a prefix in your home folder instead, and put its ``bin``
folder on your ``PATH``:

.. code-block:: bash

   npm config set prefix ~/.local
   export PATH="$HOME/.local/bin:$PATH"      # add this line to ~/.bashrc too
   npm install -g ./analog-attach-cli-0.2.0.tgz

Verify the installation
-----------------------

.. code-block:: text

   $ analog-attach --version
   0.2.0

``analog-attach --help`` lists the commands. To check the tools as well, run
``analog-attach`` with no arguments in a new folder: the guided setup asks for
the backend, then checks ``dtc``, ``cpp`` and dt-schema. Stop it there with
:kbd:`Ctrl-C` if you only wanted the check (see :ref:`cli-configuration`).

Updating and uninstalling
-------------------------

To update, download the ``.tgz`` of the new release and install it the same
way. It replaces the installed version:

.. code-block:: bash

   npm install -g ./analog-attach-cli-<version>.tgz

If you installed the AI agent skill, install it again so it matches the new
version: ``analog-attach skill install analog-attach-linux --force``. If a
command then warns that the binding caches are out of date, run
``analog-attach config --reload`` in that project.

To remove it:

.. code-block:: bash

   analog-attach skill uninstall analog-attach-linux   # if you installed the skill
   npm uninstall -g @analog-attach/cli

This leaves your projects, their ``.analog-attach/`` folders and the global
settings file (``~/.config/analog-attach/config.json``) as they are. Delete
them by hand if you no longer need them.

Installing the AI agent skills (optional)
-----------------------------------------

See :doc:`/ai-agents/index`.
