# General requirements (GEN-*), where the backend is linux.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
}

# `with_accel`: an overlay with an ADXL345 on i2c1: label adxl345, i2c_arm/adi,adxl345@0,
# /soc/i2c@7e804000/adi,adxl345@0; interrupt-parent and interrupts still missing.
with_accel() {
	with_overlay
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
}

# `checksum`: a digest of the workfile and both settings files, to tell whether any changed.
checksum() {
	cat "$WORKFILE" "$PROJECT/.analog-attach/config.json" \
		"$HOME/.config/analog-attach/config.json" 2>/dev/null | sha256sum
}

# --- GEN-01, GEN-02: one tool, the same commands -------------------------------------------

# bats test_tags=req:GEN-01
@test "one tool: the ecosystem is a setting of the project" {
	run_json config backend
	assert_success
	assert_json '.configs[0].value' linux
	assert_json '.configs[0].source' local
	run aa --help
	assert_success
	assert_output --partial "analog-attach"
	assert_output --partial "Backend: linux"
	# The same tool, in a project whose setting names the other ecosystem.
	mkdir -p "$BATS_TEST_TMPDIR/other/.analog-attach"
	echo '{"backend": "noos"}' >"$BATS_TEST_TMPDIR/other/.analog-attach/config.json"
	cd "$BATS_TEST_TMPDIR/other"
	run aa --help
	assert_success
	assert_output --partial "Backend: noos"
}

# bats test_tags=req:GEN-02
@test "the shared commands are there under the same names" {
	run aa --help
	assert_success
	local command
	for command in config init import add read update delete rename list validate build deploy completion skill; do
		assert_output --regexp $'\n'"  $command +[A-Z]"
	done
}

# bats test_tags=req:GEN-02
@test "a shared command answers in the same form: config sets a setting" {
	run_json config deploy-user pi
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set deploy-user = pi"
}

# --- GEN-03: only the selected ecosystem's commands, flags and settings --------------------

# bats test_tags=req:GEN-03
@test "help leaves out the commands of the noos backend" {
	run aa --help
	assert_success
	refute_output --regexp $'\n  generate '
	assert_output --regexp $'\n  move '
	assert_output --regexp $'\n  enable '
	assert_output --regexp $'\n  disable '
}

# bats test_tags=req:GEN-03
@test "completion offers only the commands and settings of linux" {
	run aa __complete -- ""
	assert_success
	assert_line --regexp $'^move\t'
	refute_line --regexp $'^generate\t'
	run aa __complete -- config ""
	assert_success
	assert_line --regexp $'^devicetree\t'
	assert_line --regexp $'^overlay-syntax\t'
	refute_line --regexp $'^(capi-path|module-paths|target|probe|bootstrap|project-name)\t'
	run aa __complete -- build --
	refute_line --regexp $'^--(board|clean)\t'
}

# bats test_tags=req:GEN-03
@test "a setting of the noos backend is not a setting here" {
	run aa config capi-path
	assert_failure 2
	assert_output --partial "Unknown config field: capi-path"
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | index("target")' null
}

# bats test_tags=req:GEN-03
@test "a command of the noos backend is refused" {
	with_accel
	run aa generate
	assert_failure 2
	run aa build --clean
	assert_failure 2
}

# --- GEN-04, GEN-05, GEN-06: questions --------------------------------------------------

# bats test_tags=req:GEN-04
@test "a whole session runs without a question, with no terminal" {
	# The deploy step through a stand-in sshpass, which only logs.
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho "$*" >>"%s"\n' "$BATS_TEST_TMPDIR/sshpass.log" >"$BATS_TEST_TMPDIR/bin/sshpass"
	chmod +x "$BATS_TEST_TMPDIR/bin/sshpass"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH"
	local step
	for step in "init" "list devices adi,adxl34" "list parent adi,adxl345" "add adi,adxl345 --parent i2c1" \
		"list value adxl345 interrupt-parent" "update adxl345 interrupt-parent gpio" \
		"update adxl345 interrupts 25 IRQ_TYPE_EDGE_FALLING" "rename adxl345 adi,adxl345@53" "read adxl345" \
		"enable spi0" "disable spi0" "move adxl345 i2c3" "validate" "build" "config deploy-ip 192.0.2.1" \
		"config deploy-user pi" "config deploy-password secret" "deploy" "delete adxl345 --force"; do
		# shellcheck disable=SC2086
		run --separate-stderr timeout 60 node "$CLI_DIR/dist/cli.js" --json $step </dev/null
		[ "$status" -eq 0 ] || fail "$step: exit $status: $output $stderr"
		[ "$(jq -r '.ok // "none"' <<<"$output")" != false ] || fail "$step refused: $output"
	done
	[ -f "$PROJECT/overlay.dtbo" ]
	[ -s "$BATS_TEST_TMPDIR/sshpass.log" ]
}

# bats test_tags=req:GEN-05
@test "with no terminal, add asks nothing and reports what it would have asked" {
	with_overlay
	run timeout 30 node "$CLI_DIR/dist/cli.js" add adi,adxl345 </dev/null
	assert_success
	refute_output --partial "Where does adi,adxl345 go?"
	refute_output --partial "[1/2]"
	assert_output --partial "Parent: spi (use --parent to choose another)"
	assert_output --partial "Missing required: interrupt-parent, interrupts"
}

# bats test_tags=req:GEN-05
@test "with --json, add asks nothing and reports what is left in the result" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1
	assert_success
	assert_json '[.missing_required[].property] | join(",")' "interrupt-parent,interrupts"
	assert_json '.missing_required[0].suggestions | map(.value) | index("gpio") != null' true
}

# bats test_tags=req:GEN-05
@test "on a terminal, --json still asks nothing" {
	with_overlay
	tty_run -- --json add adi,adxl345
	assert_success
	refute_output --partial "Where does adi,adxl345 go?"
	assert_output --partial '"missing_required"'
}

# bats test_tags=req:GEN-05
@test "on a terminal, add asks for the parent, then for what is left" {
	with_overlay
	tty_run "parent [a]:" $'i\r' "interrupt-parent [a]:" $'\x03' -- add adi,adxl345
	assert_output --partial "Where does adi,adxl345 go?"
	assert_output --regexp "i\) i2c1 +/soc/i2c@7e804000"
	assert_output --partial "[1/2] interrupt-parent"
}

# bats test_tags=req:GEN-06
@test "stopping a question with Ctrl+C ends the command and keeps the answers given" {
	with_overlay
	tty_run "parent [a]:" $'i\r' "interrupt-parent [a]:" $'\r' "interrupts 1/3" $'\x03' -- add adi,adxl345
	[ "$status" -ne 124 ] || fail "the command didn't end: $output"
	run_json read adxl345 interrupt-parent
	assert_json '.value' "&gicv2"
	run_json read adxl345 interrupts
	assert_json '.value' null
}

# bats test_tags=req:GEN-06
@test "stopping the first question with Ctrl+C ends add, adding nothing" {
	with_overlay
	snapshot
	tty_run "parent [a]:" $'\x03' -- add adi,adxl345
	assert_failure 130
	assert_output --partial "nothing added"
	assert_unchanged
}

# --- GEN-07, GEN-08, GEN-17: JSON results ------------------------------------------------

# bats test_tags=req:GEN-07
@test "--json is taken anywhere on the command line" {
	with_accel
	local words
	for words in "--json config overlay-syntax" "config --json overlay-syntax" "config overlay-syntax --json" \
		"--json read adxl345" "read adxl345 --json" "list --json devices adi,adxl" "list devices adi,adxl --json"; do
		# shellcheck disable=SC2086
		run --separate-stderr aa $words
		[ "$status" -eq 0 ] || fail "$words: exit $status"
		[ "${#lines[@]}" -eq 1 ] || fail "$words: not one line: $output"
		jq -e 'type == "object"' <<<"$output" >/dev/null || fail "$words: not a JSON object: $output"
	done
}

# bats test_tags=req:GEN-07
@test "every command prints one JSON result with --json" {
	with_accel
	local words
	for words in "init" "config" "add adi,ad7124-8 --parent spi0 --name adc@2" "update adxl345 interrupt-parent gpio" \
		"read adxl345" "read adxl345 compatible" "rename adxl345 adi,adxl345@1d" "list devices adi,adxl" \
		"list property adxl345" "list value adxl345 interrupt-parent" "list parent adi,adxl345" \
		"list overlay adi,adxl345" "enable spi1" "disable spi1" "move spi0/adc@2 spi1" "validate" "build" \
		"delete spi1/adc@2 --force" "import rpi-adxl345-overlay.dts" "completion bash"; do
		# shellcheck disable=SC2086
		run --separate-stderr aa --json $words
		[ "$status" -eq 0 ] || fail "$words: exit $status: $stderr"
		[ "${#lines[@]}" -eq 1 ] || fail "$words: not one line: $output"
		jq -e 'type == "object"' <<<"$output" >/dev/null || fail "$words: not a JSON object: $output"
	done
}

# Gap: a result longer than 64 KiB is cut short when standard output is a pipe (the process
# exits before the pipe has taken it all): `--json list devices` gives 65536 or 131072 bytes of
# its 1 MB.
# bats test_tags=req:GEN-07, gap
@test "a long JSON result reaches a pipe whole" {
	with_overlay
	run bash -c "node '$CLI_DIR/dist/cli.js' --json list devices | jq -e '.devices | length > 1000'"
	assert_success
	run bash -c "node '$CLI_DIR/dist/cli.js' list devices | wc -l"
	[ "$output" -gt 1000 ] || fail "list devices gave $output lines"
}

# bats test_tags=req:GEN-08
@test "a JSON result says ok, with a message and a severity" {
	with_accel
	run_json update adxl345 interrupt-parent gpio
	assert_json '.ok' true
	assert_json '.severity' info
	assert_json '.message | length > 0' true
	# A refusal: the same structure.
	run_json read nosuchnode
	assert_success
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | length > 0' true
	# A warning.
	run_json delete
	assert_json '.ok' true
	assert_json '.severity' warn
}

# Gap: read, update when it reads, and validate answer the node, the property or the
# diagnostics alone, with no ok, message or severity (02-common.md C-7).
# bats test_tags=req:GEN-08, gap
@test "reading and validating say ok, with a message and a severity, too" {
	with_accel
	local words
	for words in "read" "read adxl345" "read adxl345 compatible" "update adxl345 compatible" "validate"; do
		# shellcheck disable=SC2086
		run_json $words
		jq -e 'has("ok") and has("message") and has("severity")' <<<"$output" >/dev/null ||
			fail "$words: $(jq -c keys <<<"$output")"
	done
}

# bats test_tags=req:GEN-17, gap
@test "an error carries a type from the fixed list" {
	# Gap: a refusal has ok, message and severity only; there is no error type field.
	with_accel
	run_json add adi,nosuchdevice
	assert_json '.ok' false
	assert_json '(.type // .error_type // .kind // "") | length > 0' true
}

# --- GEN-09: exit status -----------------------------------------------------------------

# bats test_tags=req:GEN-09
@test "a refusal exits 0, the outcome in the result" {
	with_accel
	run_json read nosuchnode
	assert_success
	assert_json '.ok' false
	run aa add adi,nosuchdevice
	assert_success
	run_json delete nosuchnode --force
	assert_success
	assert_json '.ok' false
}

# bats test_tags=req:GEN-09
@test "a usage error exits non-zero" {
	run aa nosuchcommand
	assert_failure 2
	run aa config --reset
	assert_failure 2
	run aa read --nosuchflag
	assert_failure 2
	run aa move adxl345
	assert_failure 2
}

# Gap: a refused value exits 2, the reason as text on stderr, with no JSON.
# bats test_tags=req:GEN-09, gap
@test "a refused setting value exits 0 with ok false" {
	run_json config overlay-syntax braces
	assert_success
	assert_json '.ok' false
	run_json config linux "$BATS_TEST_TMPDIR"
	assert_success
	assert_json '.ok' false
}

# An unknown setting is a usage error: the one case, with a bad argument, where the exit status
# isn't 0.
# bats test_tags=req:GEN-09
@test "an unknown setting is a usage error: non-zero, the reason on stderr" {
	run_json config nosuchkey
	assert_failure 2
	[ -z "$output" ]
	[[ "$stderr" == *"Unknown config field: nosuchkey"* ]]
}

# Gap: under --json a missing setting is a config-error object on standard error with exit 2
# (02-common.md C-11); in human mode it exits 0. noos answers {"ok": false, …} with exit 0.
# bats test_tags=req:GEN-09, gap
@test "a missing setting exits 0 with and without --json, the outcome in the result" {
	drop_setting linux
	run aa read
	assert_success
	run_json read
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("linux")' true
}

# --- GEN-10, GEN-11: help and version ----------------------------------------------------

# bats test_tags=req:GEN-10
@test "--help lists the commands" {
	run aa --help
	assert_success
	assert_output --partial "COMMANDS"
	assert_output --regexp $'\n  add +Add'
	assert_output --regexp $'\n  move +Move'
	assert_output --regexp $'\n  config +Show'
}

# bats test_tags=req:GEN-10
@test "<command> --help describes the command, its arguments and flags" {
	run aa add --help
	assert_success
	assert_output --partial "analog-attach add"
	assert_output --partial "ARGUMENTS"
	assert_output --partial "FLAGS"
	assert_output --partial "--parent"
	assert_output --partial "--template"
	run aa list parent --help
	assert_success
	assert_output --partial "analog-attach list parent <compatible>"
}

# Gap: the help of validate, build and deploy has no examples.
# bats test_tags=req:GEN-10, gap
@test "every command's help has examples" {
	local command missing=()
	for command in config init import add read update delete rename list move enable disable validate build \
		deploy completion skill; do
		aa "$command" --help | grep -q "Examples:" || missing+=("$command")
	done
	[ ${#missing[@]} -eq 0 ] || fail "no examples in the help of: ${missing[*]}"
}

# bats test_tags=req:GEN-11
@test "--version prints the version" {
	run aa --version
	assert_success
	assert_output --regexp '^[0-9]+\.[0-9]+\.[0-9]+'
	[ "$output" = "$(jq -r .version "$CLI_DIR/package.json")" ]
}

# --- GEN-12, GEN-13: explaining ----------------------------------------------------------

# Gap: an unknown compatible gives only `Failed to find binding for adi,adxl34`.
# bats test_tags=req:GEN-12, gap
@test "an unknown device points to list devices" {
	with_overlay
	run_json add adi,adxl34
	assert_json '.ok' false
	assert_json '.message | test("adi,adxl345")' true
	assert_json '.message | test("analog-attach list devices")' true
}

# Gap: an unknown node under a known one gives only `Not found: i2c_arm/adi,adxl345@1 (the
# property is a separate argument: <path> <property>)`, naming none of the nodes there.
# bats test_tags=req:GEN-12, gap
@test "an unknown node names the nodes there are" {
	with_accel
	run_json read i2c_arm/adi,adxl345@1
	assert_json '.ok' false
	assert_output --partial "Not found: i2c_arm/adi,adxl345@1"
	assert_output --partial "adi,adxl345@0"
}

# bats test_tags=req:GEN-12
@test "a mistyped command names the closest one" {
	run aa confg
	assert_failure 2
	assert_output --partial "did you mean \`config\`"
	run aa mvoe
	assert_failure 2
	assert_output --partial "did you mean \`move\`"
}

# bats test_tags=req:GEN-12
@test "a missing workfile says how to create it" {
	run aa read
	assert_output --partial "$WORKFILE does not exist"
	assert_output --partial "Run 'analog-attach init' to create it"
}

# bats test_tags=req:GEN-13
@test "a missing Linux tree stops init, naming the setting and how to set it" {
	drop_setting linux
	run aa init
	assert_output --partial "Missing config field linux"
	assert_output --partial "analog-attach config linux <path>"
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:GEN-13
@test "a missing devicetree stops a command, naming the setting and how to set it" {
	with_accel
	drop_setting devicetree
	local before
	before=$(checksum)
	run aa update adxl345 interrupt-parent gpio
	assert_output --partial "Missing config field devicetree"
	assert_output --partial "analog-attach config devicetree"
	[ "$(checksum)" = "$before" ]
}

# bats test_tags=req:GEN-13
@test "a missing workfile setting stops add, saying how to set it" {
	drop_setting workfile
	run aa add adi,adxl345 --parent i2c1
	assert_output --partial "Missing config field workfile"
	assert_output --partial "analog-attach config workfile <name>"
	assert_output --partial "analog-attach init"
	[ ! -e "$WORKFILE" ]
}

# --- GEN-14: naming a device ---------------------------------------------------------------

# bats test_tags=req:GEN-14, req:GEN-14-LNX
@test "a node is taken by its label, its absolute path, or a label followed by a path" {
	with_accel
	local path
	for path in adxl345 i2c1/adi,adxl345@0 i2c_arm/adi,adxl345@0 /soc/i2c@7e804000/adi,adxl345@0; do
		run_json read "$path"
		assert_json '.key' "adi,adxl345@0"
		assert_json '.alias | join(",")' adxl345
	done
	# A base node, by its label and by its path.
	run_json read spi0
	assert_json '.key' "spi@7e204000"
	run_json read /soc/spi@7e204000
	assert_json '.key' "spi@7e204000"
}

# bats test_tags=req:GEN-14, req:GEN-14-LNX
@test "update, rename and delete take the node by each form of target" {
	with_accel
	run_json update /soc/i2c@7e804000/adi,adxl345@0 interrupt-parent gpio
	assert_json '.ok' true
	run_json read adxl345 interrupt-parent
	assert_json '.value' "&gpio"
	run_json rename i2c1/adi,adxl345@0 accel@0
	assert_json '.ok' true
	run_json read i2c_arm/accel@0
	assert_json '.key' "accel@0"
	run_json delete adxl345 --force
	assert_json '.ok' true
	run_json read adxl345
	assert_json '.ok' false
}

# --- GEN-15: saving --------------------------------------------------------------------------

# bats test_tags=req:GEN-15
@test "an edit is in the workfile when the command returns" {
	with_accel
	aa update adxl345 interrupt-parent gpio
	grep -q "interrupt-parent = <&gpio>;" "$WORKFILE"
	aa rename adxl345 accel@0
	grep -q "adxl345: accel@0 {" "$WORKFILE"
	aa delete adxl345 --force
	run grep -c "accel@0" "$WORKFILE"
	assert_output 0
}

# bats test_tags=req:GEN-15
@test "commands that only show change neither the workfile nor the settings" {
	with_accel
	aa config deploy-user pi --global
	local before words
	before=$(checksum)
	for words in "read" "read adxl345" "read adxl345 compatible" "read spi0" "list devices adi,adxl" \
		"list property adxl345" "list value adxl345 interrupt-parent" "list parent adi,adxl345" \
		"list overlay adi,adxl345" "validate" "config" "config overlay-syntax" "update adxl345 compatible" \
		"delete" "--help" "--version"; do
		# shellcheck disable=SC2086
		aa $words >/dev/null 2>&1 </dev/null
		# shellcheck disable=SC2086
		aa --json $words >/dev/null 2>&1 </dev/null
		[ "$(checksum)" = "$before" ] || fail "$words changed a file"
	done
}
