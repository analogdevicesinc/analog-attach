# Loaded by every functional test: `setup() { load ../helpers; new_project noos; }`.
#
# Each test runs the built CLI (dist/cli.js) as a user would, in its own scratch HOME and
# project directory, so no test sees another's settings, nor the machine's.

bats_require_minimum_version 1.5.0

FUNCTIONAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$FUNCTIONAL_DIR/../.." && pwd)"
REPO_DIR="$(cd "$CLI_DIR/../.." && pwd)"
NOOS_FIXTURES="$REPO_DIR/packages/attach-no-os-lib/test/fixtures"

# The assertion libraries, from the repo's node_modules (yarn installs them).
load "$REPO_DIR/node_modules/bats-support/load"
load "$REPO_DIR/node_modules/bats-assert/load"

# A fresh home and project per test: the global settings are $HOME/.config/analog-attach.
export HOME="$BATS_TEST_TMPDIR/home"
export XDG_CONFIG_HOME="$HOME/.config"
export NO_COLOR=1
PROJECT="$BATS_TEST_TMPDIR/project"
mkdir -p "$HOME" "$PROJECT"
cd "$PROJECT" || exit 1

# The CLI under test.
aa() {
	node "$CLI_DIR/dist/cli.js" "$@"
}

# `run_json <words>`: `run` with --json, standard error kept apart so $output is the JSON alone.
run_json() {
	run --separate-stderr aa --json "$@"
}

# `assert_json <jq filter> <expected>`: the filter applied to $output prints <expected>.
assert_json() {
	local actual
	actual="$(jq -r "$1" <<<"$output")" || fail "not JSON: $output"
	[ "$actual" = "$2" ] || fail "$1: expected '$2', got '$actual'"$'\n'"output: $output"
}

# `new_project noos|linux [key=value...]`: the project's settings file, for that backend.
# noos uses attach-no-os-lib's test fixtures (a capi, a platform with boards, drivers);
# key=value pairs replace or add settings of the backend's section.
new_project() {
	local backend=$1
	shift
	local section='{}'
	case "$backend" in
		noos)
			section=$(jq -n --arg capi "$NOOS_FIXTURES/capi" \
				--arg platform "$NOOS_FIXTURES/platform" --arg drivers "$NOOS_FIXTURES/driver-collection" \
				'{ "capi-path": $capi, "module-paths": [$platform, $drivers], "target": "otherboard", "interview": "false" }')
			;;
		linux) ;;
		*) fail "new_project: unknown backend $backend" ;;
	esac
	local pair
	for pair in "$@"; do
		section=$(jq --arg key "${pair%%=*}" --arg value "${pair#*=}" '.[$key] = $value' <<<"$section")
	done
	mkdir -p "$PROJECT/.analog-attach"
	jq -n --arg backend "$backend" --argjson section "$section" '{ backend: $backend, ($backend): $section }' \
		>"$PROJECT/.analog-attach/config.json"
}

# `need <command>...`: skip the test when a tool it needs is not installed.
need() {
	local tool
	for tool in "$@"; do
		command -v "$tool" >/dev/null 2>&1 || skip "needs $tool"
	done
}
