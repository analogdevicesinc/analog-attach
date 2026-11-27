Error reporting
===============

This page explains how the CLI tells you that something went wrong, and how to
act on it in a script.

Kinds of problems
-----------------

.. list-table::
   :header-rows: 1
   :widths: 20 40 20 20

   * - Kind
     - What it is
     - Where it is written
     - Exit status
   * - Input error
     - The command line itself is malformed: an unknown command, flag or
       setting key, or a missing or extra argument.
     - Standard error
     - 2
   * - Refusal
     - The command line is valid but the command can't do what it asks: for
       example a device with no binding, a parent node that doesn't exist, or a
       value the setting or property can't take.
     - Standard output
     - 0
   * - Configuration error
     - The project isn't set up for the command: a setting is missing or
       invalid, the workfile doesn't exist or doesn't parse, or a required tool
       is missing.
     - Standard output
     - 0
   * - Settings file problem
     - ``analog-attach config`` can't read or write a settings file.
     - Standard error
     - 2
   * - Unexpected failure
     - The command failed without giving an answer.
     - Standard error
     - 1
   * - Cancelled
     - You stopped a question (Ctrl-C) before anything was written.
     - Standard output
     - 130

.. note::

   A refusal or a configuration error exits with status **0**. The exit status
   only tells you that the CLI answered. To tell success from refusal in a
   script, use ``--json`` and read ``ok``.

When a command refuses or hits a configuration error, the workfile and the
settings files are left as they were.

Messages
--------

When a name isn't known (a setting, a device type), the message suggests the
closest names. A setting key that doesn't exist is an input error (exit status
2):

.. code-block:: text

   $ analog-attach config backnd
   Unknown config field: backnd. Did you mean backend? Valid fields: backend, linux, devicetree, workfile, overlay-syntax, interview, output, build-dir, var.

A device that doesn't exist is a refusal (exit status 0):

.. code-block:: text

   $ analog-attach add adi,adxl999
   Unknown compatible 'adi,adxl999'. Did you mean adi,ad7999, adi,adxl359, adi,ad7949? See: analog-attach list devices

So is a value the property can't take. The workfile is left as it was:

.. code-block:: text

   $ analog-attach update accel interrupts 27 bogus
   'bogus' is not a number, a known macro, or a label in the base tree/overlay

When several configuration problems are found at once, they are all listed,
followed by a hint on how to fix them. Here ``validate`` runs in a project
that has only its ``backend`` set:

.. code-block:: text

   $ analog-attach validate
   Configuration errors:
     Missing config field linux — Path to Linux kernel source tree (setting it builds the binding caches)
     Missing config field devicetree — Path to target base DTS file
     Missing config field workfile — Path to the working DTSO overlay file (workfile)

   Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', 'config devicetree <path>' and 'config workfile <name>', then 'analog-attach init', to set up a workspace.

Notes and warnings (for example, that the binding caches are out of date) are
written to standard error and don't stop the command. They are free text:
show them, but don't parse them.

Errors with ``--json``
----------------------

With ``--json`` the command writes at most one line of JSON to standard output.
A refusal looks like this:

.. code-block:: text

   $ analog-attach --json add adi,adxl999
   {"ok":false,"message":"Unknown compatible 'adi,adxl999'. Did you mean adi,ad7999, adi,adxl359, adi,ad7949? See: analog-attach list devices","severity":"error","error_type":"unknown-device-type"}

A configuration error also has an ``errors`` list (one entry per problem, with
its ``field``, ``kind``, ``error_type`` and ``message``) and a ``hints`` list.
The project above, shortened:

.. code-block:: text

   $ analog-attach --json validate
   {"ok":false,"message":"Missing config field linux; Missing config field devicetree; Missing config field workfile","severity":"error","error_type":"missing-setting","errors":[{"field":"linux","kind":"missing","error_type":"missing-setting","message":"Missing config field linux","description":"Path to Linux kernel source tree (setting it builds the binding caches)"},…],"hints":["Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', 'config devicetree <path>' and 'config workfile <name>', then 'analog-attach init', to set up a workspace."]}

The ``error_type`` values of configuration errors are:

.. list-table::
   :header-rows: 1

   * - ``error_type``
     - Meaning
   * - ``missing-setting``
     - A required setting has no value.
   * - ``invalid-setting``
     - A setting has a value it can't take.
   * - ``invalid-source``
     - The ``linux`` setting isn't a Linux kernel tree.
   * - ``workfile-missing``
     - The workfile doesn't exist. Run ``analog-attach init``.
   * - ``parse-error``
     - The base devicetree or the workfile doesn't parse.
   * - ``tool-missing``
     - A required tool isn't on ``PATH`` or isn't a supported version.
   * - ``tool-failed``
     - The base devicetree failed to preprocess.
   * - ``cache-missing``
     - A binding cache is missing. Run ``analog-attach config --reload``.
   * - ``not-generated``
     - ``deploy`` found no build output. Run ``analog-attach build``.

Input errors and unexpected failures write no JSON. Check the exit status
first, then ``ok``:

.. code-block:: bash

   out=$(analog-attach --json validate) || { echo "failed: $?"; exit 1; }
   echo "$out" | jq -e '.ok != false' > /dev/null || echo "$out" | jq -r .message

The full format is in :doc:`/reference/json-protocol`.

If a message isn't explained here, see :doc:`/troubleshooting/index` for how to
ask for help.
