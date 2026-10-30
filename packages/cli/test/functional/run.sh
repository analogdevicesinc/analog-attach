#!/usr/bin/env bash
# Run the functional tests and write the requirements report (README.md).
#
#   run.sh                              every test
#   run.sh noos/config.bats             one file (or folder), relative to this folder
#   run.sh --filter-tags req:CONFIG-04  the tests of one requirement (or eco:noos, ...)
#   run.sh --jobs 4                     in parallel (needs GNU parallel)
#
# Any bats option goes through. The report is in out/ either way; the exit status is bats'
# (non-zero when a test failed) or the report's (a test naming an unknown requirement).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$(cd "$here/../.." && pwd)"
out="$here/out"

if [ ! -f "$cli/dist/cli.js" ]; then
	echo "No build: run 'yarn workspace @analog-attach/cli build' first." >&2
	exit 2
fi
# Yarn runs a package's bin with node, and bats is a bash script: find it and run it with bash.
bats="$(cd "$cli" && node -p 'require("path").join(require("path").dirname(require.resolve("bats/package.json")), "bin", "bats")')"
for tool in jq python3; do
	command -v "$tool" >/dev/null || { echo "The functional tests need $tool." >&2; exit 2; }
done

# The tests to run: the arguments that name a file or folder here, else every test.
targets=()
options=()
for argument in "$@"; do
	if [ -e "$here/$argument" ]; then targets+=("$argument"); else options+=("$argument"); fi
done
# Relative to this folder, as the report names the files.
[ ${#targets[@]} -eq 0 ] && targets=(noos linux)

rm -rf "$out"
mkdir -p "$out"
cd "$here" || exit 2
bash "$bats" --recursive --timing --report-formatter junit --output "$out" "${options[@]}" "${targets[@]}"
status=$?

if ! python3 "$here/report.py" --junit "$out/report.xml" --tests "$here" \
	--requirements "$cli/docs/requirements.csv" --out "$out" "${targets[@]}"; then
	[ "$status" -eq 0 ] && status=1
fi
exit "$status"
