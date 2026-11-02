#!/usr/bin/env bash
# Run the functional tests and write the requirements report (README.md).
#
#   run.sh                              every test
#   run.sh noos/config.bats             one file (or folder), relative to this folder
#   run.sh --filter-tags req:CONFIG-04  the tests of one requirement (or eco:noos, ...)
#   run.sh --jobs 4                     in parallel (needs GNU parallel)
#   run.sh --fail-unless-gap            the known gaps don't fail the run (CI)
#
# Any other bats option goes through. The report is in out/ either way. The exit status is
# bats' (non-zero when a test failed, a known gap too) or the report's (a test naming an
# unknown requirement, or a run that stopped before its last test); with --fail-unless-gap it
# is the report's alone, which fails only on those and on a test that fails and isn't a known
# gap.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cli="$(cd "$here/../.." && pwd)"
# Where the report goes: out/, or FUNCTIONAL_OUT (runs side by side each need their own).
out="${FUNCTIONAL_OUT:-$here/out}"

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
report_options=()
fail_unless_gap=no
for argument in "$@"; do
	if [ "$argument" = --fail-unless-gap ]; then
		report_options+=(--fail-unless-gap)
		fail_unless_gap=yes
	elif [ -e "$here/$argument" ]; then
		targets+=("$argument")
	else
		options+=("$argument")
	fi
done
# Relative to this folder, as the report names the files.
[ ${#targets[@]} -eq 0 ] && targets=(noos linux)

# The linux tests' Linux tree and its caches (linux-tree.sh), when they run.
for target in "${targets[@]}"; do
	case "$target" in
		linux | linux/*) "$here/linux-tree.sh" >/dev/null || exit 2; break ;;
	esac
done

rm -rf "$out"
mkdir -p "$out"
cd "$here" || exit 2
# How many tests this run is to run, filters applied: the report fails a run that ran fewer.
expected=$(bash "$bats" --count --recursive "${options[@]}" "${targets[@]}" 2>/dev/null) &&
	report_options+=(--expected "$expected")
bash "$bats" --recursive --timing --report-formatter junit --output "$out" "${options[@]}" "${targets[@]}"
status=$?

python3 "$here/report.py" --junit "$out/report.xml" --tests "$here" \
	--requirements "$cli/docs/requirements.csv" --out "$out" "${report_options[@]}" "${targets[@]}"
report=$?

# With --fail-unless-gap the report decides: the known gaps fail bats, not the run.
if [ "$fail_unless_gap" = yes ]; then exit "$report"; fi
[ "$report" -ne 0 ] && [ "$status" -eq 0 ] && status=1
exit "$status"
