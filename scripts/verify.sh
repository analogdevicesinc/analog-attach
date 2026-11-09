#!/usr/bin/env bash
# Check of attach-lib, attach-no-os-lib and @analog-attach/cli, in dependency order.
# @analog-attach/cli bundles the *built* libs, so they are rebuilt first
# (Yarn 4 does not run pre/post lifecycle hooks, so nothing is implicit).
#
#   scripts/verify.sh            everything (`yarn verify`): for common changes, and before a push
#   scripts/verify.sh --linux    the Linux side (`yarn verify:linux`): attach-lib, and the CLI without its noos backend
#   scripts/verify.sh --no-os    the no-OS side (`yarn verify:no-os`): attach-no-os-lib, and the CLI without its linux backend
#
# A side's mode leaves the other side's lib unbuilt, untested and unlinted (the CLI's build needs its dist/, so it is
# built only when that is missing), and leaves out the CLI tests of the other backend: its files under
# src/backends/<id>/ and the contract test's `the <id> backend` cases. The front end's tests run in both.
set -euo pipefail
cd "$(dirname "$0")/.."

mode=all
case "${1:-}" in
    "") ;;
    --linux) mode=linux ;;
    --no-os) mode=noos ;;
    *) echo "usage: scripts/verify.sh [--linux | --no-os]" >&2; exit 2 ;;
esac

step() { printf '\n== %s\n' "$1"; }

# A lib of the other side: built once when the CLI's build would miss its dist/, nothing else
build_if_missing() {
    if [ ! -d "packages/$1/dist" ]; then
        step "$1: build (its dist/ is missing, and the CLI's build needs it)"
        yarn workspace "$1" build
    fi
}

if [ "$mode" = noos ]; then
    build_if_missing attach-lib
else
    step "attach-lib: build"
    yarn workspace attach-lib build
    step "attach-lib: type-check (the build does not fail on type errors)"
    yarn workspace attach-lib typecheck
    step "attach-lib: test"
    yarn workspace attach-lib test --run --exclude test/BindingParserCompletion.test.ts
    step "attach-lib: lint"
    yarn workspace attach-lib lint
fi
if [ "$mode" = linux ]; then
    build_if_missing attach-no-os-lib
else
    step "attach-no-os-lib: build"
    yarn workspace attach-no-os-lib build
    step "attach-no-os-lib: test"
    yarn workspace attach-no-os-lib test --run
    step "attach-no-os-lib: lint"
    yarn workspace attach-no-os-lib lint
fi
step "@analog-attach/cli: build"
yarn workspace @analog-attach/cli build
step "@analog-attach/cli: lint"
yarn workspace @analog-attach/cli lint
case "$mode" in
    linux)
        step "@analog-attach/cli: test (without the noos backend)"
        yarn workspace @analog-attach/cli test --run --exclude 'src/backends/noos/**' --testNamePattern '^(?!the noos backend )'
        printf '\nverify --linux: all green\n' ;;
    noos)
        step "@analog-attach/cli: test (without the linux backend)"
        yarn workspace @analog-attach/cli test --run --exclude 'src/backends/linux/**' --testNamePattern '^(?!the linux backend )'
        printf '\nverify --no-os: all green\n' ;;
    *)
        step "@analog-attach/cli: test"
        yarn workspace @analog-attach/cli test --run
        printf '\nverify: all green\n' ;;
esac
