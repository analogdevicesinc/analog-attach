# @analog-attach/extension — obsolete

This VS Code extension is obsolete and will be removed. The CLI (`packages/cli`) and its
GUI (`packages/gui`) replace it.

It is no longer built, linted or tested:

- its `build`, `watch` and `lint` scripts only print a notice;
- the root scripts that built, packaged or tested it are gone, and the root `tsconfig.json`
  no longer references it;
- the "Build VSIX" workflow no longer runs on push.

It does not build anyway: it imports attach-lib API that has since been removed
(the `Dts*` types, `parseDtso`). Its dependencies are left as they are and are not
bumped along with the rest of the repo.
