# The guided setup (SETUP-*): `analog-attach` alone, where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet. Each test
# removes the settings it needs the guided setup to ask for.
setup() {
	load ../helpers
	new_project noos
}

# `setting <key>`: the value of a noos setting in the project's file, as JSON.
setting() {
	jq -c --arg key "$1" '.noos[$key]' "$PROJECT/.analog-attach/config.json"
}

# `eco_checkout`: next to the project, a capi checkout the setup accepts (its module.yml says
# name: capi) with the fixture's platform and driver collection beside it.
eco_checkout() {
	ECO="$BATS_TEST_TMPDIR/eco"
	mkdir -p "$ECO"
	cp -r "$NOOS_FIXTURES/capi" "$NOOS_FIXTURES/platform" "$NOOS_FIXTURES/driver-collection" "$ECO/"
	sed -i 's/^name: .*/name: capi/' "$ECO/capi/module.yml"
}

# Description: with no settings at all, the guided setup asks for the ecosystem, the capi path, the
# module repositories and the board, offering the choices it found, saves them, creates the
# workfile and shows the next steps.
# Steps:
#   1. Make a capi checkout with the platform and drivers beside it, and remove the settings file.
#   2. Run analog-attach alone on a terminal: pick noos, the found capi, all module repositories,
#      the first board, and accept creating the workfile.
#   3. Check it succeeds, and the screen offered linux and noos, the capi path, the platform and
#      the boards with their chips.
#   4. Check the settings saved backend noos, the capi path, two module paths and target
#      testboard.
#   5. Check the workfile was created for testboard, and the next steps name list devices and add.
# bats test_tags=req:SETUP-01, req:SETUP-03, req:SETUP-05, id:N0232
@test "with nothing set, the setup asks the ecosystem, then capi, modules and board, then creates the workfile" {
	eco_checkout
	rm "$PROJECT/.analog-attach/config.json"
	tty_run "What does this project target?" $'\x1b[B\r' \
		"Where is capi?" $'\r' \
		"Which module repositories" $'a\r' \
		"Which board?" $'\r' \
		"(Y/n)" $'\r' --
	assert_success
	# The choices were offered, not typed.
	assert_output --partial "(linux)"
	assert_output --partial "(noos)"
	assert_output --partial "$ECO/capi"
	assert_output --partial "platform-test"
	assert_output --regexp "testboard +testsoc"
	assert_output --regexp "otherboard +othersoc"
	# Saved, in the order asked.
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = noos ]
	[ "$(setting capi-path)" = "\"$ECO/capi\"" ]
	[ "$(setting module-paths | jq length)" = 2 ]
	[ "$(setting target)" = '"testboard"' ]
	# The workfile was created (init).
	[ "$(jq -r .board "$PROJECT/workfile.json")" = testboard ]
	assert_output --partial "Created a workfile for board testboard"
	# Next steps: find a device and add it.
	assert_output --partial "Next"
	assert_output --partial "analog-attach list devices"
	assert_output --partial "analog-attach add <eval board>"
}

# Description: the guided setup asks whether to create the workfile, and declining creates none.
# Steps:
#   1. Remove the target setting.
#   2. Run analog-attach alone on a terminal: pick the first board, answer no to creating the
#      workfile.
#   3. Check it succeeds and says the workfile can be created later with init.
#   4. Check no workfile was made.
# bats test_tags=req:SETUP-01, id:N0233
@test "the setup offers to create the workfile, and declining creates none" {
	drop_setting target
	tty_run "Which board?" $'\r' "(Y/n)" $'n\r' --
	assert_success
	assert_output --partial "Create it later: analog-attach init"
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: the guided setup asks only for the settings that have no value, and shows the
# others as set.
# Steps:
#   1. Remove the target setting.
#   2. Run analog-attach alone on a terminal: pick the second board, accept creating the workfile.
#   3. Check it succeeds and didn't ask for capi or the module repositories, showing them as set.
#   4. Check target is saved as otherboard.
# bats test_tags=req:SETUP-02, id:N0234
@test "the setup asks only for the settings that have no value" {
	drop_setting target
	tty_run "Which board?" $'\x1b[B\r' "(Y/n)" $'\r' --
	assert_success
	refute_output --partial "Where is capi?"
	refute_output --partial "Which module repositories"
	assert_output --partial "✓ capi-path: "
	assert_output --partial "✓ module-paths: "
	[ "$(setting target)" = '"otherboard"' ]
}

# Description: when every setting and the workfile are there, the guided setup asks nothing.
# Steps:
#   1. Create the workfile with init.
#   2. Run analog-attach alone on a terminal, typing nothing.
#   3. Check it succeeds, with no question, showing the target and the workfile as set.
# bats test_tags=req:SETUP-02, id:N0235
@test "a setup with everything set asks nothing" {
	aa init >/dev/null
	tty_run --
	assert_success
	refute_output --partial "?"
	assert_output --partial "✓ target: otherboard"
	assert_output --partial "✓ workfile: "
}

# Description: a guided setup stopped with Ctrl-C keeps the answers already given, and the next run
# asks only for what is still missing.
# Steps:
#   1. Remove the module-paths and target settings.
#   2. Run analog-attach alone on a terminal: pick all module repositories, then Ctrl-C at the board
#      question.
#   3. Check it says it stopped and saved the answers: three module paths, no target.
#   4. Run it again: pick the first board, decline creating the workfile.
#   5. Check it succeeds, didn't ask for module repositories, shows them as set, and target is
#      testboard.
# bats test_tags=req:SETUP-02, req:GEN-06, id:N0236
@test "a stopped setup keeps each answer, and the next run goes on from there" {
	drop_setting module-paths target
	tty_run "Which module repositories" $'a\r' "Which board?" $'\x03' --
	assert_output --partial "Stopped. What was answered is saved"
	[ "$(setting module-paths | jq length)" = 3 ]
	[ "$(setting target)" = null ]
	# The next run asks only for the board.
	tty_run "Which board?" $'\r' "(Y/n)" $'n\r' --
	assert_success
	refute_output --partial "Which module repositories"
	assert_output --partial "✓ module-paths: "
	[ "$(setting target)" = '"testboard"' ]
}

# Description: the guided setup's board question lists the platform's boards, each with its chip.
# Steps:
#   1. Remove the target setting.
#   2. Run analog-attach alone on a terminal, and Ctrl-C at the board question.
#   3. Check testboard (testsoc), otherboard (othersoc) and twobusboard (othersoc) were offered.
# bats test_tags=req:SETUP-03, id:N0237
@test "the setup offers the boards to pick from" {
	drop_setting target
	tty_run "Which board?" $'\x03' --
	assert_output --regexp "testboard +testsoc"
	assert_output --regexp "otherboard +othersoc"
	assert_output --regexp "twobusboard +othersoc"
}

# Description: without a terminal, analog-attach alone shows the help and doesn't start the guided
# setup.
# Steps:
#   1. Run analog-attach alone with stdin from /dev/null.
#   2. Check it succeeds and shows the help (USAGE, COMMANDS), with no mention of the setup.
# bats test_tags=req:SETUP-04, id:N0238
@test "without a terminal, the bare run asks nothing and shows the help" {
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "COMMANDS"
	refute_output --partial "analog-attach setup"
}

# Description: with --quiet, analog-attach alone on a terminal shows the help and asks nothing,
# even with a setting missing.
# Steps:
#   1. Remove the target setting.
#   2. Run analog-attach --quiet on a terminal.
#   3. Check it succeeds, shows USAGE, and doesn't ask for the board.
# bats test_tags=req:SETUP-04, id:N0239
@test "with --quiet, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting target
	tty_run -- --quiet
	assert_success
	assert_output --partial "USAGE"
	refute_output --partial "Which board?"
}

# Description: with --json, analog-attach alone on a terminal shows the help and asks nothing,
# even with a setting missing.
# Steps:
#   1. Remove the target setting.
#   2. Run analog-attach --json on a terminal.
#   3. Check the output shows USAGE and doesn't ask for the board.
# bats test_tags=req:SETUP-04, id:N0240
@test "with --json, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting target
	tty_run -- --json
	assert_output --partial "USAGE"
	refute_output --partial "Which board?"
}

# Description: without a terminal, analog-attach alone shows the help and names the required
# settings that are missing.
# Steps:
#   1. Remove the capi-path and target settings.
#   2. Run analog-attach alone with stdin from /dev/null.
#   3. Check it succeeds, shows USAGE, and names capi-path and target.
# bats test_tags=req:SETUP-04, id:N0241
@test "without a terminal, the bare run says which required settings are missing" {
	drop_setting capi-path target
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "capi-path"
	assert_output --regexp "target[^-]"
}
