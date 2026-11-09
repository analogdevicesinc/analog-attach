#!/usr/bin/env bash
# The Linux tree the linux functional tests run on, and its binding caches.
#
# The tree is analogdevicesinc/linux at a pinned commit of rpi-6.12.y, cloned on first use:
# shallow, blobless and sparse (the bindings, the dt-bindings headers, the arm and arm64
# broadcom device trees with the RPi overlays), so about 90 MB in 15 s. AA_LINUX names a
# checkout to use instead; the tests expect rpi-6.12.y's content.
#
# The caches are built once by the CLI itself (`config linux <tree>`), and again only when the
# tree, its commit or the installed dt-schema change; each test copies them into its project.
#
#   linux-tree.sh    clone and build what is missing, then print the tree's path
set -euo pipefail

REPOSITORY=https://github.com/analogdevicesinc/linux
BRANCH=rpi-6.12.y
COMMIT=96cf87b78682e86ec359a6bc6083aa6c86ed48b7
SPARSE=(Documentation/devicetree/bindings include/dt-bindings arch/arm/boot/dts arch/arm64/boot/dts/broadcom)

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$(cd "$here/../.." && pwd)"
tree="${AA_LINUX:-$cli/linux-adi}"
caches="$cli/linux-adi-caches"

# One at a time: runs side by side (FUNCTIONAL_OUT) share the clone and the caches.
if command -v flock >/dev/null; then
	exec 9>"$cli/linux-adi.lock"
	flock 9
fi

if [ -z "${AA_LINUX:-}" ] && [ "$(git -C "$tree" rev-parse HEAD 2>/dev/null)" != "$COMMIT" ]; then
	echo "Cloning $REPOSITORY ($BRANCH, $COMMIT) into $tree..." >&2
	rm -rf "$tree"
	git init -q "$tree"
	git -C "$tree" remote add origin "$REPOSITORY"
	git -C "$tree" sparse-checkout set --cone "${SPARSE[@]}"
	git -C "$tree" fetch -q --depth 1 --filter=blob:none origin "$COMMIT"
	git -C "$tree" checkout -q FETCH_HEAD
fi
[ -d "$tree/Documentation/devicetree/bindings" ] || { echo "Not a Linux tree: $tree" >&2; exit 2; }

[ -f "$cli/dist/cli.js" ] || { echo "No CLI build: run 'yarn workspace @analog-attach/cli build' first." >&2; exit 2; }
dt_schema="$(dt-mk-schema --version 2>/dev/null)" || { echo "dt-mk-schema not found on PATH: install dt-schema (test/functional/README.md)." >&2; exit 2; }
script="$(sha256sum "$cli/scripts/dt-mk-schema.py" | cut -d' ' -f1)"
stamp="$tree $(git -C "$tree" rev-parse HEAD 2>/dev/null || echo unversioned) dt-schema $dt_schema $script"
if [ "$(cat "$caches/.stamp" 2>/dev/null)" != "$stamp" ]; then
	echo "Building the binding caches of $tree..." >&2
	work="$(mktemp -d)"
	trap 'rm -rf "$work"' EXIT
	(
		cd "$work"
		export HOME="$work" XDG_CONFIG_HOME="$work/.config"
		node "$cli/dist/cli.js" config backend linux >/dev/null
		node "$cli/dist/cli.js" config linux "$tree" >/dev/null
	)
	rm -rf "$caches"
	mkdir -p "$caches"
	mv "$work/.analog-attach/linux/"*.json "$caches/"
	echo "$stamp" >"$caches/.stamp"
fi
echo "$tree"
