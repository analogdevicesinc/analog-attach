Introduction
============

What is Analog Attach
---------------------

Attaching a part to a Linux board means writing a devicetree overlay: finding
the part's binding in the kernel, the bus it sits on in the board's
devicetree, every property the binding requires and the values it allows,
then compiling the overlay, copying it to the board and finding out at boot
whether the driver probes. Analog Attach does this for you, from a command
line or a GUI in your browser.

It works with any device that has a Linux driver and a devicetree binding,
not only Analog Devices parts: it reads the bindings of your kernel tree and
the devicetree of your board. It checks every change against those bindings
as you make it, so mistakes show up on your desk rather than in the board's
``dmesg``. Then it builds the overlay and deploys it.

Ways to use it
--------------

.. list-table::
   :header-rows: 1

   * - Interface
     - Best for
     - Guide
   * - GUI (``analog-attach gui``)
     - A first project, exploring a part's properties, and seeing the
       devicetree and the validation findings as you edit
     - :doc:`/ui-guide/index`
   * - CLI
     - Working in a terminal or over SSH, scripts and CI, and repeating a
       configuration on several boards
     - :doc:`/cli-guide/index`
   * - Either, driven by an AI agent
     - Describing the hardware in your own words and letting the agent run the
       commands, with you confirming the wiring and the deploy
     - :doc:`/ai-agents/index`

The GUI runs the same commands as the CLI and shows each one in its console,
so you can switch between them in the same project.

Key features
------------

* Search the kernel's bindings for a part (``list devices``), and the buses
  of your board it can sit on (``list parent``).
* Add a device with the properties its binding requires, asked one by one,
  with suggestions, or copied from the binding's example or from an overlay of
  the kernel tree.
* Validate the overlay with dt-validate against the kernel's bindings, plus
  checks of addresses, chip selects, references and disabled buses.
* Build the overlay (``.dtbo``) or, for a board without overlay support, a
  full devicetree (``.dtb``) with the overlay applied.
* Deploy it with a project script: the starter copies it to a Raspberry Pi
  over SSH; replace it for any other board.
* ``--json`` on every command, for scripts, CI and AI agents.
* A skill for AI coding agents (Claude Code, Codex CLI, Gemini CLI), and an
  Assistant in the GUI.

Supported platforms
-------------------

Analog Attach runs on Linux, with Node.js 22 or newer and the tools listed in
:doc:`/install/index`. It was developed and tested on Ubuntu. The install
hints it prints cover Debian and Ubuntu, Fedora, Arch and openSUSE.
