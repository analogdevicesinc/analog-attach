# gui where the backend is noos: the GUI's server, run by the CLI.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet. Each test
# serves the GUI on a free port, without a browser, and stops it before it ends.
setup() {
	load ../helpers
	new_project noos
}

teardown() {
	[ -z "${GUI_PID:-}" ] || kill -INT "$GUI_PID" 2>/dev/null || true
}

# `start_gui`: `gui --server-only --port 0` in the background; sets $GUI_URL from what it prints.
# node itself, not through `aa`, so that $GUI_PID is the server's and Ctrl-C (SIGINT) reaches it;
# and with bats' descriptor 3 closed, or bats would wait for it to end.
start_gui() {
	node "$CLI_DIR/dist/cli.js" gui --server-only --port 0 >"$BATS_TEST_TMPDIR/gui.out" 2>"$BATS_TEST_TMPDIR/gui.err" 3>&- &
	GUI_PID=$!
	local tries
	for tries in $(seq 1 50); do
		GUI_URL=$(grep -o 'http://127\.0\.0\.1:[0-9]*' "$BATS_TEST_TMPDIR/gui.err" || true)
		[ -n "$GUI_URL" ] && return 0
		sleep 0.2
	done
	fail "the GUI didn't start: $(cat "$BATS_TEST_TMPDIR/gui.err")"
}

# `gui_run <args>...`: one CLI run through the GUI's API; prints the CLI's JSON answer.
gui_run() {
	# Each word a JSON string, then all of them an array (jq --args would take --json as its own).
	printf '%s\n' "$@" | jq -R . | jq -sc '{ args: . }' |
		curl -s -X POST -H 'content-type: application/json' --data-binary @- "$GUI_URL/api/run" | jq -c .json
}

# Description: gui serves the page and runs the CLI for it, in the project, until it is stopped.
# Steps:
#   1. Run gui --server-only --port 0 in the background; check it says where it serves the GUI.
#   2. Check the page is served, and /api/project names the project folder and the noos backend.
#   3. Through the API, run init, add eval-testpart and read; check each answers, the add with its
#      wiring, and read lists the nodes.
#   4. Stop it with Ctrl-C (SIGINT); check it says it stopped.
# bats test_tags=id:N0282
@test "gui serves the page and runs the CLI for it until stopped" {
	need curl
	start_gui
	run curl -s "$GUI_URL/"
	assert_output --partial "<title>Attach Studio</title>"
	run curl -s "$GUI_URL/api/project"
	assert_output "{\"dir\":\"$PROJECT\",\"settings\":true,\"backend\":\"noos\"}"
	[ "$(gui_run init --json | jq -r .ok)" = true ]
	[ "$(gui_run add eval-testpart --json | jq -r '.wiring | length')" = 1 ]
	[ "$(gui_run read --json | jq -r '[.children[].key] | index("testpart_spi_dev") != null')" = true ]
	kill -INT "$GUI_PID"
	wait "$GUI_PID" || true
	GUI_PID=
	run cat "$BATS_TEST_TMPDIR/gui.out"
	assert_output --partial "Stopped the GUI at $GUI_URL"
}

# Description: gui refuses a port that isn't a number, as a usage error.
# Steps:
#   1. Run gui --server-only --port nope.
#   2. Check it fails with a usage error (exit 2), saying --port takes a port number.
# bats test_tags=id:N0283
@test "gui refuses a port that isn't a number" {
	run aa gui --server-only --port nope
	assert_failure 2
	assert_output --partial "--port takes a port number"
}

# Description: the GUI's "New project" makes the project folder it is given, and switches to it,
# with no settings yet.
# Steps:
#   1. Start the GUI in the background.
#   2. POST /api/project with a folder that doesn't exist and create: true.
#   3. Check the folder now exists, and the answer names it with no settings and no backend.
#   4. POST /api/project with another missing folder, without create; check it is refused.
# bats test_tags=id:N0285
@test "the GUI makes a new project's folder when asked" {
	need curl
	start_gui
	local fresh="$BATS_TEST_TMPDIR/fresh/project"
	run curl -s -X POST -H 'content-type: application/json' -d "{\"dir\":\"$fresh\",\"create\":true}" "$GUI_URL/api/project"
	[ -d "$fresh" ] || fail "no folder made: $output"
	assert_output "{\"dir\":\"$fresh\",\"settings\":false,\"backend\":null}"
	run curl -s -X POST -H 'content-type: application/json' -d "{\"dir\":\"$BATS_TEST_TMPDIR/absent\"}" "$GUI_URL/api/project"
	assert_output --partial "Not a folder"
	[ ! -e "$BATS_TEST_TMPDIR/absent" ]
}
