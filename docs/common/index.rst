Topics
------

This section contains shared workflows and UI concepts.

- Commands and command palette
- Left side panel
- Opening files and selecting editors
- Switching editors
- Settings
- Sidebar (Analog Attach panel)
- File types (.dts, .dtso)
- Save, validate, and compile flow
- Behind the Scenes (Helpful Behaviors)

Switching Editors
-----------------

You can switch between editors for the current file in two ways:

- Right-click the file tab and select ``Reopen Editor With...``
- Open the Analog Attach side panel and click ``Switch View``

.. image:: https://raw.githubusercontent.com/analogdevicesinc/analog-attach/doc_resources/resources/common-switch-view.png
  :alt: Switch view
  :align: center

Settings
--------

Open settings with ``Ctrl+,`` or via **File > Preferences > Settings**.
You can also open settings from the Analog Attach side panel by clicking
``Open Settings``.
You can search for ``Analog Attach`` in the Settings UI.

Key settings:

``Analog Attach: Default Linux Repository``
    Path to a Linux kernel repository used for bindings and preprocessing.

``Analog Attach: Default Dt Schema Repository``
    Path to the dt-schema repository. If not set, the bundled copy is used.

``Analog Attach: Preprocess DTS Files Command``
    Command used to preprocess DTS files that contain include directives.

``Analog Attach: Compile DTS File Command``
    Command used to compile a DTS/DTSO file.

``Analog Attach: Decompile DTB File Command``
    Command used to decompile a DTB file.

``Analog Attach: SSH Config``
    SSH command template used for remote execution.

``Analog Attach: SSHPass Config``
    sshpass command template used for remote uploads.

``Analog Attach: Remote Host``
    Remote target host used to build the SSH command.

``Analog Attach: Remote User``
    Remote username used to build the SSH command.

``Analog Attach: Remote Password``
    Remote password used to build the sshpass command.

``Analog Attach: Enable Auto Merge Dtso Base``
    When enabled, Analog Attach remembers the DTS base you selected for a
    ``.dtso`` overlay and automatically re-merges that base the next time you
    open the overlay.

Behind the Scenes (Helpful Behaviors)
-------------------------------------

Analog Attach performs a few automatic actions to reduce manual work. These
behaviors can be easy to miss at first:

- **Auto-merge remembered DTS bases for DTSO files** when
  ``Enable Auto Merge Dtso Base`` is enabled.
- **Channel-aware validation** runs on configuration updates to highlight
  missing required properties for device channels.
- **Parent validation and filtering** helps guide you to valid parent nodes
  when selecting a placement for a device.
- **Enable/Disable behavior**: enabling a node turns on any disabled ancestors
  up to the root, while disabling only affects the selected node. This is an
  intentional design decision (and a known limitation).

  A side effect is that if you delete a node after enabling a parent via this
  behavior, the parent can remain enabled and still be printed in the DTS/DTSO
  output.

Sidebar (Analog Attach Panel)
-----------------------------

The Analog Attach side panel provides quick access to common actions and remote
settings.

Buttons
~~~~~~~

- **Merge DTS into DTSO**: Run the merge command for the currently open overlay.
- **Compile Device Tree**: Compile the current DTS/DTSO file.
- **Deploy Device Tree**: Deploy the compiled device tree to the target.
- **Open Settings**: Open Analog Attach settings.
- **Switch View**: Switch between Plug and Play and Tree Config views.

Remote Settings
~~~~~~~~~~~~~~~

The Remote Settings section lets you edit the target connection details:

- **IP Address**: Remote host address
- **User**: Remote username
- **Password**: Remote password

When you update these fields, the extension updates the derived SSH commands
(``analog-attach.sshConfig`` and ``analog-attach.sshpassConfig``) automatically.
