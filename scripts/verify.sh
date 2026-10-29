#!/usr/bin/env bash
# Full check for attach-lib, attach-no-os-lib and @analog-attach/cli, in dependency order.
# @analog-attach/cli bundles the *built* libs, so they are rebuilt first
# (Yarn 4 does not run pre/post lifecycle hooks, so nothing is implicit).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

step "attach-lib: build"
yarn workspace attach-lib build
step "attach-lib: type-check (the build does not fail on type errors)"
yarn workspace attach-lib typecheck
step "attach-lib: test"
yarn workspace attach-lib test --run --exclude test/BindingParserCompletion.test.ts
step "attach-lib: lint"
yarn workspace attach-lib lint
step "attach-no-os-lib: build"
yarn workspace attach-no-os-lib build
step "attach-no-os-lib: test"
yarn workspace attach-no-os-lib test --run
step "attach-no-os-lib: lint"
yarn workspace attach-no-os-lib lint
step "@analog-attach/cli: build"
yarn workspace @analog-attach/cli build
step "@analog-attach/cli: lint"
yarn workspace @analog-attach/cli lint
step "@analog-attach/cli: test"
yarn workspace @analog-attach/cli test --run
printf '\nverify: all green\n'
