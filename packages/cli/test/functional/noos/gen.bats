# General requirements (GEN-*), where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet.
# checksum digests the workfile and both settings files, to tell whether any changed.
setup() {
	load ../helpers
	new_project noos
}

# `checksum`: a digest of the workfile and both settings files, to tell whether any changed.
checksum() {
	cat "$PROJECT/workfile.json" "$PROJECT/.analog-attach/config.json" \
		"$HOME/.config/analog-attach/config.json" 2>/dev/null | sha256sum
}

# --- GEN-01, GEN-02: one tool, the same commands -------------------------------------------

# Description: the ecosystem is a project setting, and the same tool takes the backend of
# whichever project it runs in.
# Steps:
#   1. Show the backend setting, with --json; check it is noos, from the project settings.
#   2. Run --help; check it succeeds and says the backend is noos.
#   3. Make another project whose settings name the linux backend, and go there.
#   4. Run --help; check it succeeds and says the backend is linux.
# bats test_tags=req:GEN-01, id:N0097
@test "one tool: the ecosystem is a setting of the project" {
	run_json config backend
	assert_success
	assert_json '.configs[0].value' noos
	assert_json '.configs[0].source' local
	run aa --help
	assert_success
	assert_output --partial "analog-attach"
	assert_output --partial "Backend: noos"
	# The same tool, in a project whose setting names the other ecosystem.
	mkdir -p "$BATS_TEST_TMPDIR/other/.analog-attach"
	echo '{"backend": "linux"}' >"$BATS_TEST_TMPDIR/other/.analog-attach/config.json"
	cd "$BATS_TEST_TMPDIR/other"
	run aa --help
	assert_success
	assert_output --partial "Backend: linux"
}

# Description: the help lists each shared command under its usual name.
# Steps:
#   1. Run --help.
#   2. Check it succeeds and lists config, init, import, add, read, update, delete, rename, list,
#      validate, build, deploy, completion and skill.
# bats test_tags=req:GEN-02, id:N0098
@test "the shared commands are there under the same names" {
	run aa --help
	assert_success
	local command
	for command in config init import add read update delete rename list validate build deploy completion skill; do
		assert_output --regexp $'\n'"  $command +[A-Z]"
	done
}

# Description: a shared command gives the usual result; here config sets a setting.
# Steps:
#   1. Set probe to jlink with config, with --json.
#   2. Check it succeeds (.ok true), the message saying probe is set to jlink.
# bats test_tags=req:GEN-02, id:N0099
@test "a shared command answers in the same form: config sets a setting" {
	run_json config probe jlink
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set probe = jlink"
}

# --- GEN-03: only the selected ecosystem's commands, flags and settings --------------------

# Description: the help leaves out the commands of the linux backend, and shows noos's own.
# Steps:
#   1. Run --help.
#   2. Check it succeeds, lists no move, enable or disable, and lists generate.
# bats test_tags=req:GEN-03, id:N0100
@test "help leaves out the commands of the linux backend" {
	run aa --help
	assert_success
	refute_output --regexp $'\n  (move|enable|disable) '
	assert_output --regexp $'\n  generate '
}

# Description: completion offers only the commands and settings of noos.
# Steps:
#   1. Complete an empty command word; check it offers generate, and not move, enable or disable.
#   2. Complete config with an empty word; check it offers capi-path and probe, and none of the
#      linux settings (linux, devicetree, overlay-syntax, preprocess-command, deploy-ip).
# bats test_tags=req:GEN-03, id:N0101
@test "completion offers only the commands and settings of noos" {
	run aa __complete -- ""
	assert_success
	assert_line --regexp $'^generate\t'
	refute_line --regexp $'^(move|enable|disable)\t'
	run aa __complete -- config ""
	assert_success
	assert_line --regexp $'^capi-path\t'
	assert_line --regexp $'^probe\t'
	refute_line --regexp $'^(linux|devicetree|overlay-syntax|preprocess-command|deploy-ip)\t'
}

# Description: a setting of the linux backend is unknown here, and config doesn't list it.
# Steps:
#   1. Show config overlay-syntax.
#   2. Check it fails with a usage error (exit 2), calling the setting unknown.
#   3. List all settings with config, with --json; check devicetree is not among them.
# bats test_tags=req:GEN-03, id:N0102
@test "a setting of the linux backend is not a setting here" {
	run aa config overlay-syntax
	assert_failure 2
	assert_output --partial "Unknown config field: overlay-syntax"
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | index("devicetree")' null
}

# Description: a command of the linux backend is not a command here.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Run move testpart_cs_gpio testpart.
#   3. Check it fails with a usage error (exit 2), saying there is no command move.
# bats test_tags=req:GEN-03, id:N0103
@test "a command of the linux backend is refused" {
	with_sensor
	run aa move testpart_cs_gpio testpart
	assert_failure 2
	assert_output --partial 'No command registered for `move`'
}

# --- GEN-04, GEN-05, GEN-06: questions --------------------------------------------------

# Description: with no terminal and interview on, a whole session of commands runs without
# asking anything.
# Steps:
#   1. Reset interview to its default (on).
#   2. Run, with --json, stdin from /dev/null and a 30 s timeout: init, add testpart, two
#      updates of testpart_spi_dev, rename it to spi0, list devices, read spi0, validate,
#      generate, and delete spi0 --force.
#   3. Check each one exits 0 and is not refused.
# bats test_tags=req:GEN-04, id:N0104
@test "a whole session runs without a question, with no terminal" {
	aa config interview --reset >/dev/null # on: it must still ask nothing off a terminal
	local step
	for step in "init" "add testpart" "update testpart_spi_dev controller bsp_test_spi_cfg_handle" \
		"update testpart_spi_dev native_cs 1" "rename testpart_spi_dev spi0" "list devices" \
		"read spi0" "validate" "generate" "delete spi0 --force"; do
		# shellcheck disable=SC2086
		run --separate-stderr timeout 30 node "$CLI_DIR/dist/cli.js" --json $step </dev/null
		[ "$status" -eq 0 ] || fail "$step: exit $status: $output $stderr"
		[ "$(jq -r '.ok // "none"' <<<"$output")" != false ] || fail "$step refused: $output"
	done
}

# Description: with no terminal, add asks nothing and reports the values it would have asked
# for, with their choices.
# Steps:
#   1. Reset interview to its default (on) and create the workfile with init.
#   2. Run add testpart with stdin from /dev/null and a 30 s timeout.
#   3. Check it succeeds, shows no interview, and names testpart_spi_dev.controller and the
#      choice bsp_test_spi2_cfg_handle.
# bats test_tags=req:GEN-05, id:N0105
@test "with no terminal, add asks nothing and reports what it would have asked" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	run timeout 30 node "$CLI_DIR/dist/cli.js" add testpart </dev/null
	assert_success
	refute_output --partial "only you can tell"
	assert_output --partial "testpart_spi_dev.controller"
	assert_output --partial "bsp_test_spi2_cfg_handle"
}

# Description: with --json, add asks nothing and puts what is left, with suggestions, in the
# result.
# Steps:
#   1. Reset interview to its default (on) and create the workfile with init.
#   2. Add testpart, with --json.
#   3. Check it succeeds, with the missing controller offering 2 suggestions.
# bats test_tags=req:GEN-05, id:N0106
@test "with --json, add asks nothing and reports what is left in the result" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	run_json add testpart
	assert_success
	assert_json '[.missing_required[] | select(.property == "controller")] | .[0].suggestions | length' 2
}

# Description: on a terminal, --json still asks nothing.
# Steps:
#   1. Reset interview to its default (on) and create the workfile with init.
#   2. Run --json add testpart on a terminal.
#   3. Check it succeeds, shows no interview, and prints a result with missing_required.
# bats test_tags=req:GEN-05, id:N0107
@test "on a terminal, --json still asks nothing" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	tty_run -- --json add testpart
	assert_success
	refute_output --partial "only you can tell"
	assert_output --partial '"missing_required"'
}

# Description: on a terminal, add asks for the values left.
# Steps:
#   1. Reset interview to its default (on) and create the workfile with init.
#   2. Run add testpart on a terminal, and press Ctrl-C at the first question.
#   3. Check the screen asked to pick testpart_spi_dev.controller.
# bats test_tags=req:GEN-05, id:N0108
@test "on a terminal, add asks for what is left" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	tty_run "pick one" $'\x03' -- add testpart
	assert_output --partial "testpart_spi_dev.controller: pick one"
}

# Description: Ctrl-C at a question ends the command, and the answers given before are kept.
# Steps:
#   1. Reset interview to its default (on) and create the workfile with init.
#   2. Run add testpart on a terminal; pick the first controller, then press Ctrl-C at native_cs.
#   3. Check it says it stopped.
#   4. Read testpart_spi_dev controller, with --json; check it is bsp_test_spi_cfg_handle.
# bats test_tags=req:GEN-06, id:N0109
@test "stopping a question with Ctrl+C ends the command and keeps the answers given" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	tty_run "pick one" $'\r' "native_cs (number)" $'\x03' -- add testpart
	assert_output --partial "Stopped."
	run_json read testpart_spi_dev controller
	assert_json '.value' bsp_test_spi_cfg_handle
}

# --- GEN-07, GEN-08, GEN-17: JSON results ------------------------------------------------

# Description: --json works wherever it is on the command line.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Run config probe, read testpart and list devices with --json first, in the middle and
#      last.
#   3. Check each exits 0 and prints one line, a JSON object.
# bats test_tags=req:GEN-07, id:N0110
@test "--json is taken anywhere on the command line" {
	with_sensor
	local words
	for words in "--json config probe" "config --json probe" "config probe --json" \
		"--json read testpart" "read testpart --json" "list --json devices" "list devices --json"; do
		# shellcheck disable=SC2086
		run --separate-stderr aa $words
		[ "$status" -eq 0 ] || fail "$words: exit $status"
		[ "${#lines[@]}" -eq 1 ] || fail "$words: not one line: $output"
		jq -e 'type == "object"' <<<"$output" >/dev/null || fail "$words: not a JSON object: $output"
	done
}

# Description: every command prints a single JSON result with --json, a refusal too.
# Steps:
#   1. Run, with --json, in a project with no workfile: init (creating it), then add
#      eval-testpart, add, read, update (set and show), rename, delete --force, list devices,
#      context, property and value, validate, config, config --reload, generate, build and deploy
#      (both refused on the fixtures), skill install and uninstall, and completion bash.
#   2. Check each exits 0 and prints one line, a JSON object.
# bats test_tags=req:GEN-07, id:N0111
@test "every command prints one JSON result with --json" {
	local words
	for words in "init" "add eval-testpart" "add testpart --name tp2" "read" "read testpart_ip" \
		"update testpart_spi_dev max_speed_hz 2000000" "update testpart_spi_dev max_speed_hz" "rename tp2 tp3" \
		"delete tp3 --force" "list devices" "list context" "list property testpart_ip" \
		"list value testpart_ip comm_init" "validate" "config" "config --reload" "generate" "build" "deploy" \
		"skill install analog-attach-noos" "skill uninstall analog-attach-noos" "completion bash"; do
		# shellcheck disable=SC2086
		run --separate-stderr aa --json $words
		[ "$status" -eq 0 ] || fail "$words: exit $status: $stderr"
		[ "${#lines[@]}" -eq 1 ] || fail "$words: not one line: $output"
		jq -e 'type == "object"' <<<"$output" >/dev/null || fail "$words: not a JSON object: $output"
	done
}

# Description: a JSON result carries ok, a message and a severity, for a success, a refusal
# and a warning alike.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Update testpart_spi_dev max_speed_hz, with --json; check .ok true, severity info and a
#      message.
#   3. Add an unknown device, with --json; check it exits 0 with .ok false, severity error and
#      a message.
#   4. Delete testpart_cs_gpio without --force, with --json; check .ok true and severity warn.
# bats test_tags=req:GEN-08, id:N0112
@test "a JSON result says ok, with a message and a severity" {
	with_sensor
	run_json update testpart_spi_dev max_speed_hz 2000000
	assert_json '.ok' true
	assert_json '.severity' info
	assert_json '.message | length > 0' true
	# A refusal: the same structure.
	run_json add nosuchdevice
	assert_success
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | length > 0' true
	# A warning.
	run_json delete testpart_cs_gpio
	assert_json '.ok' true
	assert_json '.severity' warn
}

# Description: every error and warning carries an error type from the fixed list: refusals,
# a warning of a success, and each finding of validate.
# Steps:
#   1. Read, with --json, before any init; check the type is workfile-missing.
#   2. Create the workfile and add the eval-testpart board.
#   3. With --json: add an unknown device, read an unknown node, update a number with abc, set
#      an unknown target, rename to an invalid name, install an unknown skill.
#   4. Check each is refused with its type: unknown-device-type, not-found, invalid-value,
#      invalid-setting, invalid-name, unknown-choice.
#   5. Delete a referenced device without --force; check the warning's type is needs-force.
#   6. Clear a required property and validate; check its finding's type is missing-required.
# bats test_tags=req:GEN-17, id:N0113
@test "an error carries a type from the fixed list" {
	run_json read
	assert_json '.error_type' workfile-missing
	with_sensor
	local pair words type
	for pair in "add nosuchdevice=unknown-device-type" "read nosuch=not-found" \
		"update testpart_spi_dev max_speed_hz abc=invalid-value" "config target nosuchboard=invalid-setting" \
		"rename testpart_ip 1bad=invalid-name" "skill install nosuch=unknown-choice"; do
		words=${pair%=*} type=${pair##*=}
		# shellcheck disable=SC2086
		run --separate-stderr aa --json $words
		jq -e --arg type "$type" '.ok == false and .error_type == $type' <<<"$output" >/dev/null ||
			fail "$words: expected a refusal of type $type, got: $output"
	done
	run_json delete testpart_spi_dev
	assert_json '.severity' warn
	assert_json '.error_type' needs-force
	aa delete testpart_ip comm_init >/dev/null
	run_json validate
	assert_json '[.errors[] | .error_type] | unique | join(",")' missing-required
}

# --- GEN-09: exit status -----------------------------------------------------------------

# Description: a refusal exits 0, with the outcome in the result.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Read an unknown node, with --json; check it exits 0 with .ok false.
#   3. Add an unknown device without --json; check it exits 0.
# bats test_tags=req:GEN-09, id:N0114
@test "a refusal exits 0, the outcome in the result" {
	with_sensor
	run_json read nosuchnode
	assert_success
	assert_json '.ok' false
	run aa add nosuchdevice
	assert_success
}

# Description: a usage error exits non-zero.
# Steps:
#   1. Run an unknown command; check it fails with a usage error (exit 2).
#   2. Run config --reset without a setting; check it fails with exit 2.
#   3. Run read with an unknown flag; check it fails with exit 2.
# bats test_tags=req:GEN-09, id:N0115
@test "a usage error exits non-zero" {
	run aa nosuchcommand
	assert_failure 2
	run aa config --reset
	assert_failure 2
	run aa read --nosuchflag
	assert_failure 2
}

# Description: a refused setting value exits 0, with .ok false.
# Steps:
#   1. Set bootstrap to yes with config, with --json.
#   2. Check it is refused (exit 0, .ok false).
# bats test_tags=req:GEN-09, id:N0116
@test "a refused setting value exits 0 with ok false" {
	run_json config bootstrap yes
	assert_success
	assert_json '.ok' false
}

# An unknown setting is a usage error: the one case, with a bad argument, where the exit status
# isn't 0.
# Description: an unknown setting is a usage error: it exits non-zero, with the reason on
# stderr and no result.
# Steps:
#   1. Show config nosuchkey, with --json.
#   2. Check it fails with a usage error (exit 2), printing nothing on stdout.
#   3. Check stderr calls the setting unknown.
# bats test_tags=req:GEN-09, id:N0117
@test "an unknown setting is a usage error: non-zero, the reason on stderr" {
	run_json config nosuchkey
	assert_failure 2
	[ -z "$output" ]
	[[ "$stderr" == *"Unknown config field: nosuchkey"* ]]
}

# --- GEN-10, GEN-11: help and version ----------------------------------------------------

# Description: --help lists the commands, each with its summary.
# Steps:
#   1. Run --help.
#   2. Check it succeeds, with a COMMANDS section listing add and config.
# bats test_tags=req:GEN-10, id:N0118
@test "--help lists the commands" {
	run aa --help
	assert_success
	assert_output --partial "COMMANDS"
	assert_output --regexp $'\n  add +Add'
	assert_output --regexp $'\n  config +Show'
}

# Description: a command's help describes its arguments and flags.
# Steps:
#   1. Run update --help.
#   2. Check it succeeds, naming the command and showing ARGUMENTS and FLAGS, --suggest among
#      them.
# bats test_tags=req:GEN-10, id:N0119
@test "<command> --help describes the command, its arguments and flags" {
	run aa update --help
	assert_success
	assert_output --partial "analog-attach update"
	assert_output --partial "ARGUMENTS"
	assert_output --partial "FLAGS"
	assert_output --partial "--suggest"
}

# Description: every command's help has examples.
# Steps:
#   1. Run --help for each command: config, init, import, add, read, update, delete, rename,
#      list, validate, build, deploy, generate, completion and skill.
#   2. Check each help has an Examples section.
# bats test_tags=req:GEN-10, id:N0120
@test "every command's help has examples" {
	local command missing=()
	for command in config init import add read update delete rename list validate build deploy generate completion skill; do
		aa "$command" --help | grep -q "Examples:" || missing+=("$command")
	done
	[ ${#missing[@]} -eq 0 ] || fail "no examples in the help of: ${missing[*]}"
}

# Description: --version prints the CLI's version.
# Steps:
#   1. Run --version.
#   2. Check it succeeds and prints a version number, the one in the CLI's package.json.
# bats test_tags=req:GEN-11, id:N0121
@test "--version prints the version" {
	run aa --version
	assert_success
	assert_output --regexp '^[0-9]+\.[0-9]+\.[0-9]+'
	[ "$output" = "$(jq -r .version "$CLI_DIR/package.json")" ]
}

# --- GEN-12, GEN-13: explaining ----------------------------------------------------------

# Description: an unknown device is refused, with the closest key and a pointer to list devices.
# Steps:
#   1. Create the workfile with init.
#   2. Add a mistyped device (eval-testprt), with --json.
#   3. Check it is refused (.ok false), suggesting eval-testpart and pointing to list devices.
# bats test_tags=req:GEN-12, id:N0122
@test "an unknown device points to list devices" {
	aa init >/dev/null
	run_json add eval-testprt
	assert_json '.ok' false
	assert_json '.message' "Unknown schema 'eval-testprt'. Did you mean eval-testpart? See: analog-attach list devices"
}

# Description: an unknown node is refused, and the message names the nodes there are.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Read a mistyped node (testpart_spi), with --json.
#   3. Check it is refused (.ok false), saying the node is not found and naming testpart_spi_dev.
# bats test_tags=req:GEN-12, id:N0123
@test "an unknown node names the nodes there are" {
	with_sensor
	run_json read testpart_spi
	assert_json '.ok' false
	assert_output --partial "Node 'testpart_spi' not found"
	assert_output --partial "testpart_spi_dev"
}

# Description: a mistyped command is a usage error that names the closest command.
# Steps:
#   1. Run confg.
#   2. Check it fails with a usage error (exit 2), asking whether config was meant.
# bats test_tags=req:GEN-12, id:N0124
@test "a mistyped command names the closest one" {
	run aa confg
	assert_failure 2
	assert_output --partial "did you mean \`config\`"
}

# Description: a missing workfile is refused, saying to create one with init.
# Steps:
#   1. Run read, with --json, before any init.
#   2. Check it is refused (.ok false), pointing to init.
# bats test_tags=req:GEN-12, id:N0125
@test "a missing workfile says how to create it" {
	run_json read
	assert_json '.ok' false
	assert_output --partial "Create one with 'analog-attach init'"
}

# Description: init without a target is refused, naming the setting and the command to set it,
# and creates no workfile.
# Steps:
#   1. Reset the target setting.
#   2. Run init, with --json.
#   3. Check it is refused (exit 0, .ok false), pointing to config target.
#   4. Check there is no workfile.
# bats test_tags=req:GEN-13, id:N0126
@test "a missing target stops init, naming the setting and how to set it" {
	aa config target --reset >/dev/null
	run_json init
	assert_success
	assert_json '.ok' false
	assert_output --partial "analog-attach config target"
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: a command needing capi-path is refused when it is not set, naming the setting
# and how to set it, and changes no file.
# Steps:
#   1. Create the workfile, add the eval-testpart board, then reset capi-path.
#   2. Take a checksum of the workfile and the settings files.
#   3. Run validate, with --json.
#   4. Check it is refused (exit 0, .ok false), saying capi-path is not configured and how to
#      set it.
#   5. Check no file changed.
# bats test_tags=req:GEN-13, id:N0127
@test "a missing capi-path stops a command, naming the setting and how to set it" {
	with_sensor
	aa config capi-path --reset >/dev/null
	local before
	before=$(checksum)
	run_json validate
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'Setting "capi-path" is not configured. Run: analog-attach config capi-path <value>'
	[ "$(checksum)" = "$before" ]
}

# Description: init without capi-path is refused, saying how to set it, and creates no workfile.
# Steps:
#   1. Reset capi-path.
#   2. Run init, with --json.
#   3. Check it is refused (.ok false) and there is no workfile.
#   4. Check the message points to config capi-path.
# bats test_tags=req:GEN-13, id:N0128
@test "a missing capi-path stops init, saying how to set it" {
	aa config capi-path --reset >/dev/null
	run_json init
	assert_json '.ok' false
	[ ! -e "$PROJECT/workfile.json" ]
	assert_output --partial "config capi-path"
}

# --- GEN-14: naming a device ---------------------------------------------------------------

# Description: read, update, rename and delete find a device by its name.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Read testpart_spi_dev, with --json; check the result is that node.
#   3. Update its max_speed_hz to 2000000, then read it back; check the value.
#   4. Rename testpart_cs_gpio to cs0, then delete cs0 --force; check both succeed.
#   5. Read cs0; check it is refused (.ok false).
# bats test_tags=req:GEN-14, req:GEN-14-CAPI, id:N0129
@test "read, update, rename and delete take the device by its name" {
	with_sensor
	run_json read testpart_spi_dev
	assert_json '.key' testpart_spi_dev
	run_json update testpart_spi_dev max_speed_hz 2000000
	assert_json '.ok' true
	run_json read testpart_spi_dev max_speed_hz
	assert_json '.value' 2000000
	run_json rename testpart_cs_gpio cs0
	assert_json '.ok' true
	run_json delete cs0 --force
	assert_json '.ok' true
	run_json read cs0
	assert_json '.ok' false
}

# Description: a device is named by its name, not by a path.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Read /testpart_spi_dev, with --json.
#   3. Check it is refused (.ok false).
# bats test_tags=req:GEN-14-CAPI, id:N0130
@test "a target is a name, not a path" {
	with_sensor
	run_json read /testpart_spi_dev
	assert_json '.ok' false
}

# --- GEN-15: saving --------------------------------------------------------------------------

# Description: each edit is saved in the workfile by the time the command returns.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Update testpart_spi_dev max_speed_hz to 2000000; check the workfile has the new value.
#   3. Rename testpart_cs_gpio to cs0; check the workfile has cs0 and not the old name.
#   4. Delete cs0 --force; check the workfile no longer has cs0.
# bats test_tags=req:GEN-15, id:N0131
@test "an edit is in the workfile when the command returns" {
	with_sensor
	aa update testpart_spi_dev max_speed_hz 2000000
	[ "$(jq '.symbols.testpart_spi_dev.max_speed_hz' "$PROJECT/workfile.json")" = 2000000 ]
	aa rename testpart_cs_gpio cs0
	jq -e '.symbols | has("cs0") and (has("testpart_cs_gpio") | not)' "$PROJECT/workfile.json" >/dev/null
	aa delete cs0 --force
	jq -e '.symbols | has("cs0") | not' "$PROJECT/workfile.json" >/dev/null
}

# Description: the commands that only show something change neither the workfile nor the
# settings files.
# Steps:
#   1. Create the workfile, add the eval-testpart board, and set probe to jlink in the user
#      settings.
#   2. Take a checksum of the workfile and the settings files.
#   3. Run, without and with --json and with no terminal: read (whole, a node, a property),
#      list devices, list context, validate, config, config probe, update without a value,
#      update --suggest, delete without --force, --help and --version.
#   4. Check no file changed after each.
# bats test_tags=req:GEN-15, id:N0132
@test "commands that only show change neither the workfile nor the settings" {
	with_sensor
	aa config probe jlink --global
	local before words
	before=$(checksum)
	for words in "read" "read testpart_spi_dev" "read testpart_spi_dev max_speed_hz" "list devices" \
		"list context" "validate" "config" "config probe" "update testpart_spi_dev max_speed_hz" \
		"update testpart_spi_dev mode --suggest" "delete testpart_cs_gpio" "--help" "--version"; do
		# shellcheck disable=SC2086
		aa $words >/dev/null 2>&1 </dev/null
		# shellcheck disable=SC2086
		aa --json $words >/dev/null 2>&1 </dev/null
		[ "$(checksum)" = "$before" ] || fail "$words changed a file"
	done
}
