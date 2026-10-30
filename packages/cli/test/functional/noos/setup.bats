# The guided setup (SETUP-*): `analog-attach` alone, where the backend is noos.

# bats file_tags=eco:noos

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

# bats test_tags=req:SETUP-01, req:SETUP-03, req:SETUP-05
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

# bats test_tags=req:SETUP-01
@test "the setup offers to create the workfile, and declining creates none" {
	drop_setting target
	tty_run "Which board?" $'\r' "(Y/n)" $'n\r' --
	assert_success
	assert_output --partial "Create it later: analog-attach init"
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:SETUP-02
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

# bats test_tags=req:SETUP-02
@test "a setup with everything set asks nothing" {
	aa init >/dev/null
	tty_run --
	assert_success
	refute_output --partial "?"
	assert_output --partial "✓ target: otherboard"
	assert_output --partial "✓ workfile: "
}

# bats test_tags=req:SETUP-02, req:GEN-06
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

# bats test_tags=req:SETUP-03
@test "the setup offers the boards to pick from" {
	drop_setting target
	tty_run "Which board?" $'\x03' --
	assert_output --regexp "testboard +testsoc"
	assert_output --regexp "otherboard +othersoc"
	assert_output --regexp "twobusboard +othersoc"
}

# bats test_tags=req:SETUP-04
@test "without a terminal, the bare run asks nothing and shows the help" {
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "COMMANDS"
	refute_output --partial "analog-attach setup"
}

# bats test_tags=req:SETUP-04
@test "with --quiet, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting target
	tty_run -- --quiet
	assert_success
	assert_output --partial "USAGE"
	refute_output --partial "Which board?"
}

# bats test_tags=req:SETUP-04
@test "with --json, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting target
	tty_run -- --json
	assert_output --partial "USAGE"
	refute_output --partial "Which board?"
}

# bats test_tags=req:SETUP-04
@test "without a terminal, the bare run says which required settings are missing" {
	drop_setting capi-path target
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "capi-path"
	assert_output --regexp "target[^-]"
}
