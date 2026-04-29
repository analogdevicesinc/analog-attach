# README

This folder ships data files inside the VSIX so the extension can run
attach-lib queries without requiring external repositories on disk.
The contents are treated as read-only runtime assets.

Contents:
- `dt-schema/` contains YAML binding schemas used by attach-lib.
- `linux-rpi-6.6.y/` contains a Linux tree snapshot used to resolve
  device bindings and parents.

Update notes:
- Keep the folders in sync with the intended upstream repos.

dt-schema git hash: aa85941 (tag: v2025.12)
linux git hash: a36c96a50d8c
