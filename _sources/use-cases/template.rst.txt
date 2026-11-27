.. _use-case-template:

Use case template
=================

Copy this page into a new folder under ``use-cases/`` and fill it in.

Goal
----

One or two sentences: what the reader will have at the end.

What you need
-------------

.. list-table::
   :header-rows: 1

   * - Item
     - Details
   * - Board / carrier
     - ``<board name, revision>``
   * - Evaluation board / part
     - ``<part number, and the evaluation board or Click>``
   * - Cables and power
     - ``<cables, power supply>``
   * - Host
     - Linux machine with Analog Attach installed
   * - Software versions
     - ``<Analog Attach, kernel tree and branch, board image>``

.. figure:: ../sources/placeholder.svg
   :width: 100%

   Hardware setup. Label every connection.

Walkthrough video
-----------------

.. video:: <VIDEO_URL>

   Full walkthrough

Steps
-----

Step 1: <title>
~~~~~~~~~~~~~~~

Text, command, expected output.

.. figure:: ../sources/placeholder.svg

   Caption

.. code-block:: bash

   analog-attach <command>

Step 2: <title>
~~~~~~~~~~~~~~~

``<Repeat for every step.>``

Result
------

What success looks like: output, a photo of the working setup, and the final
``.dtso``.

Troubleshooting
---------------

Problems specific to this use case.

Next steps
----------

Links to related use cases and guide chapters.
