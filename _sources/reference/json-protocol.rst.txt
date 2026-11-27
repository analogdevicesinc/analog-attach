.. _ref-json-protocol:

JSON protocol
=============

With ``--json``, every command answers with one JSON object, for scripts, CI
jobs, the GUI and AI agents. This page describes that answer: the fields every
answer has, the exit status, which stream gets what, and the fields of each
command's result. How to use it from a script is in :ref:`cli-scripting`; the
error cases are explained in :doc:`/cli-guide/error-reporting`.

The exact format of each command's answer is a JSON Schema (2020-12), in the
`source repository <https://github.com/analogdevicesinc/analog-attach>`__ under
``packages/cli/docs/spec/04-protocol/``: ``<command>.schema.json``, with
spaces as ``-`` (``list-parent.schema.json``). ``common.schema.json`` has the
shapes they share. For a command shared by several backends, validate against
the Linux backend's definition, ``$defs/linux`` (``read.schema.json#/$defs/linux``).

Turning it on
-------------

``--json`` can be anywhere on the command line before a ``--``:
``analog-attach --json read accel`` and ``analog-attach read accel --json`` are
the same. In JSON mode the CLI never asks a question.

Streams
-------

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - Stream
     - What it gets
   * - Standard output
     - At most one line: the JSON answer. Nothing else.
   * - Standard error
     - Notes and warnings (the bus ``add`` picked, an address clash, a cache
       out of date), the progress of long steps, the output of the ``build``
       and ``deploy`` commands, and input errors. This is free text: show it,
       don't parse it.

Exit status
-----------

.. list-table::
   :header-rows: 1
   :widths: 15 40 45

   * - Status
     - When
     - Standard output
   * - 0
     - The command answered: a success, a refusal, or a configuration error.
       Also ``--help`` and ``--version``.
     - The JSON answer (``--help`` and ``--version`` print text).
   * - 1
     - The command failed without answering (an unexpected error).
     - Nothing, or what the command wrote before failing; no answer.
   * - 2
     - An input error: unknown command, flag or setting key, a missing or extra
       argument, a malformed path. Also ``config`` when it can't read or write
       a settings file.
     - Nothing. The message is on standard error.
   * - 130
     - A question was stopped (not in JSON mode).
     - A line saying so.

Status 0 doesn't mean success: read ``ok``.

The answer
----------

Every answer is a JSON object with these fields, and the command's own fields
next to them:

.. list-table::
   :header-rows: 1
   :widths: 20 20 60

   * - Field
     - Type
     - Meaning
   * - ``ok``
     - boolean
     - ``true`` when the command did what was asked, ``false`` when it refused.
   * - ``message``
     - string
     - What happened, in words: ``"Added adxl345@1d (label: accel)"``, or why
       it refused. For people, not to be parsed.
   * - ``severity``
     - ``info``, ``warn`` or ``error``
     - ``info``: success. ``warn``: success with something to fix. ``error``:
       a refusal, or a ``validate`` with errors.
   * - ``error_type``
     - string
     - On a refusal, and on a success whose ``severity`` is ``warn``: which
       case it is (see `Error types`_). Absent when ``severity`` is ``info``.

A success:

.. code-block:: json

   {"ok": true, "message": "Set interrupts on accel", "severity": "info"}

A refusal:

.. code-block:: json

   {"ok": false, "message": "Not found: nope", "severity": "error", "error_type": "not-found"}

A success that warned, here the preview of ``delete`` without ``--force``:

.. code-block:: json

   {"ok": true, "message": "Would delete 1 node(s) and 4 property(ies)", "severity": "warn",
    "error_type": "needs-force", "node_count": 1, "property_count": 4, "paths": [["adxl345@1d"]]}

(Wrapped here; the CLI writes one line.)

Node paths are arrays of node names from the root, without the root:
``/soc/i2c@7e804000/adxl345@1d`` is ``["soc", "i2c@7e804000", "adxl345@1d"]``.

Configuration errors
~~~~~~~~~~~~~~~~~~~~

When the project isn't set up for the command (a setting missing or invalid,
the workfile missing, a tool missing), the command refuses with two more
fields: ``errors``, one entry per problem, and ``hints``, how to fix them.
``error_type`` is the first problem's:

.. code-block:: json

   {"ok": false, "message": "Missing config field linux", "severity": "error",
    "error_type": "missing-setting",
    "errors": [{"field": "linux", "kind": "missing", "error_type": "missing-setting",
                "message": "Missing config field linux",
                "description": "Path to Linux kernel source tree (setting it builds the binding caches)"}],
    "hints": ["Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>', to set up a workspace."]}

Each entry of ``errors`` has ``field`` (the setting, tool or script),
``kind`` (``missing``, ``invalid``, ``unknown``), ``error_type``,
``message`` and, when there is one, ``description``. The shape is
``common.schema.json#/$defs/config-refusal``.

When a settings file can't be read (it isn't JSON, or has an unknown key),
``config`` writes ``{"errors": […], "hints": […]}`` to **standard error** and
exits with status 2 (``config-error.schema.json``).

Error types
~~~~~~~~~~~

``error_type`` is one of a fixed list, the same for every backend, so that a
script can act on the case rather than on the wording. Those the Linux backend
gives:

.. list-table::
   :header-rows: 1
   :widths: 25 75

   * - ``error_type``
     - Case
   * - ``not-found``
     - A node, property, parent, overlay, example or variable that isn't there.
   * - ``ambiguous``
     - Several overlays have the name given.
   * - ``unknown-device-type``
     - A compatible no binding has.
   * - ``read-only``
     - A node of the base devicetree that ``delete``, ``move`` or ``rename``
       can't change; a system variable.
   * - ``invalid-name``
     - A node name, label or variable name that isn't allowed.
   * - ``name-taken``
     - A name or label already used under that parent.
   * - ``invalid-value``
     - A value ``update`` can't build.
   * - ``edit-refused``
     - A ``move`` the binding doesn't allow; an edit that would leave an overlay
       that doesn't parse.
   * - ``unchecked``
     - A property written without a binding to check it (a warning).
   * - ``out-of-range``
     - A value or count the binding doesn't allow (a warning of ``update``, a
       finding of ``validate``).
   * - ``missing-required``
     - A required property is missing (a finding of ``validate``).
   * - ``resource-conflict``
     - An address or chip select already used.
   * - ``unresolved``
     - A reference or fragment target that names no node; a device on a
       disabled parent (``validate``).
   * - ``needs-force``
     - The ``delete`` preview.
   * - ``tool-failed``
     - dtc, dt-validate, the preprocessor, ``AA_BUILD`` or ``AA_DEPLOY``
       failed.
   * - ``parse-error``
     - The base devicetree or the workfile doesn't parse.
   * - ``write-failed``
     - ``init`` or ``import`` couldn't write the workfile.
   * - ``output-missing``
     - ``AA_BUILD`` succeeded, but the output file isn't there (a warning).
   * - ``definition-error``
     - A binding that can't be narrowed down for the node.
   * - ``missing-setting``, ``invalid-setting``, ``invalid-source``,
       ``workfile-missing``, ``cache-missing``, ``tool-missing``,
       ``not-generated``
     - Configuration errors; see :doc:`/cli-guide/error-reporting`.
   * - ``unknown-choice``
     - A value outside a fixed set of choices (a skill, a shell).

The complete list is the ``error-type`` definition in ``common.schema.json``.
Input errors (exit status 2) have no JSON and no error type.

Results by command
------------------

The fields each command adds to ``ok``, ``message`` and ``severity`` on
success. The schema file named in each row has the details.

.. list-table::
   :header-rows: 1
   :widths: 22 50 28

   * - Command
     - Fields
     - Schema
   * - ``config``
     - ``configs``: one entry per setting (``field_name``, ``category``,
       ``description``, ``type``, ``required``, ``default``, ``value``,
       ``source``); ``variables``: one per variable (``name``, ``kind``,
       ``value``, ``scripts``, …). Setting, resetting and ``--reload``: no
       more fields.
     - ``config``
   * - ``init``
     - ``path``, ``created``, ``linux``, ``devicetree``, ``overlay``, and
       ``scripts``: each script's ``path``, ``created`` and the ``variables``
       set now.
     - ``init``
   * - ``import``
     - ``path`` (the new workfile), ``source``, ``fit``, ``reason``, and the
       ``unresolved`` references and ``unresolved_targets``.
     - ``import``
   * - ``add``
     - ``key`` (the node name), ``path``, ``label``, ``template``,
       ``missing_required`` (each ``property`` with its ``suggestions``),
       ``unresolved``; with ``--dry-run``, ``dry_run`` and ``node`` (the node
       as text).
     - ``add``
   * - ``read``
     - The whole overlay, a node (``kind`` ``node``, ``key``,
       ``properties``, ``children``, ``alias``, ``origin``, ``status``) or a
       property (``kind`` ``property``, ``key``, ``type``, ``value``,
       ``source``, ``written``, ``description``, ``required``,
       ``definition``, ``suggestions``).
     - ``read``
   * - ``update``
     - A set: no more fields. A read: as ``read``. A created child node:
       ``path`` and ``missing_required``. ``--suggest``: as ``list value``.
     - ``update``
   * - ``delete``
     - The preview: ``node_count``, ``property_count``, ``paths``.
     - ``delete``
   * - ``rename``, ``move``, ``enable``, ``disable``
     - None.
     - ``rename``, ``move``, ``enable-disable``
   * - ``list devices``
     - ``devices``: each ``key`` (the compatible) and ``tag`` (the category);
       ``device``, the binding described, when one device matches.
     - ``list-devices``
   * - ``list context``
     - ``devicetrees``: each base devicetree's ``path``, ``arch``,
       ``name`` (its path under ``arch/<arch>/boot/dts``) and, for the one
       configured, ``configured``.
     - ``list-context``
   * - ``list property``
     - Without a path: ``suggestions``, the overlay's nodes. With a path:
       ``properties`` and ``child_patterns``. With a property: ``property``,
       ``type``, ``description``.
     - ``list-property``
   * - ``list value``, ``list parent``
     - ``suggestions``: each ``value`` (ready for ``update`` or
       ``--parent``) and ``display_string``.
     - ``list-value``, ``list-parent``
   * - ``list overlay``
     - ``overlays``: each ``name``, ``path``, ``devices``, ``fit``,
       ``reason``.
     - ``list-overlay``
   * - ``list node``
     - ``nodes``: each ``path``, ``key``, ``labels``, ``compatible``,
       ``origin``, ``change``, ``status``, ``has_children``.
     - ``list-node``
   * - ``validate``
     - ``errors`` and ``warnings``: each finding's ``kind``, ``path`` (the
       node's path, then the property), ``message`` and ``error_type``.
       ``ok`` is ``true`` whatever it finds; ``severity`` is ``error``,
       ``warn`` or ``info`` from the findings. With ``--full``,
       ``base_findings``, the count of the base devicetree's own.
     - ``validate``
   * - ``build``
     - ``path``: the file written (absolute). With ``output`` ``devicetree``,
       also ``source``, the full ``.dts``.
     - ``build``
   * - ``deploy``
     - None.
     - ``deploy``
   * - ``completion``
     - ``script``, or what ``--install`` or ``--uninstall`` did.
     - ``completion``
   * - ``skill``
     - ``path`` and ``agent`` of the skill installed or removed (``agents``,
       a list of both, with ``--agent all``). Without a name, ``skills``:
       each skill's ``name``, ``about``, ``installed``, ``agent`` and
       ``path``.
     - ``skill``

When ``build`` or ``deploy`` fails, the refusal's ``message`` is ``Build
failed: AA_BUILD exited with status <n>`` (or ``Deploy failed: …``), followed
by a newline and what the command wrote to standard error.

``analog-attach --json`` with no command answers ``usage`` (the usage text) and
``missing`` (the required settings still unset).

Examples
--------

.. code-block:: text

   $ analog-attach --json read accel reg
   {"ok":true,"message":"Read reg of accel","severity":"info","kind":"property","key":"reg","type":{"kind":"array","items":{"kind":"number","subtype":"int"},"min_items":1,"max_items":1},"value":[29],"source":"overlay","written":["0x1d"],"description":"Chip select used by the device.","required":true,"definition":"adi,adxl345.yaml","dt_type":"address · 1 row of 1 cell · 0 to 256","suggestions":{"values":[{"value":"29","display_string":"0x1d — matches the unit address of adxl345@1d"}]}}

.. code-block:: text

   $ analog-attach --json list node accel
   {"ok":true,"message":"1 node matches \"accel\"","severity":"info","nodes":[{"path":"/soc/i2c@7e804000/adxl345@1d","key":"adxl345@1d","labels":["accel"],"compatible":["adi,adxl345"],"origin":"internal","change":"added","has_children":false}]}

.. code-block:: text

   $ analog-attach --json validate
   {"ok":true,"message":"0 error(s), 0 warning(s)","severity":"info","errors":[],"warnings":[]}

.. code-block:: text

   $ analog-attach --json build
   {"ok":true,"message":"Built /home/user/work/rpi4-adxl345/overlay.dtso with AA_BUILD","severity":"info","path":"/home/user/work/rpi4-adxl345/build/overlay.dtbo"}
