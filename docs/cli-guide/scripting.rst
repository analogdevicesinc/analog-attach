.. _cli-scripting:

Scripting
=========

Every command can run unattended: in a shell script, a Makefile, a CI job or an
AI agent. This page shows how to get machine-readable answers and how to tell
success from failure. The format itself is in :ref:`ref-json-protocol`.

Runs that don't ask
-------------------

A command only asks questions when both its standard input and its standard
output are a terminal, and ``--json`` isn't given. Piped, redirected or with
``--json``, it never waits for input:

* ``add`` puts the node under the ``--parent`` you give (or the first valid
  bus), and lists the missing required properties instead of asking for them.
* ``analog-attach`` alone prints its usage instead of the guided setup.
* ``deploy`` takes secrets from the environment only.

To make terminal runs behave the same, run
``analog-attach config interview false``, or pass ``--quiet`` to ``add``.

JSON output
-----------

Add ``--json`` anywhere on the command line. The command then writes exactly
one line of JSON to standard output:

.. code-block:: text

   $ analog-attach --json add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel
   {"ok":true,"message":"Added adxl345@1d (label: accel)","severity":"info","key":"adxl345@1d","path":["soc","i2c@7e804000","adxl345@1d"],"label":"accel","template":"required","missing_required":[{"property":"interrupt-parent","suggestions":[…]},{"property":"interrupts","suggestions":[]}]}

Every answer has ``ok``, ``message`` and ``severity``. A refusal has
``ok: false`` and an ``error_type``:

.. code-block:: text

   $ analog-attach --json add adi,nope
   {"ok":false,"message":"Unknown compatible 'adi,nope'. See: analog-attach list devices","severity":"error","error_type":"unknown-device-type"}

Check ``ok``, not the exit status
---------------------------------

A refusal exits with status **0**, like a success. The exit status only tells
you whether the CLI answered:

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - Status
     - Meaning
   * - 0
     - The command answered: read ``ok`` to know whether it did what you asked.
   * - 1
     - The command failed without answering. The message is on standard error.
   * - 2
     - The command line is malformed (an unknown command, flag or setting, a
       missing argument). The message is on standard error; there is no JSON.
   * - 130
     - A question was stopped with :kbd:`Ctrl-C`. Never happens with
       ``--json``.

So check both, in this order:

.. code-block:: bash

   out=$(analog-attach --json update accel interrupts 27 IRQ_TYPE_EDGE_RISING) || exit 1
   if [ "$(echo "$out" | jq -r .ok)" != true ]; then
       echo "update refused: $(echo "$out" | jq -r .message)" >&2
       exit 1
   fi

``severity`` is ``warn`` when the command succeeded with something to fix: an
``update`` with a value the binding doesn't allow, an address clash, or the
``delete`` preview. More in :doc:`/cli-guide/error-reporting`.

Standard error
--------------

Notes and warnings go to standard error, never into the JSON: the bus ``add``
picked, an address clash, a value count the binding doesn't expect, the output
of ``build`` and ``deploy``. Show them to the user, but don't parse them: their
wording may change. Keep standard output for the JSON:

.. code-block:: bash

   analog-attach --json build 2> build.log | jq -r .path

Examples
--------

The compatible strings that match a search:

.. code-block:: bash

   analog-attach --json list devices adxl | jq -r '.devices[].key'

The buses a device can go on, ready for ``--parent``:

.. code-block:: text

   $ analog-attach --json list parent adi,adxl345 | jq -r '.suggestions[].value'
   spi
   spi1
   …
   i2c1
   …

The properties ``add`` left to set:

.. code-block:: text

   $ analog-attach --json add adi,adxl345 --parent i2c_arm --name adxl345@1d --label accel \
       | jq -r '.missing_required[].property'
   interrupt-parent
   interrupts

A property's value:

.. code-block:: text

   $ analog-attach --json read accel reg | jq .value
   [
     29
   ]

Validate in CI
--------------

``validate`` exits with 0 whatever it finds. Fail the job on the number of
errors:

.. code-block:: bash

   #!/bin/sh
   set -e
   cd overlay-project
   result=$(analog-attach --json validate)
   echo "$result" | jq -r '.errors[] | "error: \(.path | join("/")): \(.message)"'
   echo "$result" | jq -r '.warnings[] | "warning: \(.path | join("/")): \(.message)"'
   [ "$(echo "$result" | jq '.ok and (.errors | length == 0)')" = true ]
   analog-attach --json build | jq -e .ok > /dev/null

A CI runner needs the same tools as your computer (``dtc``, ``cpp``,
dt-schema) and the kernel tree. Commit ``.analog-attach/config.json``, the
overlay and the scripts, but not ``.analog-attach/linux/``, which holds the
binding caches. ``config`` writes the paths of the project's settings absolute,
so on the runner set ``linux``, ``devicetree`` and ``workfile`` again for its
checkout:
``analog-attach config linux "$LINUX_DIR"`` also builds the caches there.

Deploy from a script
--------------------

``deploy`` takes secrets from its environment. Pass the password there, never
on the command line of ``config``:

.. code-block:: bash

   BOARD_PASSWORD="$PI_PASSWORD" analog-attach --json deploy

Without it, ``deploy`` is refused with ``error_type`` ``missing-setting`` and
an ``errors`` entry naming ``BOARD_PASSWORD``.

AI agents
---------

The same commands are what an AI coding agent runs. ``analog-attach skill
install`` teaches Claude Code, Codex CLI or Gemini CLI how to use them. See
:doc:`/ai-agents/index`.
