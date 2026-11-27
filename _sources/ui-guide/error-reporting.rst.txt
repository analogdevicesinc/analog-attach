.. _ui-error-reporting:

Error reporting
===============

Every action in the GUI runs an ``analog-attach`` command, so the problems it
reports are the ones described in :doc:`/cli-guide/error-reporting`.

The GUI of a Linux project shows no pop-up notifications. A problem is said
where it happened, and the console has the full answer of the CLI.

Where messages appear
---------------------

* **Under a field.** A value the CLI refuses (a property, a setting, a project
  variable) keeps what you typed, marked, with the reason under the field.
  The message goes away at your next edit.
* **In a panel or a dialog.** Add a device, Rename Node, Move Node and the
  Deploy dialog say what is wrong in place, and stay open so you can correct
  it.
* **On the node card.** A refused enable, disable or delete is said by the
  card's actions.
* **In the console.** Every command the GUI runs is in the console with the
  CLI's answer; a failed one is in red. The console also shows the warnings
  of a change, and the required properties a node still lacks
  (``Still to set: interrupts``).

Validation errors and warnings
------------------------------

What dt-validate finds is not a refusal: the change is written, and the
findings are shown in the header's status (``2 errors``), in the Validation
list under the overlay, as a count on the node in the device tree, and under
the field of the property they are about. See :ref:`ui-validate-build-deploy`.

Configuration errors
--------------------

In the project setup, a value the CLI refuses is shown in its step, with the
CLI's message, and the step stays until you give another. For a Linux tree,
a folder inside a tree is refused, and the step offers the tree's root:
click **Use It**.

Later, the settings are changed in the Project tab of the settings, where a
refusal is shown under the field (see :ref:`ui-workspace-settings`).

Build and deploy failures
-------------------------

Build and deploy write their output to the console as it comes. A failure
ends with ``✘ Not built: the build refused, above``,
``✘ Not deployed: the deploy refused, above``, or
``✘ exited with <code>``. The reason is in the lines above it: for example a
missing ``aa_build.sh``, a variable that is not set, or a board that does not
answer over SSH. See :ref:`ui-build-deploy-commands` to fix the commands and
the board's variables.

When the GUI can't start
------------------------

``analog-attach gui`` writes its problems in the terminal. The most common is
a port that is taken:

.. code-block:: none

   Port 5177 on 127.0.0.1 is in use (another analog-attach gui?): pick another with --port, or --port 0 for any free one

This only happens with ``--port``: without it, the GUI takes another free
port. See :ref:`ui-starting`.

When the server has stopped
---------------------------

The page needs the ``analog-attach gui`` that served it. If that has stopped
(you pressed :kbd:`Ctrl+C`, or closed its terminal), the page stays open but
can't do anything:

* An action shows its command in the console, and no answer comes. The error
  is only in the browser's own developer console (a failed ``fetch``).
* **Browse…** and opening a file say ``The GUI's server did not answer.``
* The Assistant says ``The GUI's server didn't answer.``

Start ``analog-attach gui`` again in the project folder and use the page it
opens. An old tab doesn't work with the new server even on the same port (each
start gives its page a new key), so close it, or reload it if the port is the
same. Nothing is lost: the GUI saves each change as you make it.
