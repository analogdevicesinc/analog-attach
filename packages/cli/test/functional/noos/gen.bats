# General requirements (GEN-*), where the backend is noos.

# bats file_tags=eco:noos

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

# bats test_tags=req:GEN-01
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
	run_json config probe jlink
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set probe = jlink"
}

# --- GEN-03: only the selected ecosystem's commands, flags and settings --------------------

# bats test_tags=req:GEN-03
@test "help leaves out the commands of the linux backend" {
	run aa --help
	assert_success
	refute_output --regexp $'\n  (move|enable|disable) '
	assert_output --regexp $'\n  generate '
}

# bats test_tags=req:GEN-03
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

# bats test_tags=req:GEN-03
@test "a setting of the linux backend is not a setting here" {
	run aa config overlay-syntax
	assert_failure 2
	assert_output --partial "Unknown config field: overlay-syntax"
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | index("devicetree")' null
}

# bats test_tags=req:GEN-03
@test "a command of the linux backend is refused" {
	with_sensor
	run aa move testpart_cs_gpio testpart
	assert_failure 2
}

# --- GEN-04, GEN-05, GEN-06: questions --------------------------------------------------

# bats test_tags=req:GEN-04
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

# bats test_tags=req:GEN-05
@test "with no terminal, add asks nothing and reports what it would have asked" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	run timeout 30 node "$CLI_DIR/dist/cli.js" add testpart </dev/null
	assert_success
	refute_output --partial "only you can tell"
	assert_output --partial "testpart_spi_dev.controller"
	assert_output --partial "bsp_test_spi2_cfg_handle"
}

# bats test_tags=req:GEN-05
@test "with --json, add asks nothing and reports what is left in the result" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	run_json add testpart
	assert_success
	assert_json '[.missing_required[] | select(.property == "controller")] | .[0].suggestions | length' 2
}

# bats test_tags=req:GEN-05
@test "on a terminal, --json still asks nothing" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	tty_run -- --json add testpart
	assert_success
	refute_output --partial "only you can tell"
	assert_output --partial '"missing_required"'
}

# bats test_tags=req:GEN-05
@test "on a terminal, add asks for what is left" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	tty_run "pick one" $'\x03' -- add testpart
	assert_output --partial "testpart_spi_dev.controller: pick one"
}

# bats test_tags=req:GEN-06
@test "stopping a question with Ctrl+C ends the command and keeps the answers given" {
	aa config interview --reset >/dev/null
	aa init >/dev/null
	tty_run "pick one" $'\r' "native_cs (number)" $'\x03' -- add testpart
	assert_output --partial "Stopped."
	run_json read testpart_spi_dev controller
	assert_json '.value' bsp_test_spi_cfg_handle
}

# --- GEN-07, GEN-08, GEN-17: JSON results ------------------------------------------------

# bats test_tags=req:GEN-07
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

# bats test_tags=req:GEN-07
@test "every command prints one JSON result with --json" {
	with_sensor
	local words
	for words in "init" "config" "config --reload" "add testpart --name tp2" "update testpart_spi_dev max_speed_hz 2000000" \
		"rename tp2 tp3" "delete tp3 --force" "list devices" "list context" "validate" "generate" "completion bash"; do
		# shellcheck disable=SC2086
		run --separate-stderr aa --json $words
		[ "$status" -eq 0 ] || fail "$words: exit $status: $stderr"
		[ "${#lines[@]}" -eq 1 ] || fail "$words: not one line: $output"
		jq -e 'type == "object"' <<<"$output" >/dev/null || fail "$words: not a JSON object: $output"
	done
}

# bats test_tags=req:GEN-08
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

# bats test_tags=req:GEN-17, gap
@test "an error carries a type from the fixed list" {
	# Gap: a refusal has ok, message and severity only; there is no error type field.
	with_sensor
	run_json add nosuchdevice
	assert_json '.ok' false
	assert_json '(.type // .error_type // .kind // "") | length > 0' true
}

# --- GEN-09: exit status -----------------------------------------------------------------

# bats test_tags=req:GEN-09
@test "a refusal exits 0, the outcome in the result" {
	with_sensor
	run_json read nosuchnode
	assert_success
	assert_json '.ok' false
	run aa add nosuchdevice
	assert_success
}

# bats test_tags=req:GEN-09
@test "a usage error exits non-zero" {
	run aa nosuchcommand
	assert_failure 2
	run aa config --reset
	assert_failure 2
	run aa read --nosuchflag
	assert_failure 2
}

# bats test_tags=req:GEN-09, gap
@test "a refused setting value exits 0 with ok false" {
	# Gap: config refuses the value as an input error: exit 2, text on stderr, no JSON result.
	run_json config bootstrap yes
	assert_success
	assert_json '.ok' false
}

# bats test_tags=req:GEN-09, gap
@test "an unknown setting exits 0 with ok false" {
	# Gap: config refuses an unknown key as an input error: exit 2, text on stderr, no JSON result.
	run_json config nosuchkey
	assert_success
	assert_json '.ok' false
}

# --- GEN-10, GEN-11: help and version ----------------------------------------------------

# bats test_tags=req:GEN-10
@test "--help lists the commands" {
	run aa --help
	assert_success
	assert_output --partial "COMMANDS"
	assert_output --regexp $'\n  add +Add'
	assert_output --regexp $'\n  config +Show'
}

# bats test_tags=req:GEN-10
@test "<command> --help describes the command, its arguments and flags" {
	run aa update --help
	assert_success
	assert_output --partial "analog-attach update"
	assert_output --partial "ARGUMENTS"
	assert_output --partial "FLAGS"
	assert_output --partial "--suggest"
}

# bats test_tags=req:GEN-10, gap
@test "every command's help has examples" {
	# Gap: only config and completion have an Examples section; the other commands' help has none.
	local command missing=()
	for command in config init import add read update delete rename list validate build deploy generate completion skill; do
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

# bats test_tags=req:GEN-12
@test "an unknown device points to list devices" {
	aa init >/dev/null
	run_json add eval-testprt
	assert_json '.ok' false
	assert_json '.message' "Unknown schema 'eval-testprt'. Did you mean eval-testpart? See: analog-attach list devices"
}

# bats test_tags=req:GEN-12
@test "an unknown node names the nodes there are" {
	with_sensor
	run_json read testpart_spi
	assert_json '.ok' false
	assert_output --partial "Node 'testpart_spi' not found"
	assert_output --partial "testpart_spi_dev"
}

# bats test_tags=req:GEN-12
@test "a mistyped command names the closest one" {
	run aa confg
	assert_failure 2
	assert_output --partial "did you mean \`config\`"
}

# bats test_tags=req:GEN-12
@test "a missing workfile says how to create it" {
	run_json read
	assert_json '.ok' false
	assert_output --partial "Create one with 'analog-attach init'"
}

# bats test_tags=req:GEN-13
@test "a missing target stops init, naming the setting and how to set it" {
	aa config target --reset >/dev/null
	run_json init
	assert_success
	assert_json '.ok' false
	assert_output --partial "analog-attach config target"
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:GEN-13
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

# bats test_tags=req:GEN-13
@test "a missing capi-path stops init, saying how to set it" {
	aa config capi-path --reset >/dev/null
	run_json init
	assert_json '.ok' false
	[ ! -e "$PROJECT/workfile.json" ]
	assert_output --partial "config capi-path"
}

# --- GEN-14: naming a device ---------------------------------------------------------------

# bats test_tags=req:GEN-14, req:GEN-14-CAPI
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

# bats test_tags=req:GEN-14-CAPI
@test "a target is a name, not a path" {
	with_sensor
	run_json read /testpart_spi_dev
	assert_json '.ok' false
}

# --- GEN-15: saving --------------------------------------------------------------------------

# bats test_tags=req:GEN-15
@test "an edit is in the workfile when the command returns" {
	with_sensor
	aa update testpart_spi_dev max_speed_hz 2000000
	[ "$(jq '.symbols.testpart_spi_dev.max_speed_hz' "$PROJECT/workfile.json")" = 2000000 ]
	aa rename testpart_cs_gpio cs0
	jq -e '.symbols | has("cs0") and (has("testpart_cs_gpio") | not)' "$PROJECT/workfile.json" >/dev/null
	aa delete cs0 --force
	jq -e '.symbols | has("cs0") | not' "$PROJECT/workfile.json" >/dev/null
}

# bats test_tags=req:GEN-15
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
