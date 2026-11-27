# gui where the backend is linux: the chat's agent executables, Codex CLI and Gemini CLI, and
# the chat's settings that pick one.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, no workfile. Each test
# serves the GUI on a free port, without a browser, and stops it before it ends.
setup() {
	load ../helpers
	new_project linux
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

# `gui_status <path> <json body>`: the HTTP status of a POST to the GUI's API.
gui_status() {
	curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-aa-token: $GUI_TOKEN" -H 'content-type: application/json' --data-binary "$2" "$GUI_URL$1"
}

# `stand_in_agent <name> <version> <events>`: a stand-in for an agent's command, no real agent.
# `--version` prints `<name> <version>`; any other run saves its arguments, standard input and
# folder as run<n>.json in $RUNS, runs `analog-attach --version` through PATH as the agent
# would, and prints the events of <events> (a JavaScript function of what that answered), one
# JSON per line. The stand-in is $BATS_TEST_TMPDIR/<name>.
stand_in_agent() {
	export RUNS="$BATS_TEST_TMPDIR/$1-runs"
	mkdir -p "$RUNS"
	cat >"$BATS_TEST_TMPDIR/$1" <<JS
#!/usr/bin/env node
const fs = require("node:fs");
const { execSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("$1 $2"); process.exit(0); }
const stdin = args.at(-1) === "-" ? fs.readFileSync(0, "utf8") : "";
const runs = process.env.RUNS;
fs.writeFileSync(\`\${runs}/run\${fs.readdirSync(runs).length}.json\`, JSON.stringify({ args, stdin, cwd: process.cwd() }));
const answer = execSync("analog-attach --version", { encoding: "utf8" }).trim();
for (const event of ($3)(answer)) console.log(JSON.stringify(event));
JS
	chmod +x "$BATS_TEST_TMPDIR/$1"
}

# Description: with Codex CLI the GUI's chat runs codex exec in the project, the message on its
# standard input, in a workspace-write sandbox with the network and no approvals, and the GUI's own CLI first on
# its PATH; its events become the chat's; the next message resumes the thread, a new chat starts
# another.
# Steps:
#   1. Put a stand-in codex in place ($ANALOG_ATTACH_CODEX), with Codex CLI chosen
#      ($ANALOG_ATTACH_CHAT_PROVIDER=codex), and start the GUI.
#   2. GET /api/chat; check Codex CLI is the provider, available, with the stand-in's version.
#   3. POST a message; check the chat's events: the command (its shell unwrapped) answered by the
#      GUI's CLI, the reply's text, a result ok, then gui_done 0.
#   4. Check codex was run as exec --json with --sandbox workspace-write, approval_policy never,
#      --cd the project, the developer instructions, the sandbox's network on, - last and no resume, the message on its
#      standard input, in the project folder.
#   5. POST a second message; check it was run with resume and the thread. POST /api/chat/reset
#      and a third; check it has no resume.
# bats test_tags=req:GUI-02, id:L0505
@test "the GUI's chat runs Codex CLI sandboxed in the project, one thread per project" {
	need curl
	stand_in_agent codex 9.9.9 'answer => [
		{ type: "thread.started", thread_id: "stand-in-thread" },
		{ type: "turn.started" },
		{ type: "item.started", item: { id: "item_0", type: "command_execution", command: "/bin/bash -lc '"'"'analog-attach --version'"'"'", aggregated_output: "", exit_code: null, status: "in_progress" } },
		{ type: "item.completed", item: { id: "item_0", type: "command_execution", command: "/bin/bash -lc '"'"'analog-attach --version'"'"'", aggregated_output: answer, exit_code: 0, status: "completed" } },
		{ type: "item.completed", item: { id: "item_1", type: "agent_message", text: "It is " + answer } },
		{ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } },
	]'
	export ANALOG_ATTACH_CODEX="$BATS_TEST_TMPDIR/codex"
	ANALOG_ATTACH_CHAT_PROVIDER=codex start_gui
	run gui_api /api/chat
	assert_output '{"provider":"codex","name":"Codex CLI","available":true,"version":"codex 9.9.9"}'
	run gui_api /api/chat '{"message":"-what version is this?"}'
	[ "$(jq -sc '[.[] | select(.type == "command")]' <<<"$output")" = '[{"type":"command","id":"item_0","command":"analog-attach --version"}]' ] ||
		fail "not the command: $output"
	[ "$(jq -sr '.[] | select(.type == "output") | .output' <<<"$output")" = "$(aa --version)" ] ||
		fail "the command didn't run the GUI's CLI: $output"
	[ "$(jq -sr '[.[] | select(.type == "text") | .text] | join("")' <<<"$output")" = "It is $(aa --version)" ] || fail "no reply: $output"
	[ "$(jq -sc '[.[] | select(.type == "result") | .ok]' <<<"$output")" = '[true]' ] || fail "no result ok: $output"
	[ "$(jq -sc '.[-1] | {type, code}' <<<"$output")" = '{"type":"gui_done","code":0}' ] || fail "no gui_done 0: $output"
	run jq -r '.args[:9] | join(" ")' "$RUNS/run0.json"
	assert_output "exec --json --color never --skip-git-repo-check --sandbox workspace-write --cd $PROJECT"
	run jq -r '.args | index("-c") as $c | .[$c + 1], .[$c + 2], (.[$c + 3] | startswith("developer_instructions=\"")), .[-1], (index("resume") == null)' "$RUNS/run0.json"
	assert_output "$(printf 'approval_policy="never"\n-c\ntrue\n-\ntrue')"
	run jq -r '.args[-3:-1] | join(" ")' "$RUNS/run0.json"
	assert_output "-c sandbox_workspace_write.network_access=true"
	run jq -r '.stdin, .cwd' "$RUNS/run0.json"
	assert_output "$(printf '%s\n%s' "-what version is this?" "$PROJECT")"
	gui_api /api/chat '{"message":"and again?"}' >/dev/null
	run jq -r '.args[-3:] | join(" ")' "$RUNS/run1.json"
	assert_output "resume stand-in-thread -"
	gui_api /api/chat/reset '{}' >/dev/null
	gui_api /api/chat '{"message":"a new chat"}' >/dev/null
	run jq -r '.args | index("resume") == null' "$RUNS/run2.json"
	assert_output true
}

# Description: with Gemini CLI the GUI's chat runs gemini headless in the project with the
# GUI's policy (analog-attach shell commands and skills allowed, analog-attach gui and every
# other tool denied), its instructions before the message, and the GUI's own CLI first on its
# PATH; its events become the chat's, a denied tool a refusal; the next message resumes the
# session, a new chat starts another.
# Steps:
#   1. Put a stand-in gemini in place ($ANALOG_ATTACH_GEMINI), with Gemini CLI chosen
#      (POST /api/chat/settings), and start the GUI.
#   2. GET /api/chat; check Gemini CLI is the provider, available.
#   3. POST a message; check the chat's events: the shell command answered by the GUI's CLI, a
#      denied write_file refused, the reply's text, a result ok, then gui_done 0.
#   4. Check gemini was run with one --prompt= word, the GUI's instructions then the message,
#      stream-json, --approval-mode default and --policy a file that allows analog-attach
#      commands and denies every other tool, no --resume, in the project folder.
#   5. POST a second message; check it was run with --resume and the session. POST
#      /api/chat/reset and a third; check it has no --resume.
# bats test_tags=req:GUI-02, id:L0506
@test "the GUI's chat runs Gemini CLI with analog-attach commands only, one session per project" {
	need curl
	stand_in_agent gemini 9.9.9 'answer => [
		{ type: "init", session_id: "stand-in-session", model: "stand-in" },
		{ type: "message", role: "user", content: "hi" },
		{ type: "tool_use", tool_name: "run_shell_command", tool_id: "t1", parameters: { command: "analog-attach --version" } },
		{ type: "tool_result", tool_id: "t1", status: "success", output: answer },
		{ type: "tool_use", tool_name: "write_file", tool_id: "t2", parameters: { file_path: "x" } },
		{ type: "tool_result", tool_id: "t2", status: "error", error: { type: "policy_violation", message: "Tool execution denied by policy." } },
		{ type: "message", role: "assistant", content: "Done.", delta: true },
		{ type: "result", status: "success", stats: { duration_ms: 1200 } },
	]'
	export ANALOG_ATTACH_GEMINI="$BATS_TEST_TMPDIR/gemini"
	start_gui
	run gui_api /api/chat/settings '{"provider":"gemini","agent":"gemini"}'
	run gui_api /api/chat
	[ "$(jq -c '{provider, name, available}' <<<"$output")" = '{"provider":"gemini","name":"Gemini CLI","available":true}' ] || fail "not Gemini CLI: $output"
	run gui_api /api/chat '{"message":"what version is this?"}'
	[ "$(jq -sr '.[] | select(.id == "t1" and .type == "output") | .output' <<<"$output")" = "$(aa --version)" ] ||
		fail "the command didn't run the GUI's CLI: $output"
	[ "$(jq -sc '[.[] | select(.id == "t2" and .type == "output") | {failed, refused}]' <<<"$output")" = '[{"failed":true,"refused":true}]' ] ||
		fail "the denied tool isn't a refusal: $output"
	[ "$(jq -sc '[.[] | select(.type == "result") | {ok, seconds}]' <<<"$output")" = '[{"ok":true,"seconds":1.2}]' ] || fail "no result ok: $output"
	[ "$(jq -sc '.[-1] | {type, code}' <<<"$output")" = '{"type":"gui_done","code":0}' ] || fail "no gui_done 0: $output"
	run jq -r '(.args[0] | startswith("--prompt=The analog-attach GUI'"'"'s instructions: ")), (.args[0] | endswith("\nwhat version is this?")), (.args[1:6] | join(" ")), (index("--resume") == null), .cwd' "$RUNS/run0.json"
	assert_output "$(printf 'true\ntrue\n--output-format stream-json --approval-mode default --policy\ntrue\n%s' "$PROJECT")"
	local policy
	policy=$(jq -r '.args[6]' "$RUNS/run0.json")
	run cat "$policy"
	assert_output --partial $'toolName = "run_shell_command"\ncommandPrefix = "analog-attach "\ndecision = "allow"'
	assert_output --partial $'toolName = "*"\ndecision = "deny"'
	gui_api /api/chat '{"message":"and again?"}' >/dev/null
	run jq -r '.args[-2:] | join(" ")' "$RUNS/run1.json"
	assert_output "--resume stand-in-session"
	gui_api /api/chat/reset '{}' >/dev/null
	gui_api /api/chat '{"message":"a new chat"}' >/dev/null
	run jq -r '.args | index("--resume") == null' "$RUNS/run2.json"
	assert_output true
}

# Description: the chat's settings keep the executable (agent) apart from the provider: the
# server chosen, the agent stays for when an executable is chosen again; an unknown agent is
# refused; an agent that isn't installed says so.
# Steps:
#   1. Start the GUI with $ANALOG_ATTACH_CODEX naming a command that doesn't exist.
#   2. GET /api/chat/settings; check the provider and agent are claude, and the agents and
#      providers are listed.
#   3. POST provider and agent codex; GET /api/chat: Codex CLI, not available, with a problem.
#   4. POST provider openai; check the agent is still codex, and gui-chat.json keeps both.
#   5. POST agent vim; check it is refused (400).
# bats test_tags=req:GUI-02, id:L0507
@test "the GUI's chat settings keep the agent apart from the provider" {
	need curl
	ANALOG_ATTACH_CODEX="$BATS_TEST_TMPDIR/no-such-codex" start_gui
	run gui_api /api/chat/settings
	[ "$(jq -c '{provider, agent, agents, providers: (.providers | keys)}' <<<"$output")" = '{"provider":"claude","agent":"claude","agents":["claude","codex","gemini"],"providers":["claude","codex","gemini","openai"]}' ] ||
		fail "not the default: $output"
	run gui_api /api/chat/settings '{"provider":"codex","agent":"codex"}'
	run gui_api /api/chat
	[ "$(jq -c '{provider, name, available, problem: (.problem | type)}' <<<"$output")" = '{"provider":"codex","name":"Codex CLI","available":false,"problem":"string"}' ] ||
		fail "not Codex CLI, missing: $output"
	run gui_api /api/chat/settings '{"provider":"openai"}'
	[ "$(jq -c '{provider, agent}' <<<"$output")" = '{"provider":"openai","agent":"codex"}' ] || fail "the agent wasn't kept: $output"
	run jq -cS '{provider, agent}' "$XDG_CONFIG_HOME/analog-attach/gui-chat.json"
	assert_output '{"agent":"codex","provider":"openai"}'
	run gui_status /api/chat/settings '{"agent":"vim"}'
	assert_output 400
}
