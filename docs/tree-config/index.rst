Overview
--------

This section covers the Tree Config (advanced) editor. Content will be
expanded step by step.

The Tree Config view is the default editor for ``.dts`` files. It displays the
full device tree structure for the opened file.

When opening a ``.dtso`` file in the Tree Config view, you should merge a base
``.dts`` file first. After merging, the full tree is shown, but only your
changes are written back to the ``.dtso`` file.

Using the Tree
--------------

Click a node in the tree to view its configuration in the main panel.
Use the **+** button to add a new node. Newly added nodes can be enabled,
or deleted with the trash icon.

When you press **+**, a list of possible devices is shown, with an option to
add a custom node. A custom node is not interpreted and no validation is
performed for it; only custom properties can be added.

.. image:: https://raw.githubusercontent.com/analogdevicesinc/analog-attach/doc_resources/resources/tc-select-node-to-add.png
  :alt: Add node dialog with device list and custom node option.
  :align: center

Search
------

The search bar matches against the full node path. Selecting a result focuses
the node in the tree.

.. image:: https://raw.githubusercontent.com/analogdevicesinc/analog-attach/doc_resources/resources/tc-search-node.png
  :alt: Tree search results.
  :align: center

Configuration
-------------

The configuration panel supports device aliases with built-in validation.
Custom properties can be added and removed from the configuration list.

.. image:: https://raw.githubusercontent.com/analogdevicesinc/analog-attach/doc_resources/resources/tc-search-node.png
  :alt: Configuration panel with alias and custom properties.
  :align: center

Hidden Features
---------------

Go To Node
~~~~~~~~~~

Some properties reference other nodes in the device tree (for example, phandle
references). When a property has such a reference, the configuration panel shows
a dropdown listing the available target nodes. A button on the right side of the
dropdown lets you navigate directly to the referenced node — clicking it selects
that node in the tree and opens its configuration.

This feature is only available in the Tree Config view.

.. image:: https://raw.githubusercontent.com/analogdevicesinc/analog-attach/doc_resources/resources/tc-goto-node.png
  :alt: Hyperlink dropdown with the go-to button on the right.
  :align: center

Topics
------

- Overview (what the view is for)
- Tree navigation
- Editing nodes and properties
- Custom properties
- Validation feedback
