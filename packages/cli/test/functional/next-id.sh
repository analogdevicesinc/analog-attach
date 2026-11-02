#!/usr/bin/env bash
# Print the next free test ID of an ecosystem (README.md): the highest ID of its prefix in
# the .bats files here, plus one, so the IDs of deleted tests aren't given out again (except
# the highest's, once it is gone). IDs are never renumbered.
#
#   next-id.sh noos     N0042
#   next-id.sh linux    L0108
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
	noos) prefix=N ;;
	linux) prefix=L ;;
	*) echo "Usage: next-id.sh noos|linux" >&2; exit 2 ;;
esac

# Every id:<prefix>NNNN tag, in any .bats file under here.
highest=$(grep -rhoE --include='*.bats' "\bid:${prefix}[0-9]{4}\b" "$here" | cut -c5- | sort -n | tail -n 1 || true)
printf '%s%04d\n' "$prefix" $((10#${highest:-0} + 1))
