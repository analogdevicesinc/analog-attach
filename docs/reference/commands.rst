.. _ref-commands:

Commands
========

Every command of ``analog-attach`` with the Linux backend, with its arguments
and options. The task-oriented guide is :ref:`cli-guide`; the ``--json``
output of each command is summarized in :ref:`ref-json-protocol`.

``analog-attach <command> --help`` prints the same information with examples,
and ``analog-attach --help --all`` prints the help of every command.

Conventions
-----------

* ``<path>`` is a node: a label (``accel``), a label then child names
  (``i2c_arm/adxl345@1d``) or an absolute path (``/soc/i2c@7e804000``). See
  :ref:`cli-node-paths`.
* ``[…]`` is optional. Options can be given anywhere after the command name, and
  an option's value either as the next argument or after ``=``
  (``--parent=i2c_arm``).
* ``--`` ends the options: every argument after it is a positional.

Options of every command
~~~~~~~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--json``
     - Anywhere on the line: write one line of JSON to standard output, and
       ask nothing (:ref:`ref-json-protocol`).
   * - ``-h``, ``--help``
     - Print the command's help and do nothing else. ``analog-attach help
       <command>`` is the same.
   * - ``-v``, ``--version``
     - As the first argument: print the version.
   * - ``--help --all``
     - Print the help of every command.

.. _cmd-setup:

analog-attach (no command)
--------------------------

.. code-block:: text

   analog-attach

On a terminal, the guided setup: chooses the backend, checks the tools, asks
for the Linux tree, the base devicetree and the workfile name, builds the
binding caches and runs ``init``. Piped, or with ``--json``, it prints the usage
and the required settings still unset.

Guide: :ref:`cli-configuration`.

.. _cmd-config:

config
------

.. code-block:: text

   analog-attach config [<key>]
   analog-attach config <key> <value> [--global]
   analog-attach config <key> --reset [--global]
   analog-attach config --reload
   analog-attach config var [<NAME>]
   analog-attach config var <NAME> <value>
   analog-attach config var <NAME> --secret
   analog-attach config var <NAME> --reset

Shows the settings, sets or resets one, rebuilds the binding caches, and shows
or sets the variables of the build and deploy commands. Setting ``linux`` also
builds the binding caches.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Argument or option
     - Meaning
   * - ``<key>``
     - A setting: ``backend``, ``linux``, ``devicetree``, ``workfile``,
       ``overlay-syntax``, ``interview``, ``output``, ``build-dir``. Omit it to
       show every setting.
   * - ``<value>``
     - The value to set. Omit it to show the setting.
   * - ``--global``
     - Set or reset in the global settings file, not the project's.
   * - ``--reset``
     - Remove the setting: back to its default, or unset.
   * - ``--reload``
     - Rebuild the binding caches. Takes no other argument.
   * - ``var``
     - The variables: system (``AA_…``), executable (``AA_BUILD``,
       ``AA_DEPLOY``, ``AA_PREPROCESS_COMMAND``) and the project's. Always
       written to the project's file.
   * - ``--secret``
     - With ``var <NAME>``: a secret, stored by name only.

Guide: :ref:`cli-configuration`. Settings: :doc:`/reference/configuration-file`.

.. _cmd-init:

init
----

.. code-block:: text

   analog-attach init [--restore build|deploy]

Creates the workfile when it doesn't exist, empty, and keeps it when it does.
Writes the starter scripts ``aa_build.sh`` and ``aa_deploy.sh`` in the project
folder when they aren't there, and sets the project variables the deploy
starter uses (``BOARD_IP``, ``BOARD_USER``, ``BOARD_PASSWORD``) that the
project doesn't have. Needs ``linux``, ``devicetree`` and ``workfile`` set. Never
asks.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--restore build``, ``--restore deploy``
     - Write that starter script again, over the file. Needs nothing else
       configured.

Guide: :ref:`cli-workfile`.

.. _cmd-import:

import
------

.. code-block:: text

   analog-attach import <source>

Creates a workfile from an overlay of the Linux tree (a name from ``list
overlay``) or from an overlay file, and makes it the configured workfile. The
fragments are imported as written; ``__overrides__`` is dropped; targets and
references the base doesn't have are listed as warnings.

Guide: :ref:`cli-workfile`.

.. _cmd-add:

add
---

.. code-block:: text

   analog-attach add <compatible> [--parent <path>] [--name <name>] [--label <label>]
                     [--template <template>] [--dry-run] [--quiet]

Adds a device node to the overlay. On a terminal, asks for the parent when
``--parent`` is missing, then for the required properties still missing;
otherwise lists them.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Argument or option
     - Meaning
   * - ``<compatible>``
     - The device's compatible string (``list devices``).
   * - ``--parent <path>``
     - The parent node. Default: the first bus ``list parent`` shows.
   * - ``--name <name>``
     - The node name. ``adxl345@1d`` also sets ``reg``.
   * - ``--label <label>``
     - The node's label. Default: one made from the compatible.
   * - ``--template <template>``
     - ``required`` (default: a bare node), ``example:<N>`` (the binding's
       example N) or ``overlay:<name>`` (the node from an overlay of the
       Linux tree, or a file).
   * - ``--dry-run``
     - Show the node, write nothing, ask nothing.
   * - ``--quiet``
     - Don't ask for the missing properties; list them.

Guide: :ref:`cli-devices`.

.. _cmd-read:

read
----

.. code-block:: text

   analog-attach read [<path>] [<property>] [--quiet]

Without a path, prints the whole overlay. With a path, prints the node (from
the base and the overlay) and the required properties it lacks. With a
property, prints its value with the binding's description, allowed values and
suggestions.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--quiet``
     - Print only the values.

Guide: :ref:`cli-workfile`, :ref:`cli-properties`.

.. _cmd-update:

update
------

.. code-block:: text

   analog-attach update <path> <property> [<value>...] [--suggest] [--quiet]

Sets a property, replacing its value. Without a value, sets a flag, or reads
the property when it has a value. When ``<property>`` names a child node of
the binding (``channel@0``), creates the child, or reads it when it exists.
Setting ``reg`` also renames the node's unit address.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Argument or option
     - Meaning
   * - ``<value>...``
     - Numbers, macros, labels or words; several values make an array, ``,``
       separates rows. See :ref:`cli-properties`.
   * - ``--suggest``
     - List what the property can be set to, as ``list value`` does, and set
       nothing.
   * - ``--quiet``
     - When reading: print only the value. When creating a child node: don't
       ask.

Guide: :ref:`cli-properties`.

.. _cmd-delete:

delete
------

.. code-block:: text

   analog-attach delete [<path>] [<property>] [--force]

Removes a property, or a node, from the overlay. A node with children, and the
whole overlay (no path), are only previewed without ``--force``. Nodes of the
base devicetree can't be deleted.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--force``
     - Delete a node that has children, or the whole overlay.

Guide: :ref:`cli-devices`.

.. _cmd-rename:

rename
------

.. code-block:: text

   analog-attach rename <path> <new-name>

Renames a node the overlay adds. A name without ``@`` keeps the unit address;
one with ``@`` changes it, and ``reg`` follows.

Guide: :ref:`cli-devices`.

.. _cmd-list:

list
----

.. code-block:: text

   analog-attach list devices [<filter>]
   analog-attach list context [<filter>]
   analog-attach list property [<path>] [<property>]
   analog-attach list value <path> <property>
   analog-attach list parent <compatible>
   analog-attach list overlay [<compatible>]
   analog-attach list node [<filter>]

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Command
     - Lists
   * - ``list devices``
     - The compatible strings of the Linux tree's bindings, with their
       category. With a filter, those that contain it; when only one matches,
       or the filter is a compatible, that device's binding.
   * - ``list context``
     - The base devicetrees (``.dts``) of the Linux tree, overlays left out:
       what ``config devicetree`` takes. Needs only ``linux``.
   * - ``list property``
     - Without a path: the overlay's nodes. With a path: the properties the
       node's binding defines, marked set and required, and its child-node
       patterns. With a property: its type, description and constraints.
   * - ``list value``
     - The values a property can be set to, each ready for ``update``.
   * - ``list parent``
     - The nodes a device can be added under, by label, then path.
   * - ``list overlay``
     - The overlays of the Linux tree that add the device, and whether they
       fit the board. Without a compatible, every overlay.
   * - ``list node``
     - Every node of the base with the overlay applied, with its labels and
       compatibles, tagged ``(new)``, ``(changed)`` or ``(off)``. With a
       filter, the nodes whose name, label or compatible contains it.

``list`` alone prints this usage.

Guide: :ref:`cli-devices`, :ref:`cli-properties`, :ref:`cli-configuration`.

.. _cmd-move:

move
----

.. code-block:: text

   analog-attach move <path> <destination>

Moves a node the overlay adds under another parent. A parent the node's binding
doesn't allow is refused.

Guide: :ref:`cli-devices`.

.. _cmd-enable-disable:

enable, disable
---------------

.. code-block:: text

   analog-attach enable <path>
   analog-attach disable <path>

Sets the node's ``status`` to ``"okay"`` or ``"disabled"`` in the overlay. When
the node already has that status without the overlay, the overlay's
``status`` is removed instead.

Guide: :ref:`cli-devices`.

.. _cmd-validate:

validate
--------

.. code-block:: text

   analog-attach validate [--full]

Runs dt-validate on the nodes the overlay writes, and checks addresses, chip
selects, references and disabled parents. Exits with 0 whatever it finds.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--full``
     - Also validate the base devicetree with the overlay applied, reporting
       what the overlay adds or sets and counting the base's own findings.

Guide: :ref:`cli-validate-build-deploy`.

.. _cmd-build:

build
-----

.. code-block:: text

   analog-attach build

Runs ``AA_BUILD`` (default ``./aa_build.sh``) in the project folder. The
starter script compiles the overlay with ``dtc`` into
``<build-dir>/<overlay>.dtbo``. With ``config output devicetree``, ``build``
first writes and preprocesses the base with the overlay applied, and the script
compiles it into a ``.dtb``. Doesn't validate.

Guide: :ref:`cli-validate-build-deploy`.

.. _cmd-deploy:

deploy
------

.. code-block:: text

   analog-attach deploy

Runs ``AA_DEPLOY`` (default ``./aa_deploy.sh``) in the project folder, with
the project's secrets in its environment. The starter script copies the
``.dtbo`` to a Raspberry Pi running Kuiper over SSH, adds it to
``config.txt`` and reboots the board. On a terminal, asks for a secret the
environment doesn't give.

Guide: :ref:`cli-validate-build-deploy`.

.. _cmd-completion:

completion
----------

.. code-block:: text

   analog-attach completion [<shell>] [--install | --uninstall]

Prints the shell completion script for ``bash``, ``zsh`` or ``fish`` (default:
the shell ``$SHELL`` names), or installs or removes it.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--install``
     - Install the script where the shell loads it, in your home folder.
   * - ``--uninstall``
     - Remove the installed script.

Guide: :doc:`/cli-guide/shell-completion`.

.. _cmd-gui:

gui
---

.. code-block:: text

   analog-attach gui [--port <port>] [--server-only]

Opens the GUI for the project in the current folder, in the browser. Serves it
on ``127.0.0.1`` until stopped with :kbd:`Ctrl-C`.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--port <port>``
     - The port. Default: 5177, or the next free one; ``0`` for any free port.
   * - ``--server-only``
     - Serve the page without opening the browser.

Guide: :doc:`/ui-guide/index`.

.. _cmd-skill:

skill
-----

.. code-block:: text

   analog-attach skill install [<name>] [--agent <agent>] [--force]
   analog-attach skill uninstall [<name>] [--agent <agent>]

Installs or removes the backend's skill for an AI agent. The Linux backend's
skill is ``analog-attach-linux``. Without a name, lists the skills and whether
each is installed.

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Option
     - Meaning
   * - ``--agent <agent>``
     - ``claude`` (Claude Code, the default), ``codex`` (Codex CLI),
       ``gemini`` (Gemini CLI), or ``all`` (each of them that is installed).
   * - ``--force``
     - Install over an installed copy.

Guide: :doc:`/ai-agents/index`.
