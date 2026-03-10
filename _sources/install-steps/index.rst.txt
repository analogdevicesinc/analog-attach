Requirements
-------------------------------------------------------------------------------

.. important::

   Analog Attach requires a valid Linux kernel repository (for example,
   ``analogdevicesinc/linux``) to be configured in settings before the
   extension can function.

.. important::

   Analog Attach also requires the following packages to enable all
   features:

   1. C compiler (gcc). Needed for precompiling dts/dtso files if needed ``sudo apt install gcc``
   2. Device Tree Compiler (dtc). Can be installed with ``sudo apt install device-tree-compiler``
   3. Ssh for connecting to a device. ``sudo apt install ssh``
   4. Ssh password authentication (sshpass). Needed for deploying to a device ``sudo apt install sshpass``.

Getting the Extension
-------------------------------------------------------------------------------

Analog Attach can be installed in two ways:

1. VS Code Marketplace (upcoming).
2. From a VSIX built by this project:

   - Download a VSIX from the project build artifacts.
   - In VS Code, open the Extensions view, click the three‑dot menu, and select
     ``Install from VSIX...``.
   - Choose the downloaded VSIX file to install.
