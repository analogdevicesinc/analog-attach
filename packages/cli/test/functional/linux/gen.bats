# General requirements (GEN-*), where the backend is linux.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
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

# Description: the ecosystem is a project setting: the same tool shows the linux backend here
# and the noos backend in a project set to noos.
# Steps:
#   1. Read the backend setting, with --json.
#   2. Check it is linux, from the local settings.
#   3. Run --help and check it names analog-attach and the linux backend.
#   4. Make a second project whose settings name noos, and run --help there.
#   5. Check it succeeds and names the noos backend.
# bats test_tags=req:GEN-01, id:L0120
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

# Description: the help lists the shared commands under their usual names.
# Steps:
#   1. Run --help.
#   2. Check it succeeds and lists config, init, import, add, read, update, delete, rename, list,
#      validate, build, deploy, completion and skill, each with a description.
# bats test_tags=req:GEN-02, id:L0121
@test "the shared commands are there under the same names" {
	run aa --help
	assert_success
	local command
	for command in config init import add read update delete rename list validate build deploy completion skill; do
		assert_output --regexp $'\n'"  $command +[A-Z]"
	done
}

# Description: config, a shared command, sets a setting and answers with ok and a message.
# Steps:
#   1. Set deploy-user to pi with config, with --json.
#   2. Check it succeeds (.ok true) and the message says deploy-user was set to pi.
# bats test_tags=req:GEN-02, id:L0122
@test "a shared command answers in the same form: config sets a setting" {
	run_json config deploy-user pi
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set deploy-user = pi"
}

# --- GEN-03: only the selected ecosystem's commands, flags and settings --------------------

# Description: the help lists the commands of the linux backend and none of noos.
# Steps:
#   1. Run --help.
#   2. Check it succeeds and does not list generate.
#   3. Check it lists move, enable and disable.
# bats test_tags=req:GEN-03, id:L0123
@test "help leaves out the commands of the noos backend" {
	run aa --help
	assert_success
	refute_output --regexp $'\n  generate '
	assert_output --regexp $'\n  move '
	assert_output --regexp $'\n  enable '
	assert_output --regexp $'\n  disable '
}

# Description: completion offers the commands, settings and flags of linux, and none of noos.
# Steps:
#   1. Complete an empty command word.
#   2. Check move is offered and generate is not.
#   3. Complete the setting name of config.
#   4. Check devicetree and overlay-syntax are offered, and no noos setting (capi-path,
#      module-paths, target, probe, bootstrap, project-name).
#   5. Complete the flags of build and deploy; check --json is offered, and noos's --clean
#      (build) and --probe (deploy) are not.
# bats test_tags=req:GEN-03, id:L0124
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
	assert_success
	assert_line --regexp $'^--json\t'
	refute_line --regexp $'^--clean\t'
	run aa __complete -- deploy --
	assert_success
	assert_line --regexp $'^--json\t'
	refute_line --regexp $'^--probe\t'
}

# Description: a noos setting is unknown here: reading it is a usage error, and config does not
# list it.
# Steps:
#   1. Read the capi-path setting with config.
#   2. Check it fails with a usage error (exit 2) saying the field is unknown.
#   3. List the settings with config, with --json.
#   4. Check it succeeds and target is not among them.
# bats test_tags=req:GEN-03, id:L0125
@test "a setting of the noos backend is not a setting here" {
	run aa config capi-path
	assert_failure 2
	assert_output --partial "Unknown config field: capi-path"
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | index("target")' null
}

# Description: a noos command or flag is a usage error here.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Run generate and check it fails with a usage error (exit 2).
#   3. Run build --clean and check it fails with a usage error (exit 2).
# bats test_tags=req:GEN-03, id:L0126
@test "a command of the noos backend is refused" {
	with_accel
	run aa generate
	assert_failure 2
	run aa build --clean
	assert_failure 2
}

# --- GEN-04, GEN-05, GEN-06: questions --------------------------------------------------

# Description: a whole session, from init to deploy and delete, runs with no terminal and asks
# nothing.
# Steps:
#   1. Put a stand-in sshpass on PATH that only logs its arguments.
#   2. Run, each with --json and stdin from /dev/null: init, list devices, list parent, add an
#      ADXL345 on i2c1, list value, update interrupt-parent and interrupts, rename, read,
#      enable and disable spi0, move to i2c3, validate, build, the deploy settings, deploy and
#      delete --force.
#   3. Check each one exits 0 within 60 s and none is refused (.ok not false).
#   4. Check build made overlay.dtbo and deploy called sshpass.
# bats test_tags=req:GEN-04, id:L0127
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
	[ -f "$PROJECT/build/overlay.dtbo" ]
	[ -s "$BATS_TEST_TMPDIR/sshpass.log" ]
}

# Description: with no terminal, add asks no question and says which parent it took and what is
# still missing.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 with no --parent, stdin from /dev/null.
#   3. Check it succeeds and shows neither the parent question nor the property questions.
#   4. Check it says the parent is spi (and --parent chooses another) and that interrupt-parent
#      and interrupts are missing.
# bats test_tags=req:GEN-05, id:L0128
@test "with no terminal, add asks nothing and reports what it would have asked" {
	with_overlay
	run timeout 30 node "$CLI_DIR/dist/cli.js" add adi,adxl345 </dev/null
	assert_success
	refute_output --partial "Where does adi,adxl345 go?"
	refute_output --partial "[1/2]"
	assert_output --partial "Parent: spi (use --parent to choose another)"
	assert_output --partial "Missing required: interrupt-parent, interrupts"
}

# Description: with --json, add asks nothing and lists the missing required properties, with
# suggestions, in the result.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent i2c1, with --json.
#   3. Check it succeeds and missing_required lists interrupt-parent and interrupts.
#   4. Check gpio is among the suggestions for interrupt-parent.
# bats test_tags=req:GEN-05, id:L0129
@test "with --json, add asks nothing and reports what is left in the result" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1
	assert_success
	assert_json '[.missing_required[].property] | join(",")' "interrupt-parent,interrupts"
	assert_json '.missing_required[0].suggestions | map(.value) | index("gpio") != null' true
}

# Description: on a terminal, --json still keeps add from asking questions.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 with --json, on a terminal.
#   3. Check it succeeds, shows no parent question and prints missing_required.
# bats test_tags=req:GEN-05, id:L0130
@test "on a terminal, --json still asks nothing" {
	with_overlay
	tty_run -- --json add adi,adxl345
	assert_success
	refute_output --partial "Where does adi,adxl345 go?"
	assert_output --partial '"missing_required"'
}

# Description: on a terminal, add asks for the parent first, then for the missing required
# properties.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: pick i2c1 (i) for the parent, then Ctrl+C at the
#      interrupt-parent question; check it ends with exit 0.
#   3. Check the parent question was shown, with i2c1 as option i.
#   4. Check the first property question, for interrupt-parent, was shown.
# bats test_tags=req:GEN-05, id:L0131
@test "on a terminal, add asks for the parent, then for what is left" {
	with_overlay
	tty_run "parent [a]:" $'i\r' "interrupt-parent [a]:" $'\x03' -- add adi,adxl345
	assert_success
	assert_output --partial "Where does adi,adxl345 go?"
	assert_output --regexp "i\) i2c1 +/soc/i2c@7e804000"
	assert_output --partial "[1/2] interrupt-parent"
}

# Description: Ctrl+C in the middle of the questions ends add; the answers given before it are
# kept.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: pick i2c1, take the default interrupt-parent with Enter,
#      then Ctrl+C at the first interrupts question.
#   3. Check the command ended (no timeout).
#   4. Read interrupt-parent with --json and check it is &gicv2.
#   5. Read interrupts with --json and check it is not set.
# bats test_tags=req:GEN-06, id:L0132
@test "stopping a question with Ctrl+C ends the command and keeps the answers given" {
	with_overlay
	tty_run "parent [a]:" $'i\r' "interrupt-parent [a]:" $'\r' "interrupts 1/3" $'\x03' -- add adi,adxl345
	[ "$status" -ne 124 ] || fail "the command didn't end: $output"
	run_json read adxl345 interrupt-parent
	assert_json '.value' "&gicv2"
	run_json read adxl345 interrupts
	assert_json '.value' null
}

# Description: Ctrl+C at the first question ends add with nothing added.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 on a terminal and press Ctrl+C at the parent question.
#   3. Check it exits 130 and says nothing was added.
#   4. Check the workfile is unchanged.
# bats test_tags=req:GEN-06, id:L0133
@test "stopping the first question with Ctrl+C ends add, adding nothing" {
	with_overlay
	snapshot
	tty_run "parent [a]:" $'\x03' -- add adi,adxl345
	assert_failure 130
	assert_output --partial "nothing added"
	assert_unchanged
}

# --- GEN-07, GEN-08, GEN-17: JSON results ------------------------------------------------

# Description: --json works at any position on the command line.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Run config overlay-syntax, read adxl345 and list devices with --json before, in the middle
#      of and after the other words.
#   3. Check each exits 0 and prints exactly one line holding a JSON object.
# bats test_tags=req:GEN-07, id:L0134
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

# Description: every command prints exactly one JSON object with --json.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Run, with --json: init, config, add, update, read, rename, each list kind, enable,
#      disable, move, validate, build, delete, import and completion.
#   3. Check each exits 0 and prints exactly one line holding a JSON object.
# bats test_tags=req:GEN-07, id:L0135
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

# Description: a result longer than 64 KiB reaches a pipe whole, in JSON and as text.
# Steps:
#   1. Create the overlay with init.
#   2. Pipe list devices, with --json, to jq.
#   3. Check it parses and has more than 1000 devices.
#   4. Pipe list devices, as text, to wc -l and check it gives more than 1000 lines.
# bats test_tags=req:GEN-07, id:L0136
@test "a long JSON result reaches a pipe whole" {
	with_overlay
	run bash -c "node '$CLI_DIR/dist/cli.js' --json list devices | jq -e '.devices | length > 1000'"
	assert_success
	run bash -c "node '$CLI_DIR/dist/cli.js' list devices | wc -l"
	[ "$output" -gt 1000 ] || fail "list devices gave $output lines"
}

# Description: a JSON result has ok, severity and a message, for a success, a refusal and a
# warning alike.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Update its interrupt-parent to gpio, with --json; check .ok true, severity info and a
#      message.
#   3. Read a node that does not exist, with --json; check it succeeds with .ok false, severity
#      error and a message.
#   4. Run delete with no target, with --json; check .ok true and severity warn.
# bats test_tags=req:GEN-08, id:L0137
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

# Description: read, update when it only reads, and validate also answer with ok, message and
# severity.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Run read, read adxl345, read adxl345 compatible, update adxl345 compatible and validate,
#      each with --json.
#   3. Check each result has ok, message and severity.
# bats test_tags=req:GEN-08, id:L0138
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

# Description: a refusal carries an error type.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Add an unknown compatible, with --json.
#   3. Check it is refused (.ok false) with the error type unknown-device-type.
# bats test_tags=req:GEN-17, id:L0139
@test "an error carries a type from the fixed list" {
	with_accel
	run_json add adi,nosuchdevice
	assert_json '.ok' false
	assert_json '.error_type' unknown-device-type
}

# --- GEN-09: exit status -----------------------------------------------------------------

# Description: a refusal exits 0 and the outcome is in the result.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Read a node that does not exist, with --json; check it exits 0 with .ok false.
#   3. Add an unknown compatible; check it exits 0.
#   4. Delete a node that does not exist with --force, with --json; check it exits 0 with .ok
#      false.
# bats test_tags=req:GEN-09, id:L0140
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

# Description: a usage error exits non-zero.
# Steps:
#   1. Run an unknown command, config with an unknown flag, read with an unknown flag, and move
#      with no destination.
#   2. Check each fails with a usage error (exit 2).
# bats test_tags=req:GEN-09, id:L0141
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

# Description: a setting value that is refused exits 0, with .ok false in the result.
# Steps:
#   1. Set overlay-syntax to braces, with --json.
#   2. Check it is refused (exit 0, .ok false).
#   3. Set linux to a folder that is not a Linux tree, with --json.
#   4. Check it is refused (exit 0, .ok false).
# bats test_tags=req:GEN-09, id:L0142
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
# Description: an unknown setting is a usage error even with --json: exit 2, nothing on
# standard output, the reason on standard error.
# Steps:
#   1. Read the setting nosuchkey with config, with --json.
#   2. Check it fails with a usage error (exit 2).
#   3. Check standard output is empty and standard error says the field is unknown.
# bats test_tags=req:GEN-09, id:L0143
@test "an unknown setting is a usage error: non-zero, the reason on stderr" {
	run_json config nosuchkey
	assert_failure 2
	[ -z "$output" ]
	[[ "$stderr" == *"Unknown config field: nosuchkey"* ]]
}

# Description: a missing setting exits 0, with and without --json, and the result names it.
# Steps:
#   1. Remove the linux setting.
#   2. Run read and check it exits 0.
#   3. Run read with --json and check it is refused (exit 0, .ok false), the message naming
#      linux.
# bats test_tags=req:GEN-09, id:L0144
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

# Description: --help lists the commands.
# Steps:
#   1. Run --help.
#   2. Check it succeeds and has a COMMANDS section listing add, move and config with their
#      descriptions.
# bats test_tags=req:GEN-10, id:L0145
@test "--help lists the commands" {
	run aa --help
	assert_success
	assert_output --partial "COMMANDS"
	assert_output --regexp $'\n  add +Add'
	assert_output --regexp $'\n  move +Move'
	assert_output --regexp $'\n  config +Show'
}

# Description: a command's help shows its usage, arguments and flags.
# Steps:
#   1. Run add --help.
#   2. Check it succeeds and shows the usage, ARGUMENTS and FLAGS, with --parent and --template.
#   3. Run list parent --help and check it shows the usage with <compatible>.
# bats test_tags=req:GEN-10, id:L0146
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

# Description: the help of every command has examples.
# Steps:
#   1. Run --help of each command: config, init, import, add, read, update, delete, rename, list,
#      move, enable, disable, validate, build, deploy, completion and skill.
#   2. Check each one has an Examples section.
# bats test_tags=req:GEN-10, id:L0147
@test "every command's help has examples" {
	local command missing=()
	for command in config init import add read update delete rename list move enable disable validate build \
		deploy completion skill; do
		aa "$command" --help | grep -q "Examples:" || missing+=("$command")
	done
	[ ${#missing[@]} -eq 0 ] || fail "no examples in the help of: ${missing[*]}"
}

# Description: --version prints the version of the CLI package.
# Steps:
#   1. Run --version.
#   2. Check it succeeds and prints a version number equal to the one in package.json.
# bats test_tags=req:GEN-11, id:L0148
@test "--version prints the version" {
	run aa --version
	assert_success
	assert_output --regexp '^[0-9]+\.[0-9]+\.[0-9]+'
	[ "$output" = "$(jq -r .version "$CLI_DIR/package.json")" ]
}

# --- GEN-12, GEN-13: explaining ----------------------------------------------------------

# Description: an unknown compatible is refused with the closest compatibles and a pointer to
# list devices.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl34, with --json.
#   3. Check it is refused (.ok false) and the message names adi,adxl345 and list devices.
# bats test_tags=req:GEN-12, id:L0149
@test "an unknown device points to list devices" {
	with_overlay
	run_json add adi,adxl34
	assert_json '.ok' false
	assert_json '.message | test("adi,adxl345")' true
	assert_json '.message | test("analog-attach list devices")' true
}

# Description: an unknown node under a known one is refused, naming the nodes that are there.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Read i2c_arm/adi,adxl345@1, with --json.
#   3. Check it is refused (.ok false), saying it was not found and naming adi,adxl345@0.
# bats test_tags=req:GEN-12, id:L0150
@test "an unknown node names the nodes there are" {
	with_accel
	run_json read i2c_arm/adi,adxl345@1
	assert_json '.ok' false
	assert_output --partial "Not found: i2c_arm/adi,adxl345@1"
	assert_output --partial "adi,adxl345@0"
}

# Description: a mistyped command is a usage error that names the closest command.
# Steps:
#   1. Run confg; check it fails with a usage error (exit 2) suggesting config.
#   2. Run mvoe; check it fails with a usage error (exit 2) suggesting move.
# bats test_tags=req:GEN-12, id:L0151
@test "a mistyped command names the closest one" {
	run aa confg
	assert_failure 2
	assert_output --partial "did you mean \`config\`"
	run aa mvoe
	assert_failure 2
	assert_output --partial "did you mean \`move\`"
}

# Description: a command with no workfile says the workfile does not exist and how to create it.
# Steps:
#   1. Run read before any init.
#   2. Check the message says the workfile does not exist and to run init.
# bats test_tags=req:GEN-12, id:L0152
@test "a missing workfile says how to create it" {
	run aa read
	assert_output --partial "$WORKFILE does not exist"
	assert_output --partial "Run 'analog-attach init' to create it"
}

# Description: init with no linux setting stops, naming the setting and how to set it, and
# creates no workfile.
# Steps:
#   1. Remove the linux setting.
#   2. Run init.
#   3. Check the message says the linux setting is missing and shows config linux <path>.
#   4. Check no workfile was created.
# bats test_tags=req:GEN-13, id:L0153
@test "a missing Linux tree stops init, naming the setting and how to set it" {
	drop_setting linux
	run aa init
	assert_output --partial "Missing config field linux"
	assert_output --partial "analog-attach config linux <path>"
	[ ! -e "$WORKFILE" ]
}

# Description: a command with no devicetree setting stops, naming the setting and how to set it,
# and changes no file.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1 and remove the devicetree setting.
#   2. Take a checksum of the workfile and the settings files.
#   3. Update adxl345 interrupt-parent to gpio.
#   4. Check the message says devicetree is missing and shows config devicetree.
#   5. Check no file changed.
# bats test_tags=req:GEN-13, id:L0154
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

# Description: add with no workfile setting stops, saying how to set it, and creates no workfile.
# Steps:
#   1. Remove the workfile setting.
#   2. Add adi,adxl345 --parent i2c1.
#   3. Check the message says workfile is missing and points to config workfile <name> and init.
#   4. Check no workfile was created.
# bats test_tags=req:GEN-13, id:L0155
@test "a missing workfile setting stops add, saying how to set it" {
	drop_setting workfile
	run aa add adi,adxl345 --parent i2c1
	assert_output --partial "Missing config field workfile"
	assert_output --partial "analog-attach config workfile <name>"
	assert_output --partial "analog-attach init"
	[ ! -e "$WORKFILE" ]
}

# --- GEN-14: naming a device ---------------------------------------------------------------

# Description: a node can be named by its label, its absolute path, or a label followed by a path,
# for overlay and base nodes.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Read it, with --json, as adxl345, i2c1/adi,adxl345@0, i2c_arm/adi,adxl345@0 and
#      /soc/i2c@7e804000/adi,adxl345@0.
#   3. Check each gives the node adi,adxl345@0 with the label adxl345.
#   4. Read spi0 and /soc/spi@7e204000, with --json, and check both give spi@7e204000.
# bats test_tags=req:GEN-14, req:GEN-14-LNX, id:L0156
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

# Description: update, rename and delete find the node by its absolute path, a label with a
# path, and its label.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Update interrupt-parent to gpio by the absolute path; check .ok true and that read gives
#      &gpio.
#   3. Rename it to accel@0 by i2c1/adi,adxl345@0; check .ok true and that i2c_arm/accel@0
#      reads.
#   4. Delete it by the label with --force; check .ok true and that read is refused.
# bats test_tags=req:GEN-14, req:GEN-14-LNX, id:L0157
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

# Description: each edit is written to the workfile by the time the command returns.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1.
#   2. Update interrupt-parent to gpio and check the workfile has it.
#   3. Rename the node to accel@0 and check the workfile has the new name with the label.
#   4. Delete it with --force and check the workfile no longer has accel@0.
# bats test_tags=req:GEN-15, id:L0158
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

# Description: commands that only show something change neither the workfile nor the settings.
# Steps:
#   1. Make an overlay with an ADXL345 on i2c1 and set a global deploy-user.
#   2. Take a checksum of the workfile and both settings files.
#   3. Run read, list, validate, config reads, update with no value, delete with no target,
#      --help and --version, each as text and with --json.
#   4. Check the checksum is unchanged after each.
# bats test_tags=req:GEN-15, id:L0159
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
