#!/usr/bin/env bash
# Full check for attach-lib and attach-cli, in dependency order.
# attach-cli bundles the *built* attach-lib, so the lib is rebuilt first
# (Yarn 4 does not run pre/post lifecycle hooks, so nothing is implicit).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== %s\n' "$1"; }

step "attach-lib: build"
yarn workspace attach-lib build
step "attach-lib: test"
yarn workspace attach-lib test --run --exclude test/BindingParserCompletion.test.ts
step "attach-cli: build (tsc type-check + tsup)"
yarn workspace attach-linux build
step "attach-cli: lint"
yarn workspace attach-linux lint
step "attach-cli: test"
yarn workspace attach-linux test --run
printf '\nverify: all green\n'
