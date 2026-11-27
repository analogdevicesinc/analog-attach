# gui where the backend is noos: the GUI's server, run by the CLI.

# bats file_tags=eco:noos

# Preconditions: a noos project on capi-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet. Each test
# serves the GUI on a free port, without a browser, and stops it before it ends.
setup() {
	load ../helpers
	new_project noos
}

teardown() {
	[ -z "${GUI_PID:-}" ] || kill -INT "$GUI_PID" 2>/dev/null || true
	[ -z "${PORTAL_PID:-}" ] || kill "$PORTAL_PID" 2>/dev/null || true
	[ -z "${BUS_PID:-}" ] || kill "$BUS_PID" 2>/dev/null || true
	[ -z "${LLM_PID:-}" ] || kill "$LLM_PID" 2>/dev/null || true
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
	assert_output --partial "<title>Analog Attach</title>"
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

# Description: several GUIs can be open at once: without --port, a GUI whose default port is taken
# moves on to a free one; a port asked for with --port that is taken is refused, saying so.
# Steps:
#   1. Start two GUIs without --port, in the background.
#   2. Check each says where it serves the GUI, on two different ports, and both serve the page.
#   3. Run gui --server-only --port with the first one's port; check it fails, saying the port is in use.
# bats test_tags=id:N0288
@test "a second gui moves to a free port, unless its port was asked for" {
	local first second
	node "$CLI_DIR/dist/cli.js" gui --server-only >"$BATS_TEST_TMPDIR/gui1.err" 2>&1 3>&- &
	GUI_PID=$!
	node "$CLI_DIR/dist/cli.js" gui --server-only >"$BATS_TEST_TMPDIR/gui2.err" 2>&1 3>&- &
	SECOND_PID=$!
	local tries
	for tries in $(seq 1 50); do
		first=$(grep -o 'http://127\.0\.0\.1:[0-9]*' "$BATS_TEST_TMPDIR/gui1.err" || true)
		second=$(grep -o 'http://127\.0\.0\.1:[0-9]*' "$BATS_TEST_TMPDIR/gui2.err" || true)
		[ -n "$first" ] && [ -n "$second" ] && break
		sleep 0.2
	done
	kill -INT "$SECOND_PID" 2>/dev/null || true
	[ -n "$first" ] || fail "the first GUI didn't start: $(cat "$BATS_TEST_TMPDIR/gui1.err")"
	[ -n "$second" ] || fail "the second GUI didn't start: $(cat "$BATS_TEST_TMPDIR/gui2.err")"
	[ "$first" != "$second" ] || fail "both GUIs say $first"
	curl -s "$first/" | grep -q 'name="aa-token"' || fail "no page at $first"

	run aa gui --server-only --port "${first##*:}"
	assert_failure
	assert_output --partial "Port ${first##*:} on 127.0.0.1 is in use"
}

# Description: the GUI keeps its project folder for as long as it runs: the API changes it to no
# other folder, and makes none.
# Steps:
#   1. Start the GUI in the background.
#   2. POST /api/project with another folder, which doesn't exist, and create: true.
#   3. Check it is not found, no folder was made, and /api/project still names the project.
# bats test_tags=id:N0285
@test "the GUI keeps its project folder" {
	need curl
	start_gui
	local other="$BATS_TEST_TMPDIR/other/project"
	run gui_api /api/project "{\"dir\":\"$other\",\"create\":true}"
	assert_output --partial "not found"
	[ ! -e "$other" ] || fail "a folder was made: $other"
	run gui_api /api/project
	assert_output "{\"dir\":\"$PROJECT\",\"settings\":true,\"backend\":\"noos\"}"
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
#   1. Put a stand-in claude in place, and start the GUI in the background (no model set up: the
#      chat's provider is Claude Code).
#   2. GET /api/chat; check Claude Code is the provider, available, with the stand-in's version.
#   3. POST a message to /api/chat; check the answer streams the stand-in's command as the chat's
#      own events, answered with the CLI's own version (the GUI's analog-attach), then ends with
#      gui_done 0.
#   4. Check claude was run with -p and the message, --permission-mode dontAsk, --allowedTools
#      Bash(analog-attach:*), analog-attach gui disallowed, and no --resume.
#   5. POST a second message; check it was run with --resume stand-in-session.
#   6. POST /api/chat/reset, then a third message; check it has no --resume.
# bats test_tags=id:N0287
@test "the GUI's chat runs Claude with analog-attach commands only, one conversation per project" {
	need curl
	stand_in_claude
	start_gui
	run gui_api /api/chat
	assert_output '{"provider":"claude","name":"Claude Code","available":true,"version":"9.9.9 (Claude Code)"}'
	run gui_api /api/chat '{"message":"what version is this?"}'
	assert_line --index 0 '{"type":"command","id":"t1","command":"analog-attach --version"}'
	[ "$(jq -sr '.[] | select(.type == "output") | .output' <<<"$output")" = "$(aa --version)" ] ||
		fail "the command didn't run the GUI's CLI: $output"
	[ "$(jq -sc '.[] | select(.type == "result") | .ok' <<<"$output")" = true ] || fail "no result ok: $output"
	[ "$(jq -sc '.[-1] | {type, code}' <<<"$output")" = '{"type":"gui_done","code":0}' ] || fail "no gui_done 0: $output"
	run cat "$CLAUDE_RUNS/run0"
	assert_line --index 0 -p
	assert_line --index 1 "what version is this?"
	assert_output --regexp $'--permission-mode\ndontAsk'
	assert_output --regexp $'--allowedTools\nBash\\(analog-attach:\\*\\)'
	assert_output --regexp $'--disallowedTools\nBash\\(analog-attach gui:\\*\\)'
	refute_output --partial -- "--resume"
	gui_api /api/chat '{"message":"and again?"}' >/dev/null
	run cat "$CLAUDE_RUNS/run1"
	assert_output --regexp $'--resume\nstand-in-session'
	gui_api /api/chat/reset '{}' >/dev/null
	gui_api /api/chat '{"message":"a new chat"}' >/dev/null
	run cat "$CLAUDE_RUNS/run2"
	refute_output --partial -- "--resume"
}

# `stand_in_llm`: an OpenAI-compatible endpoint on 127.0.0.1 ($LLM_URL, its /v1), no real model.
# Each request is saved as request<n> in $LLM_REQUESTS (its path, Authorization and body). To a
# user's message it streams some text and two tool calls, `--version` (its arguments in pieces)
# and `gui`; to the commands' answers, a reply quoting the first.
stand_in_llm() {
	export LLM_REQUESTS="$BATS_TEST_TMPDIR/llm-requests"
	mkdir -p "$LLM_REQUESTS"
	cat >"$BATS_TEST_TMPDIR/llm.mjs" <<'JS'
import fs from "node:fs";
import http from "node:http";
const [dir, port_file] = process.argv.slice(2);
let count = 0;
const server = http.createServer((request, response) => {
	let text = "";
	request.on("data", chunk => { text += chunk; });
	request.on("end", () => {
		const body = JSON.parse(text);
		fs.writeFileSync(`${dir}/request${count++}`, JSON.stringify({ path: request.url, authorization: request.headers.authorization ?? null, body }));
		response.writeHead(200, { "content-type": "text/event-stream" });
		const send = chunk => response.write(`data: ${JSON.stringify({ choices: [{ delta: chunk }] })}\n\n`);
		const last = body.messages.at(-1);
		if (last.role === "user") {
			send({ role: "assistant", content: "Let me look. " });
			send({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "analog_attach", arguments: "" } }] });
			send({ tool_calls: [{ index: 0, function: { arguments: "{\"args\": [\"--ver" } }] });
			send({ tool_calls: [{ index: 0, function: { arguments: "sion\"]}" } }] });
			send({ tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "analog_attach", arguments: "{\"args\": [\"gui\"]}" } }] });
		} else {
			send({ content: `It said: ${body.messages.find(message => message.tool_call_id === "c1").content.split("\n").at(-1)}` });
		}
		response.end("data: [DONE]\n\n");
	});
});
server.listen(0, "127.0.0.1", () => fs.writeFileSync(port_file, String(server.address().port)));
JS
	node "$BATS_TEST_TMPDIR/llm.mjs" "$LLM_REQUESTS" "$BATS_TEST_TMPDIR/llm.port" 3>&- &
	LLM_PID=$!
	local tries
	for tries in $(seq 1 50); do
		[ -s "$BATS_TEST_TMPDIR/llm.port" ] && break
		sleep 0.1
	done
	LLM_HOST="127.0.0.1:$(cat "$BATS_TEST_TMPDIR/llm.port")"
	export LLM_URL="http://$LLM_HOST/v1"
}

# Description: with an OpenAI-compatible endpoint set, the GUI's chat runs the conversation
# itself: the model gets the part's skill and one tool, analog_attach; each command it asks for
# runs the GUI's own CLI, `analog-attach gui` is refused, and the answers go back to the model
# until it replies with text. The next message continues the conversation; a new chat starts over.
# Steps:
#   1. Start a stand-in endpoint, and the GUI with $ANALOG_ATTACH_LLM_URL, _MODEL and _API_KEY set.
#   2. GET /api/chat; check the provider is the OpenAI-compatible one, available, with the model
#      and the endpoint's host.
#   3. POST a message to /api/chat; check the events: the text, the command analog-attach
#      --version answered with the CLI's own version, analog-attach gui refused, the reply after
#      the answers, a result ok, then gui_done 0.
#   4. Check the first request: POSTed to /v1/chat/completions with the API key and the model,
#      the analog_attach tool, a system prompt with the project folder, the part's context and the
#      analog-attach-noos skill, then the message.
#   5. Check the second request has both commands' answers, the refusal among them.
#   6. POST a second message; check its request has the first message. POST /api/chat/reset, then
#      a third; check its request has only the system prompt and that message.
# bats test_tags=id:N0292
@test "the GUI's chat runs any OpenAI-compatible model, with analog-attach commands only" {
	need curl
	stand_in_llm
	ANALOG_ATTACH_LLM_URL="$LLM_URL" ANALOG_ATTACH_LLM_MODEL=stand-in ANALOG_ATTACH_LLM_API_KEY=sk-test start_gui
	run gui_api /api/chat
	assert_output "{\"provider\":\"openai\",\"name\":\"OpenAI-compatible\",\"available\":true,\"version\":\"stand-in · $LLM_HOST\"}"
	run gui_api /api/chat '{"message":"what version is this?","context":"The user has the node adc open.","skill":"analog-attach-noos"}'
	local version
	version=$(aa --version)
	[ "$(jq -sr '[.[] | select(.type == "text") | .text] | join("")' <<<"$output")" = "Let me look. It said: $version" ] || fail "not the model's text: $output"
	[ "$(jq -sc '[.[] | select(.type == "command") | .command]' <<<"$output")" = '["analog-attach --version","analog-attach gui"]' ] || fail "not the commands: $output"
	[ "$(jq -sr '.[] | select(.type == "output" and .id == "c1") | .output' <<<"$output")" = "$(printf 'exit status: 0\nstdout:\n%s' "$version")" ] ||
		fail "the command didn't run the GUI's CLI: $output"
	[ "$(jq -sc '.[] | select(.type == "output" and .id == "c2") | {failed, refused}' <<<"$output")" = '{"failed":true,"refused":true}' ] || fail "gui wasn't refused: $output"
	[ "$(jq -sc '.[] | select(.type == "result") | .ok' <<<"$output")" = true ] || fail "no result ok: $output"
	[ "$(jq -sc '.[-1] | {type, code}' <<<"$output")" = '{"type":"gui_done","code":0}' ] || fail "no gui_done 0: $output"
	run jq -r '.path, .authorization, .body.model, .body.tools[0].function.name, .body.messages[0].role, .body.messages[1].content' "$LLM_REQUESTS/request0"
	assert_output "$(printf '/v1/chat/completions\nBearer sk-test\nstand-in\nanalog_attach\nsystem\nwhat version is this?')"
	run jq -r '.body.messages[0].content' "$LLM_REQUESTS/request0"
	assert_output --partial "the project folder is $PROJECT"
	assert_output --partial "The user has the node adc open."
	assert_output --partial "The analog-attach-noos skill"
	assert_output --partial "$(sed -n '/^# /{p;q}' "$CLI_DIR/../../skills/analog-attach-noos/SKILL.md")"
	run jq -c '[.body.messages[] | select(.role == "tool") | .tool_call_id]' "$LLM_REQUESTS/request1"
	assert_output '["c1","c2"]'
	run jq -r '.body.messages[] | select(.tool_call_id == "c2") | .content' "$LLM_REQUESTS/request1"
	assert_output --partial "Not allowed"
	gui_api /api/chat '{"message":"and again?"}' >/dev/null
	run jq -c '[.body.messages[] | select(.role == "user") | .content]' "$LLM_REQUESTS/request2"
	assert_output '["what version is this?","and again?"]'
	gui_api /api/chat/reset '{}' >/dev/null
	gui_api /api/chat '{"message":"a new chat"}' >/dev/null
	run jq -c '[.body.messages[] | .role]' "$LLM_REQUESTS/request4"
	assert_output '["system","user"]'
	kill "$LLM_PID"
}

# Description: the chat's model is the environment's when the GUI starts, overridden by what
# Preferences set: kept in the user's ~/.config/analog-attach/gui-chat.json, readable by the user
# alone, the API key never shown back; an empty field takes the environment's again.
# Steps:
#   1. Start the GUI with $ANALOG_ATTACH_LLM_URL and _API_KEY set, no model.
#   2. GET /api/chat/settings; check the provider is openai (an endpoint is set), the URL the
#      environment's, the key set but not given; GET /api/chat: not available, no model.
#   3. POST a model and the claude provider; check they are kept in gui-chat.json, mode 600, and
#      /api/chat/settings says them.
#   4. POST an empty provider; check it is the environment's choice again (openai).
#   5. POST a URL that isn't http(s), and an unknown provider; check each is refused (400).
# bats test_tags=id:N0293
@test "the GUI's chat model is the environment's, overridden by Preferences in the user's settings" {
	need curl
	ANALOG_ATTACH_LLM_URL=http://127.0.0.1:9/v1 ANALOG_ATTACH_LLM_API_KEY=sk-env start_gui
	run gui_api /api/chat/settings
	[ "$(jq -c '{provider, url, model, key_set, api_key}' <<<"$output")" = '{"provider":"openai","url":"http://127.0.0.1:9/v1","model":"","key_set":true,"api_key":null}' ] ||
		fail "not the environment's: $output"
	run gui_api /api/chat
	[ "$(jq -c '{provider, available}' <<<"$output")" = '{"provider":"openai","available":false}' ] || fail "available with no model: $output"
	run gui_api /api/chat/settings '{"model":"qwen3:32b","provider":"claude"}'
	[ "$(jq -c '{provider, model}' <<<"$output")" = '{"provider":"claude","model":"qwen3:32b"}' ] || fail "not kept: $output"
	run jq -cS . "$XDG_CONFIG_HOME/analog-attach/gui-chat.json"
	assert_output '{"model":"qwen3:32b","provider":"claude"}'
	[ "$(stat -c %a "$XDG_CONFIG_HOME/analog-attach/gui-chat.json")" = 600 ] || fail "the settings file can be read by others"
	run gui_api /api/chat/settings '{"provider":""}'
	[ "$(jq -r .provider <<<"$output")" = openai ] || fail "an empty provider didn't take the environment's again: $output"
	run curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary '{"url":"file:///etc"}' "$GUI_URL/api/chat/settings"
	assert_output 400
	run curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary '{"provider":"other"}' "$GUI_URL/api/chat/settings"
	assert_output 400
}

# Description: for the setup's Linux tree step, the GUI finds the Linux trees near the project
# (a folder beside it, ../linux) and under the home folder, and names the tree a folder typed is
# inside of (its arch/), which the CLI's own setting refuses.
# Steps:
#   1. Make a Linux tree (Documentation/devicetree/bindings/ and include/) beside a new project
#      folder, another under the home folder, and a folder that is none.
#   2. Start the GUI in the new project folder.
#   3. GET /api/linux-trees; check it lists both trees, the one beside the project first.
#   4. GET /api/linux-trees?inside=../linux/arch/arm; check it names the tree beside the project.
# bats test_tags=id:N0289
@test "the GUI finds the Linux trees near the project for its setup" {
	need curl
	local work="$BATS_TEST_TMPDIR/work"
	mkdir -p "$work/linux/Documentation/devicetree/bindings" "$work/linux/include" "$work/linux/arch/arm" "$work/other/include" \
		"$HOME/src/kernel/Documentation/devicetree/bindings" "$HOME/src/kernel/include"
	mkdir -p "$work/project"
	cd "$work/project"
	start_gui
	run bash -c "curl -s -H 'x-aa-token: $GUI_TOKEN' '$GUI_URL/api/linux-trees' | jq -r '.trees[].path'"
	assert_output "$work/linux
$HOME/src/kernel"
	run bash -c "curl -s -H 'x-aa-token: $GUI_TOKEN' '$GUI_URL/api/linux-trees?inside=../linux/arch/arm' | jq -r .root"
	assert_output "$work/linux"
}

# Description: without a desktop portal, the GUI's native file picker is a dialog program, run by
# the server: the first of its list on PATH, given the kind of path, the title and the folder to
# start in; it answers the path picked, or that the dialog was cancelled. Without a display there
# is none, and a pick is refused.
# Steps:
#   1. Put a stand-in zenity first on PATH (it saves its arguments, prints the path in a file, or
#      exits 1 as a cancel without one), with a display and a session bus that isn't there (no
#      portal), and start the GUI.
#   2. GET /api/dialog; check a dialog is available, zenity.
#   3. POST /api/dialog for .dts files, starting in a folder that doesn't exist under the project;
#      check it answers the stand-in's path, and zenity was given the title, the project folder
#      (the nearest that exists) and a filter on *.dts.
#   4. POST /api/dialog for a folder; check zenity was given --directory.
#   5. Take the stand-in's path away and POST again; check it answers cancelled.
#   6. POST an extension that isn't one; check it is refused (400).
#   7. Restart the GUI without a display; check /api/dialog says none is available, and a pick is
#      refused (400).
# bats test_tags=id:N0290
@test "the GUI's native file picker runs the desktop's dialog" {
	need curl
	local bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	cat >"$bin/zenity" <<'SH'
#!/bin/bash
printf '%s\n' "$@" >"$BATS_TEST_TMPDIR/zenity-args"
[ -f "$BATS_TEST_TMPDIR/pick" ] || exit 1
cat "$BATS_TEST_TMPDIR/pick"
SH
	chmod +x "$bin/zenity"
	echo "/somewhere/board.dts" >"$BATS_TEST_TMPDIR/pick"
	PATH="$bin:$PATH" DISPLAY=:99 XDG_CURRENT_DESKTOP= DBUS_SESSION_BUS_ADDRESS="unix:path=$BATS_TEST_TMPDIR/no-bus" start_gui
	run gui_api /api/dialog
	assert_output '{"available":true,"with":"zenity"}'

	run gui_api /api/dialog '{"dir":false,"extensions":[".dts"],"title":"Choose the base devicetree","start":"no/such/folder/"}'
	assert_output '{"path":"/somewhere/board.dts","with":"zenity"}'
	run cat "$BATS_TEST_TMPDIR/zenity-args"
	assert_line "--file-selection"
	assert_line "--title=Choose the base devicetree"
	assert_line "--filename=$PWD/"
	assert_line "--file-filter=*.dts"
	refute_line "--directory"

	run gui_api /api/dialog '{"dir":true,"title":"Choose the build folder","start":"."}'
	assert_output '{"path":"/somewhere/board.dts","with":"zenity"}'
	run cat "$BATS_TEST_TMPDIR/zenity-args"
	assert_line "--directory"

	rm "$BATS_TEST_TMPDIR/pick"
	run gui_api /api/dialog '{"dir":true,"start":"."}'
	assert_output '{"cancelled":true,"with":"zenity"}'

	run curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary '{"extensions":["*; rm -rf"]}' "$GUI_URL/api/dialog"
	assert_output 400

	kill -INT "$GUI_PID"
	wait "$GUI_PID" || true
	PATH="$bin:$PATH" DISPLAY= WAYLAND_DISPLAY= start_gui
	run gui_api /api/dialog
	assert_output '{"available":false}'
	run curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary '{"dir":true}' "$GUI_URL/api/dialog"
	assert_output 400
}

# `stand_in_portal [<version>]`: a session bus of the test's own (dbus-daemon, nothing activated
# on it) with a stand-in desktop portal on it, its FileChooser of <version> (4 by default), and
# $DBUS_SESSION_BUS_ADDRESS naming it. The portal saves each OpenFile's title and options in
# $BATS_TEST_TMPDIR/open-file, answers with the path in $BATS_TEST_TMPDIR/pick (a cancel without
# one), or never with $BATS_TEST_TMPDIR/hold there; a Request.Close is noted in .../closed.
stand_in_portal() {
	need dbus-daemon
	cat >"$BATS_TEST_TMPDIR/bus.conf" <<XML
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
	<type>session</type>
	<listen>unix:path=$BATS_TEST_TMPDIR/bus</listen>
	<auth>EXTERNAL</auth>
	<policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy>
</busconfig>
XML
	dbus-daemon --config-file="$BATS_TEST_TMPDIR/bus.conf" --nofork 3>&- &
	BUS_PID=$!
	export DBUS_SESSION_BUS_ADDRESS="unix:path=$BATS_TEST_TMPDIR/bus"
	cat >"$BATS_TEST_TMPDIR/portal.mjs" <<'JS'
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const { connect_bus, session_bus_socket, MESSAGE } = await import(process.env.DBUS_CLIENT);
const at = name => `${process.env.BATS_TEST_TMPDIR}/${name}`;
const bus = await connect_bus(session_bus_socket());
await bus.call({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "RequestName", signature: "su", body: ["org.freedesktop.portal.Desktop", 4] });
bus.on_message(message => {
	if (message.type !== MESSAGE.call) return;
	const reply = (signature = "", body = []) => bus.send({ type: MESSAGE.return, reply_serial: message.serial, destination: message.sender, signature, body });
	if (message.member === "Get") reply("v", [["u", Number(process.env.PORTAL_VERSION)]]);
	else if (message.member === "Close") {
		fs.writeFileSync(at("closed"), message.path);
		reply();
	} else if (message.member === "OpenFile") {
		const [, title, options] = message.body;
		const folder = Buffer.from(options.current_folder).toString().replace(/\0$/, "");
		fs.writeFileSync(at("open-file"), JSON.stringify({ title, folder, directory: options.directory ?? false, filters: options.filters ?? [] }));
		const handle = `/org/freedesktop/portal/desktop/request/${message.sender.slice(1).replaceAll(".", "_")}/${options.handle_token}`;
		reply("o", [handle]);
		if (fs.existsSync(at("hold"))) return;
		const pick = fs.existsSync(at("pick")) ? fs.readFileSync(at("pick"), "utf8").trim() : undefined;
		bus.send({ type: MESSAGE.signal, path: handle, interface: "org.freedesktop.portal.Request", member: "Response", destination: message.sender, signature: "ua{sv}",
			body: pick === undefined ? [1, []] : [0, [["uris", ["as", [pathToFileURL(pick).href]]]]] });
	}
});
fs.writeFileSync(at("portal-ready"), "");
JS
	local tries
	for tries in $(seq 1 50); do [ -S "$BATS_TEST_TMPDIR/bus" ] && break; sleep 0.1; done
	PORTAL_VERSION="${1:-4}" DBUS_CLIENT="$CLI_DIR/../gui/src/dbus.mjs" node "$BATS_TEST_TMPDIR/portal.mjs" 3>&- &
	PORTAL_PID=$!
	for tries in $(seq 1 50); do [ -f "$BATS_TEST_TMPDIR/portal-ready" ] && return 0; sleep 0.1; done
	fail "the stand-in portal didn't start"
}

# Description: on Linux, the GUI's native file picker is first the desktop portal's file chooser,
# on the session bus: given the title, the folder to start in and a filter on the extensions, or
# a folder to pick; it answers the path picked, or a cancel, and a page gone closes the dialog. A
# portal too old to pick folders leaves a folder to the dialog program.
# Steps:
#   1. Start a session bus of the test's own with a stand-in portal (FileChooser version 4) on it,
#      with a display, and start the GUI.
#   2. GET /api/dialog; check it is the portal.
#   3. POST /api/dialog for .dts files, starting in a folder that doesn't exist under the project;
#      check it answers the portal's path, and the portal was given the title, the project folder
#      and a filter on *.dts beside all files.
#   4. POST /api/dialog for a folder; check the portal was asked for a directory.
#   5. Take the portal's path away and POST again; check it answers cancelled.
#   6. Make the portal hold its answer and POST with a client that gives up after a second; check
#      the portal is asked to close the request.
#   7. Restart the GUI on a stand-in portal of version 2, with a stand-in zenity on PATH; POST for a
#      folder; check zenity answered it, given --directory.
# bats test_tags=id:N0291
@test "the GUI's native file picker is the desktop portal's" {
	need curl
	stand_in_portal 4
	echo "/somewhere/board.dts" >"$BATS_TEST_TMPDIR/pick"
	DISPLAY=:99 start_gui
	run gui_api /api/dialog
	assert_output '{"available":true,"with":"portal"}'

	run gui_api /api/dialog '{"dir":false,"extensions":[".dts"],"title":"Choose the base devicetree","start":"no/such/folder/"}'
	assert_output '{"path":"/somewhere/board.dts","with":"portal"}'
	run jq -c . "$BATS_TEST_TMPDIR/open-file"
	assert_output "{\"title\":\"Choose the base devicetree\",\"folder\":\"$PWD\",\"directory\":false,\"filters\":[[\"*.dts\",[[0,\"*.dts\"]]],[\"All files\",[[0,\"*\"]]]]}"

	run gui_api /api/dialog '{"dir":true,"title":"Choose the build folder","start":"."}'
	assert_output '{"path":"/somewhere/board.dts","with":"portal"}'
	run jq -c .directory "$BATS_TEST_TMPDIR/open-file"
	assert_output true

	rm "$BATS_TEST_TMPDIR/pick"
	run gui_api /api/dialog '{"dir":true,"start":"."}'
	assert_output '{"cancelled":true,"with":"portal"}'

	touch "$BATS_TEST_TMPDIR/hold"
	curl -s --max-time 1 -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary '{"dir":true}' "$GUI_URL/api/dialog" || true
	local tries
	for tries in $(seq 1 30); do [ -f "$BATS_TEST_TMPDIR/closed" ] && break; sleep 0.1; done
	run cat "$BATS_TEST_TMPDIR/closed"
	assert_output --regexp '^/org/freedesktop/portal/desktop/request/[0-9_]+/aa_[0-9a-f]+$'

	kill -INT "$GUI_PID"
	wait "$GUI_PID" || true
	kill "$PORTAL_PID" "$BUS_PID"
	wait "$PORTAL_PID" "$BUS_PID" 2>/dev/null || true
	rm -f "$BATS_TEST_TMPDIR/bus" "$BATS_TEST_TMPDIR/portal-ready" "$BATS_TEST_TMPDIR/hold"
	stand_in_portal 2
	local bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	printf '#!/bin/bash\nprintf "%%s\\n" "$@" >"$BATS_TEST_TMPDIR/zenity-args"\necho /from/zenity\n' >"$bin/zenity"
	chmod +x "$bin/zenity"
	PATH="$bin:$PATH" DISPLAY=:99 XDG_CURRENT_DESKTOP= start_gui
	run gui_api /api/dialog '{"dir":true,"start":"."}'
	assert_output '{"path":"/from/zenity","with":"zenity"}'
	run cat "$BATS_TEST_TMPDIR/zenity-args"
	assert_line "--directory"
}
