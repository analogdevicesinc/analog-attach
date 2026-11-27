Working with AI Agents
======================

Analog Attach can be driven by an AI agent. The agent runs the same
``analog-attach`` commands you would, reads their ``--json`` answers, and asks
you what only you know: which part you have and how it is wired. The skill is
written and tested for **Claude Code**; it can also be installed for Codex CLI
and Gemini CLI.

There are two ways to work with an agent:

* In a terminal, with the agent and the ``analog-attach-linux`` skill (see
  :doc:`/use-cases/linux/cli-ai-agent/index`).
* In the GUI, with its **✦ Assistant** (see :ref:`ui-workspace-assistant` and
  :ref:`use-case-ui-ai-agent`).

Installing the skills
---------------------

A *skill* is a set of instructions the agent loads when a task needs it: here,
how to use the CLI, in which order, and what to ask the user. The package
ships one skill for each backend; in v0.2.0 that is ``analog-attach-linux``.

.. code-block:: bash

   analog-attach skill install analog-attach-linux

``skill install`` with no name lists the skills and whether each is
installed:

.. code-block:: text

   $ analog-attach skill install
   Skills of the linux backend:
     analog-attach-linux  Linux device tree overlays (installed)

   Install one with: analog-attach skill install <name>

The skill is copied to the agent's skills folder. ``--agent`` picks the agent:

.. list-table::
   :header-rows: 1

   * - ``--agent``
     - Agent
     - Installed in
   * - ``claude`` (default)
     - Claude Code
     - ``~/.claude/skills/analog-attach-linux/``
   * - ``codex``
     - Codex CLI
     - ``~/.agents/skills/analog-attach-linux/``
   * - ``gemini``
     - Gemini CLI
     - ``~/.gemini/skills/analog-attach-linux/``
   * - ``all``
     - Each of them that is installed
     - Each agent's folder

.. code-block:: bash

   analog-attach skill install analog-attach-linux --agent codex   # for Codex CLI
   analog-attach skill install analog-attach-linux --force         # update an installed copy
   analog-attach skill uninstall analog-attach-linux               # remove it

Install the skill again with ``--force`` after you update Analog Attach, so
its instructions match the CLI.

How an agent uses Analog Attach
-------------------------------

The agent never runs a bare ``analog-attach`` (the guided setup is for a
person). It runs every command with ``--json`` and reads the one line of JSON
each prints (see :ref:`ref-json-protocol`): ``ok`` says whether the command
did what was asked, and a refusal or a configuration error says why, with a
hint the agent can follow. The loop is:

#. **Check the project.** ``config`` shows what is set. If the project is new,
   the agent asks you for the kernel tree and the board, then runs
   ``config linux``, ``list context``, ``config devicetree``,
   ``config workfile`` and ``init``.
#. **Find the device.** ``list devices <part>`` gives the compatible, and
   ``list overlay <compatible>`` an overlay of the kernel tree to start from,
   if there is one.
#. **Find the bus.** ``list parent <compatible>`` lists the buses the device
   can sit on. The agent asks you which one it is wired to.
#. **Add it.** ``add <compatible> --parent <bus>``. Under ``--json``, ``add``
   asks nothing: the required properties still missing come back in
   ``missing_required``, with suggestions.
#. **Set the properties.** ``list value`` and ``update`` for each. The agent
   asks you for the wiring (address, interrupt line and edge, GPIOs) rather
   than guessing it.
#. **Validate.** ``validate`` until there are no errors and the warnings are
   dealt with (a disabled bus is fixed with ``enable``).
#. **Build and deploy, when you ask.** ``build``, then ``deploy``.

What you confirm
----------------

The agent edits the workfile on its own: every change is one command, which
you can read, and undo with another. What touches the board is yours to
approve:

* **Deploy.** The starter ``aa_deploy.sh`` copies the build to the board and
  **reboots it**. The skill tells the agent to ask you first.
* **The board's password.** It is never stored. The agent asks you for it and
  passes it in the environment of ``deploy`` only.
* **Flashing**, and any other command that writes to a board, such as a
  deploy script that writes a full devicetree to the board's flash.
* **The wiring.** Check the bus, address and interrupt the agent proposes
  against your hardware: the CLI validates the overlay against the bindings,
  not against what is on the bench.

Claude Code asks before it runs a command you haven't allowed. You can allow
``analog-attach`` commands for the session, but keep ``deploy`` behind a
question.

Use cases
---------

* :doc:`/use-cases/linux/ui-ai-agent/index`
* :doc:`/use-cases/linux/cli-ai-agent/index`
