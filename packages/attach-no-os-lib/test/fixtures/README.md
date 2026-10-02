# Test fixtures

A miniature CAPI ecosystem: an interface module holding the generic structs, a platform
backend with two boards, and a driver collection. Together they exercise every edge the
registry walks — `rulesets_file`, a driver collection's category/driver chain, a platform's
`boards:`/`socs:`, a board's `peripherals:`, and `provides.interfaces`.

It exists because the tests used to read `/home/andrei-fabian/adi/no-OS/schemas` through a
symlink, so they only ran on one machine and only described the build system that has since
been replaced. Everything here is checked in and deliberately tiny: the point is to cover
the shapes, not to mirror a real part.
