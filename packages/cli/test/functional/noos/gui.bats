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
		if [ -n "$GUI_URL" ]; then
			# The API answers the GUI's own page only: the token the server wrote into it.
			GUI_TOKEN=$(curl -s "$GUI_URL/" | grep -o 'name="aa-token" content="[^"]*"' | cut -d'"' -f4)
			return 0
		fi
		sleep 0.2
	done
	fail "the GUI didn't start: $(cat "$BATS_TEST_TMPDIR/gui.err")"
}

# `gui_api <path> [<json body>]`: a call to the GUI's API, as its page makes it (with the token).
gui_api() {
	if [ $# -eq 1 ]; then
		curl -s -H "x-aa-token: $GUI_TOKEN" "$GUI_URL$1"
	else
		curl -s -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary "$2" "$GUI_URL$1"
	fi
}

# `gui_run <args>...`: one CLI run through the GUI's API; prints the CLI's JSON answer.
gui_run() {
	# Each word a JSON string, then all of them an array (jq --args would take --json as its own).
	printf '%s\n' "$@" | jq -R . | jq -sc '{ args: . }' |
		curl -s -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary @- "$GUI_URL/api/run" | jq -c .json
}

# Description: gui serves the page and runs the CLI for it, in the project, until it is stopped.
# Steps:
#   1. Run gui --server-only --port 0 in the background; check it says where it serves the GUI.
#   2. Check the page is served, with a token, and /api/project names the project folder and the
#      noos backend.
#   3. Through the API, run init, add eval-testpart and read; check each answers, the add with its
#      wiring, and read lists the nodes.
#   4. Stop it with Ctrl-C (SIGINT); check it says it stopped.
# bats test_tags=id:N0282
@test "gui serves the page and runs the CLI for it until stopped" {
	need curl
	start_gui
	run curl -s "$GUI_URL/"
	assert_output --partial "<title>Attach Studio</title>"
	run gui_api /api/project
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
	run gui_api /api/project "{\"dir\":\"$fresh\",\"create\":true}"
	[ -d "$fresh" ] || fail "no folder made: $output"
	assert_output "{\"dir\":\"$fresh\",\"settings\":false,\"backend\":null}"
	run gui_api /api/project "{\"dir\":\"$BATS_TEST_TMPDIR/absent\"}"
	assert_output --partial "Not a folder"
	[ ! -e "$BATS_TEST_TMPDIR/absent" ]
}

# Description: the GUI's API answers only the GUI's own page: a call without its token, from
# another origin, or for another host is refused, and runs nothing.
# Steps:
#   1. Start the GUI in the background.
#   2. POST /api/run setting build-command with no token, as a text/plain body (what another web
#      page could send); check it is refused (not the GUI's page).
#   3. Send the same with the token but from another Origin, then for another Host; check each is
#      refused.
#   4. Check build-command is still unset, and a file outside the page's folder isn't served.
# bats test_tags=id:N0286
@test "the GUI's API answers only its own page" {
	need curl
	start_gui
	local body='{"args":["config","build-command","touch pwned"]}'
	run curl -s -X POST -H 'content-type: text/plain' --data-binary "$body" "$GUI_URL/api/run"
	assert_output --partial "not the GUI's page"
	run curl -s -X POST -H "x-aa-token: $GUI_TOKEN" -H 'Origin: http://evil.example' -H 'content-type: application/json' --data-binary "$body" "$GUI_URL/api/run"
	assert_output --partial "not the GUI's page"
	run curl -s -X POST -H "x-aa-token: $GUI_TOKEN" -H "Host: evil.example:${GUI_URL##*:}" -H 'content-type: application/json' --data-binary "$body" "$GUI_URL/api/run"
	assert_output --partial "not the GUI's page"
	run_json config build-command
	assert_json '.configs[0].value' null
	run curl -s --path-as-is "$GUI_URL/../../../etc/passwd"
	assert_output --partial "not found"
}

# `stand_in_claude`: a `claude` for the chat ($ANALOG_ATTACH_CLAUDE), no real Claude. Each run
# saves its arguments as run<n> in $CLAUDE_RUNS, runs `analog-attach --version` through PATH as
# Claude would, and prints Claude-like stream-json events with what that answered.
stand_in_claude() {
	export CLAUDE_RUNS="$BATS_TEST_TMPDIR/claude-runs"
	mkdir -p "$CLAUDE_RUNS"
	cat >"$BATS_TEST_TMPDIR/claude" <<'SH'
#!/bin/bash
if [ "$1" = --version ]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '%s\n' "$@" >"$CLAUDE_RUNS/run$(ls "$CLAUDE_RUNS" | wc -l)"
answer=$(analog-attach --version)
echo '{"type":"system","subtype":"init","session_id":"stand-in-session"}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"analog-attach --version"}}]}}'
jq -cn --arg answer "$answer" '{type: "user", message: {content: [{type: "tool_result", tool_use_id: "t1", content: $answer}]}}'
echo '{"type":"result","subtype":"success","total_cost_usd":0}'
SH
	chmod +x "$BATS_TEST_TMPDIR/claude"
	export ANALOG_ATTACH_CLAUDE="$BATS_TEST_TMPDIR/claude"
}

# Description: the GUI's chat runs Claude Code in the project, allowed analog-attach commands only,
# with the GUI's own CLI; the next message continues the conversation, and a new chat starts over.
# Steps:
#   1. Put a stand-in claude in place, and start the GUI in the background.
#   2. GET /api/claude; check Claude is available, with the stand-in's version.
#   3. POST a message to /api/claude; check the answer streams the stand-in's events, its command
#      answered with the CLI's own version (the GUI's analog-attach), then ends with gui_done 0.
#   4. Check claude was run with -p and the message, --permission-mode dontAsk, --allowedTools
#      Bash(analog-attach:*), analog-attach gui disallowed, and no --resume.
#   5. POST a second message; check it was run with --resume stand-in-session.
#   6. POST /api/claude/reset, then a third message; check it has no --resume.
# bats test_tags=id:N0287
@test "the GUI's chat runs Claude with analog-attach commands only, one conversation per project" {
	need curl
	stand_in_claude
	start_gui
	run gui_api /api/claude
	assert_output '{"available":true,"version":"9.9.9 (Claude Code)"}'
	run gui_api /api/claude '{"message":"what version is this?"}'
	assert_line --index 0 '{"type":"system","subtype":"init","session_id":"stand-in-session"}'
	[ "$(jq -sr '.[] | select(.type == "user") | .message.content[0].content' <<<"$output")" = "$(aa --version)" ] ||
		fail "the command didn't run the GUI's CLI: $output"
	[ "$(jq -sc '.[-1] | {type, code}' <<<"$output")" = '{"type":"gui_done","code":0}' ] || fail "no gui_done 0: $output"
	run cat "$CLAUDE_RUNS/run0"
	assert_line --index 0 -p
	assert_line --index 1 "what version is this?"
	assert_output --regexp $'--permission-mode\ndontAsk'
	assert_output --regexp $'--allowedTools\nBash\\(analog-attach:\\*\\)'
	assert_output --regexp $'--disallowedTools\nBash\\(analog-attach gui:\\*\\)'
	refute_output --partial -- "--resume"
	gui_api /api/claude '{"message":"and again?"}' >/dev/null
	run cat "$CLAUDE_RUNS/run1"
	assert_output --regexp $'--resume\nstand-in-session'
	gui_api /api/claude/reset '{}' >/dev/null
	gui_api /api/claude '{"message":"a new chat"}' >/dev/null
	run cat "$CLAUDE_RUNS/run2"
	refute_output --partial -- "--resume"
}
