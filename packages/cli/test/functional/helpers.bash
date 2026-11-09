# Loaded by every functional test: `setup() { load ../helpers; new_project noos; }`.
#
# Each test runs the built CLI (dist/cli.js) as a user would, in its own scratch HOME and
# project directory, so no test sees another's settings, nor the machine's.

bats_require_minimum_version 1.5.0

FUNCTIONAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$FUNCTIONAL_DIR/../.." && pwd)"
REPO_DIR="$(cd "$CLI_DIR/../.." && pwd)"
NOOS_FIXTURES="$REPO_DIR/packages/attach-no-os-lib/test/fixtures"
# The Linux tree of the linux tests (linux-tree.sh clones it and builds its caches) and its RPi 4 base.
LINUX_TREE="${AA_LINUX:-$CLI_DIR/linux-adi}"
LINUX_CACHES="$CLI_DIR/linux-adi-caches"
LINUX_BASE="$LINUX_TREE/arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts"

# The assertion libraries, from the repo's node_modules (yarn installs them).
load "$REPO_DIR/node_modules/bats-support/load"
load "$REPO_DIR/node_modules/bats-assert/load"

# A fresh home and project per test: the global settings are $HOME/.config/analog-attach.
export HOME="$BATS_TEST_TMPDIR/home"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
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

# `new_project noos|linux [key=value...]`: the project's settings file, for that backend, and
# $WORKFILE, the workfile's path (not created yet).
# noos uses attach-no-os-lib's test fixtures (a capi, a platform with boards, drivers); linux the
# Linux tree of linux-tree.sh with the RPi 4 base, and its binding caches in the project's state
# directory. key=value pairs replace or add settings of the backend's section.
new_project() {
	local backend=$1
	shift
	local section='{}'
	case "$backend" in
		noos)
			section=$(jq -n --arg capi "$NOOS_FIXTURES/capi" \
				--arg platform "$NOOS_FIXTURES/platform" --arg drivers "$NOOS_FIXTURES/driver-collection" \
				'{ "capi-path": $capi, "module-paths": [$platform, $drivers], "target": "otherboard", "interview": "false" }')
			WORKFILE="$PROJECT/workfile.json"
			;;
		linux)
			[ -f "$LINUX_CACHES/.stamp" ] || fail "no Linux tree: run test/functional/linux-tree.sh (run.sh does)"
			WORKFILE="$PROJECT/overlay.dtso"
			section=$(jq -n --arg linux "$LINUX_TREE" --arg base "$LINUX_BASE" --arg workfile "$WORKFILE" \
				'{ "linux": $linux, "devicetree": $base, "workfile": $workfile }')
			mkdir -p "$PROJECT/.analog-attach/linux"
			cp "$LINUX_CACHES/"*.json "$PROJECT/.analog-attach/linux/"
			;;
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

# `with_overlay`: after `new_project linux`, `init`: an empty overlay at $WORKFILE.
with_overlay() {
	aa init >/dev/null || fail "init failed"
	[ -f "$WORKFILE" ] || fail "no workfile after init"
}

# `with_sensor`: after `new_project noos`, a workfile with the fixture's eval board added:
# testpart, testpart_cfg, testpart_ip, eval_testpart, testpart_spi_dev, testpart_cs_gpio,
# wired on otherboard and valid.
with_sensor() {
	aa init >/dev/null || fail "init failed"
	aa add eval-testpart >/dev/null || fail "add eval-testpart failed"
	[ -f "$WORKFILE" ] || fail "no workfile after add"
}

# `tty_run <expect> <keys> [<expect> <keys>...] -- <words>`: runs the CLI on a pseudo-terminal
# (stdin and stdout a terminal); each time the screen shows <expect>, after the previous one, it
# types <keys> ($'\r' Enter, $'\x1b[B' down, $'\x03' Ctrl-C). Sets $status and $output (the
# screen, escape codes removed). Gives up after $TTY_TIMEOUT s, 120 by default (status 124).
tty_run() {
	cat >"$BATS_TEST_TMPDIR/ttydrive.py" <<'PY'
import os, pty, re, select, sys, time
args = sys.argv[1:]
cut = args.index('--')
steps, words = args[:cut], args[cut + 1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp('node', ['node', os.environ['AA_CLI']] + words)
deadline = time.time() + float(os.environ.get('TTY_TIMEOUT') or 120)
raw = b''
def screen():
    return re.sub(r'\x1b\[[0-9;?]*[A-Za-z]|\r', '', raw.decode('utf-8', 'replace'))
def pump(wait):
    global raw
    ready, _, _ = select.select([fd], [], [], wait)
    if not ready:
        return True
    try:
        data = os.read(fd, 65536)
    except OSError:
        return False
    raw += data
    return bool(data)
alive, seen = True, 0
for expect, keys in zip(steps[0::2], steps[1::2]):
    while alive and expect not in screen()[seen:] and time.time() < deadline:
        alive = pump(0.1)
    if expect not in screen()[seen:]:
        print(screen() + '\n[tty_run: never saw %r]' % expect)
        os.kill(pid, 9)
        sys.exit(124)
    seen = screen().index(expect, seen) + len(expect)
    time.sleep(0.2)
    for key in re.findall(r'\x1b\[[A-D]|.', keys, re.S):
        os.write(fd, key.encode())
        time.sleep(0.05)
while alive and time.time() < deadline:
    alive = pump(0.1)
if alive:
    os.kill(pid, 9)
_, status = os.waitpid(pid, 0)
sys.stdout.write(screen())
sys.exit(124 if alive else os.waitstatus_to_exitcode(status))
PY
	AA_CLI="$CLI_DIR/dist/cli.js" run python3 -I "$BATS_TEST_TMPDIR/ttydrive.py" "$@"
}

# `snapshot`, then `assert_unchanged`: the workfile on disk ($WORKFILE) is as it was.
snapshot() {
	cp "$WORKFILE" "$BATS_TEST_TMPDIR/before"
}

assert_unchanged() {
	cmp -s "$BATS_TEST_TMPDIR/before" "$WORKFILE" ||
		fail "the workfile changed: $(diff "$BATS_TEST_TMPDIR/before" "$WORKFILE")"
}

# `drop_setting <key>...`: removes settings from the project's section of its backend.
drop_setting() {
	local file="$PROJECT/.analog-attach/config.json" key
	for key in "$@"; do
		jq --arg key "$key" '.backend as $backend | del(.[$backend][$key])' "$file" >"$file.new" &&
			mv "$file.new" "$file"
	done
}

# `stored <jq filter>`: the filter on the workfile on disk ($WORKFILE).
stored() {
	jq -c "$1" "$WORKFILE"
}

# `real_project`: the project's settings for the real trees, or skip without them.
real_project() {
	[ -n "${AA_CAPI_PATH:-}" ] && [ -n "${AA_MODULE_PATHS:-}" ] || skip "needs AA_CAPI_PATH and AA_MODULE_PATHS"
	need cmake ninja arm-none-eabi-gcc
	jq -n --arg capi "$AA_CAPI_PATH" --arg modules "$AA_MODULE_PATHS" --arg target "${AA_TARGET:-max32655fthr}" \
		'{ backend: "noos", noos: { "capi-path": $capi, "module-paths": ($modules | split(":")),
			"target": $target, "interview": "false" } }' >"$PROJECT/.analog-attach/config.json"
}

# --- Conformity: the same case on both backends -----------------------------------------------

# `conformity_projects`: a noos project ($NOOS_PROJECT, on the fixtures) and a linux one
# ($LINUX_PROJECT, on the Linux tree), side by side in the test's folder, neither with a workfile.
conformity_projects() {
	local eco
	for eco in noos linux; do
		PROJECT="$BATS_TEST_TMPDIR/$eco"
		mkdir -p "$PROJECT"
		new_project "$eco"
	done
	NOOS_PROJECT="$BATS_TEST_TMPDIR/noos" LINUX_PROJECT="$BATS_TEST_TMPDIR/linux"
	cd "$BATS_TEST_TMPDIR" || return 1
}

# `on <noos|linux> <words>`: runs the CLI in that backend's project (for the steps before the
# case: init, add); its output is thrown away, and a failure fails the test.
on() {
	local eco=$1 dir
	shift
	dir=$([ "$eco" = noos ] && echo "$NOOS_PROJECT" || echo "$LINUX_PROJECT")
	(cd "$dir" && aa "$@") >/dev/null || fail "$eco: $* failed"
}

# `conform <noos words> -- <linux words>`: runs the case on each backend, with --json, in its
# project. Sets $noos_status, $noos_output, $linux_status and $linux_output (stdout only).
conform() {
	local noos=() linux=()
	while [ $# -gt 0 ] && [ "$1" != -- ]; do noos+=("$1"); shift; done
	shift
	linux=("$@")
	run --separate-stderr bash -c 'cd "$1" && shift && node "$0" --json "$@"' "$CLI_DIR/dist/cli.js" "$NOOS_PROJECT" "${noos[@]}"
	noos_status=$status noos_output=$output
	run --separate-stderr bash -c 'cd "$1" && shift && node "$0" --json "$@"' "$CLI_DIR/dist/cli.js" "$LINUX_PROJECT" "${linux[@]}"
	linux_status=$status linux_output=$output
}

# `assert_same_status [<status>]`: both exited the same, and with <status> when given.
assert_same_status() {
	[ "$noos_status" = "$linux_status" ] || fail "noos exited $noos_status, linux $linux_status"$'\n'"noos: $noos_output"$'\n'"linux: $linux_output"
	[ $# -eq 0 ] || [ "$noos_status" = "$1" ] || fail "both exited $noos_status, not $1"
}

# `assert_same <jq filter> [<expected>]`: the filter gives the same on both results (and
# <expected> when given). Typical filters: '.ok', '[.configs[0] | keys]', '.devices[0] | shape'.
# `shape` (defined here for the filter) turns a value into its JSON types: {"a": 1} is
# {"a": "number"}, an array its first element's shape.
assert_same() {
	local shape='def shape: if type == "object" then with_entries(.value |= shape) elif type == "array" then (if length > 0 then [.[0] | shape] else [] end) else type end;'
	local noos linux
	noos=$(jq -c "$shape $1" <<<"$noos_output") || fail "noos: not JSON: $noos_output"
	linux=$(jq -c "$shape $1" <<<"$linux_output") || fail "linux: not JSON: $linux_output"
	[ "$noos" = "$linux" ] || fail "$1 differs: noos $noos, linux $linux"
	[ $# -lt 2 ] || [ "$noos" = "$2" ] || fail "$1: both $noos, not $2"
}

# `with_conformity_devices`: after `conformity_projects`, `init` on both, and a device added on each: on noos
# `test_gpio_pin` named `pin` (a property: `number`), on linux `adi,adxl345` under i2c1, labelled
# `adxl345` (a property: `reg`).
with_conformity_devices() {
	on noos init
	on linux init
	on noos add test_gpio_pin --name pin
	on linux add adi,adxl345 --parent i2c1
}
