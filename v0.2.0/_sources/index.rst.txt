Analog Attach
=============

Analog Attach is a command line tool, with a GUI that runs locally in your
browser, for attaching devices to Linux boards through devicetree overlays. It
works with any device that has a Linux driver and a devicetree binding. It
writes the overlay for you, validates it against the bindings of your Linux
kernel tree, builds it and deploys it to the board. For boards without overlay
support it builds a full devicetree instead. An AI agent can drive it too:
it ships a skill for AI coding agents, and the GUI has an Assistant.

Analog Attach is distributed as an npm package attached to each release on
`GitHub <https://github.com/analogdevicesinc/analog-attach/releases#release-v0.2.0>`__.
The source code is available at :git-analog-attach:`/`.

.. toctree::
   :caption: Introduction
   :maxdepth: 2

   introduction/index

.. toctree::
   :caption: Installation
   :maxdepth: 2

   install/index

.. toctree::
   :caption: Quick Start
   :maxdepth: 2

   quick-start/index

.. toctree::
   :caption: Concepts
   :maxdepth: 2

   concepts/index

.. toctree::
   :caption: GUI Guide
   :maxdepth: 2

   ui-guide/index

.. toctree::
   :caption: CLI Guide
   :maxdepth: 2

   cli-guide/index

.. toctree::
   :caption: Working with AI Agents
   :maxdepth: 2

   ai-agents/index

.. toctree::
   :caption: Use Cases
   :maxdepth: 2

   use-cases/index

.. toctree::
   :caption: Reference
   :maxdepth: 2

   reference/index

.. toctree::
   :caption: Troubleshooting
   :maxdepth: 2

   troubleshooting/index
