# Test fixtures

A miniature CAPI ecosystem: an interface module holding the generic structs, a platform
backend with two boards, and a driver collection. Together they exercise every edge the
registry walks — `rulesets_file`, a driver collection's category/driver chain, a platform's
`boards:`/`socs:` and `interfaces_file`, a board's `peripherals:`, and `provides.interfaces`.

`adc-drivers/` is a second driver collection, opted into with `FIXTURE_ADC_DRIVERS` by the
tests that need it (test/bootstrap/deduction.test.ts). Its two parts mirror ad74413r and a
rival: `dualpart` has an ADC and a DAC side on one chip, `otheradc` only an ADC. With the
capi fixture's test_adc / test_adc_chan / test_dac they cover the deduction rules: strong
and weak drivers, elimination between the device and channel levels, handles that hang off
another root, and `--as` sharing one chip.

It exists because the tests used to read `/home/andrei-fabian/adi/no-OS/schemas` through a
symlink, so they only ran on one machine and only described the build system that has since
been replaced. Everything here is checked in and deliberately tiny: the point is to cover
the shapes, not to mirror a real part.
