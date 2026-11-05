# How attach-lib reads a binding

`Attach.parse(binding, paths)` turns a devicetree binding (a JSON Schema in YAML, from the Linux tree) into a
`ParsedBinding`. That is, for each property the CLI can write, its type (`AttachType`: a flag, a number, a list or
matrix of cells, an enum of values, a child node) and the counts and bounds the binding gives it. This page lists
the steps it takes, generated from the list the code runs (`PARSE_STEPS`, `fixup_passes`), and follows a few
properties of real bindings through them.

## Why it differs from dt-schema

dt-schema validates a devicetree against the binding as written. It keeps each `$ref` to `types.yaml`
(`uint32-array`, `phandle-array`, ...) and reads a property's type from it. We need one schema per binding that says
everything about a property in one place, both for AJV to compile and for `translate` to read. So the `references`
stage replaces every `$ref` with what it names. That would lose the name of the type, so the resolver first tags each
`types.yaml` definition with its name (`dtType`).

The `fixups` stage then does what dt-schema's `fixups.py` does to every schema before validating: a string property is
a list of strings, a `reg` bounded as a number is one cell, a unit suffix types the property. Our own passes guess
what dt-schema reads from the `$ref`s we replaced: which schemas are integers (`mark_integers`), what a matrix's
rows are (`matrix_rows`), the bounds of a unit's numbers (`unit_cells`). A fixup that ports one of dt-schema's names
it in the table below. One without a dt-schema counterpart is ours.

## Branches and the canary

A binding's `allOf` entries hold `if` / `then` / `else` branches: a property that is required, or takes other
values, only for some `compatible`. `canaries` puts a `__canary__: false` property in each `then` and `else`. When the
CLI asks what applies to a node (`narrow_binding`), the node's data goes to AJV with `__canary__: true`.
Each branch that applies fails on it, the error's schema path names the branch, and that branch is merged into the
binding, which is translated again. That is all the CLI uses AJV for. What checks a devicetree is dt-validate.

## Reading the walkthroughs

Each walkthrough follows one property from its YAML to its `ParsedBinding` entry and lists only the steps that
changed it. A diff line is `+ /pointer: value` for an addition and `- /pointer: value` for a removal; a changed value
is both. The pointer is relative to the property. `(at /oneOf/1)` means the fixup ran on that branch of the property:
the walk fixes a property's branches before the property itself.

To follow any other property, run `node scripts/repros/stages.mjs <binding> [property]` (`--pattern <regex>` for a
child node's), or open every property of a binding in the browser with `yarn pipeline:view <binding>`.
