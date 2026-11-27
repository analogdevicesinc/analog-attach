# init where the backend is linux.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, its binding caches
# built, workfile overlay.dtso set but not created yet.
setup() {
	load ../helpers
	new_project linux
}

# `run_config_error <words>`: run_json for a configuration error, a refusal with its errors and
# hints (COM-071): exit 0, nothing on standard error, .ok false.
run_config_error() {
	run_json "$@"
	assert_success
	[ -z "$stderr" ] || fail "standard error: $stderr"
	assert_json '.ok' false
}

# The empty overlay init writes.
EMPTY_OVERLAY=$'/dts-v1/;\n/plugin/;\n\n/ {\n};'

# Description: init creates an empty overlay at the path the workfile setting names, and nowhere
# else.
# Steps:
#   1. Make designs/sub in the project and set the workfile to designs/sub/mine.dtso.
#   2. Run init, with --json; check it succeeds (.ok true, .created true).
#   3. Check designs/sub/mine.dtso exists and overlay.dtso does not.
#   4. Check the new file is the empty overlay.
# bats test_tags=req:INIT-01, id:L0174
@test "init creates an empty workfile at the path the workfile setting names" {
	mkdir -p "$PROJECT/designs/sub"
	new_project linux workfile=designs/sub/mine.dtso
	run_json init
	assert_success
	assert_json '.ok' true
	assert_json '.created' true
	[ -f "$PROJECT/designs/sub/mine.dtso" ]
	[ ! -e "$PROJECT/overlay.dtso" ]
	run cat "$PROJECT/designs/sub/mine.dtso"
	assert_output "$EMPTY_OVERLAY"
}

# Description: init makes an empty overlay for the base the devicetree setting names, so added
# nodes land on that base's buses.
# Steps:
#   1. Run init, with --json; check it succeeds and reports the configured base and tree.
#   2. Check the workfile is the empty overlay.
#   3. Add adi,adxl345 under spi0, with --json; check it succeeds and the node's path is under
#      the base's spi@7e204000.
# bats test_tags=req:INIT-01-LNX, id:L0175
@test "init makes an empty overlay for the base the devicetree setting names" {
	run_json init
	assert_success
	assert_json '.devicetree' "$LINUX_BASE"
	assert_json '.linux' "$LINUX_TREE"
	run cat "$WORKFILE"
	assert_output "$EMPTY_OVERLAY"
	# The overlay applies to that base: a node added to it lands on one of the base's buses.
	run_json add adi,adxl345 --parent spi0
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/spi@7e204000/adi,adxl345@2'
}

# Description: init leaves an existing workfile as it is and says it was kept.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Snapshot the workfile.
#   3. Run init, with --json; check it succeeds (.ok true, .created false) and the message ends
#      with (kept).
#   4. Check the workfile is unchanged.
# bats test_tags=req:INIT-02, id:L0176
@test "init leaves an existing workfile as it is and says so" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	snapshot
	run_json init
	assert_success
	assert_json '.ok' true
	assert_json '.created' false
	assert_json '.message | endswith("(kept)")' true
	assert_unchanged
}

# Description: in human mode, init says the workfile was kept, and does not touch it even when it
# is no devicetree.
# Steps:
#   1. Write a line of plain text as the workfile.
#   2. Run init; check it succeeds and says the overlay was kept.
#   3. Check the workfile still holds that line.
# bats test_tags=req:INIT-02, id:L0177
@test "init in human mode says the workfile was kept" {
	echo 'not even a device tree' >"$WORKFILE"
	run aa init
	assert_success
	assert_output --partial "Overlay:       $WORKFILE (kept)"
	run cat "$WORKFILE"
	assert_output 'not even a device tree'
}

# Description: init refuses a workfile path whose folder does not exist, or that is a folder,
# pointing to config workfile.
# Steps:
#   1. Set the workfile to gone/x.dtso and run init, with --json.
#   2. Check it is refused (exit 0, .ok false), the message says gone is not a directory and
#      points to config workfile; check gone was not created.
#   3. Reset the project, make a directory at the workfile's path, and run init, with --json.
#   4. Check it is refused (.ok false) and the message says the path is not a file.
# bats test_tags=req:INIT-01, req:INIT-02, id:L0178
@test "init refuses a workfile path whose folder doesn't exist, or that is a folder" {
	new_project linux workfile=gone/x.dtso
	run_json init
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Cannot create the workfile: $PROJECT/gone is not a directory. Configure another with 'analog-attach config workfile <name>'."
	[ ! -e "$PROJECT/gone" ]
	new_project linux
	mkdir "$WORKFILE"
	run_json init
	assert_json '.ok' false
	assert_json '.message' "Cannot create the workfile: $WORKFILE is not a file. Configure another with 'analog-attach config workfile <name>'."
}

# Description: init with no Linux tree or base fails with a configuration error naming both
# settings, pointing to config and the guided setup.
# Steps:
#   1. Drop the linux and devicetree settings.
#   2. Run init, with --json; check it is refused, with the errors in the result.
#   3. Check the errors name linux and devicetree, the first says linux is missing, and the
#      hint points to the guided setup and config linux and config devicetree.
#   4. Check no workfile was created.
# bats test_tags=req:INIT-03, id:L0179
@test "init with no Linux tree or base names the settings and points to config and the guided setup" {
	drop_setting linux devicetree
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'linux,devicetree'
	assert_json '.errors[0].message' 'Missing config field linux'
	assert_json '.hints[0]' "Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>' and 'config devicetree <path>', to set up a workspace."
	[ ! -e "$WORKFILE" ]
}

# Description: in human mode, init with no workfile setting names the missing setting and how to
# set it.
# Steps:
#   1. Drop the workfile setting.
#   2. Run init.
#   3. Check the output says workfile is missing and points to config workfile and the guided
#      setup.
#   4. Check no workfile was created.
# bats test_tags=req:INIT-03, id:L0180
@test "init with no workfile setting names it, in human mode" {
	drop_setting workfile
	run aa init
	assert_output --partial "Missing config field workfile"
	assert_output --partial "'analog-attach config workfile <name>'"
	assert_output --partial "Run 'analog-attach' on a terminal"
	[ ! -e "$WORKFILE" ]
}

# Description: init on a terminal asks nothing and creates the workfile.
# Steps:
#   1. Run init on a terminal.
#   2. Check it succeeds, says the workspace is ready, and shows no question.
#   3. Check the workfile was created.
# bats test_tags=req:INIT-04, id:L0181
@test "init on a terminal asks nothing" {
	tty_run -- init
	assert_success
	assert_output --partial "Workspace ready"
	refute_output --partial "?"
	[ -f "$WORKFILE" ]
}

# Description: init on a terminal with a setting missing refuses at once, without asking for it.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run init on a terminal.
#   3. Check it did not wait for input (no timeout) and says devicetree is missing.
#   4. Check it shows no question and created no workfile.
# bats test_tags=req:INIT-04, id:L0182
@test "init on a terminal with a setting missing refuses without asking" {
	drop_setting devicetree
	tty_run -- init
	# tty_run exits 124 when init waits for an answer.
	[ "$status" -ne 124 ] || fail "init waited for input: $output"
	assert_output --partial "Missing config field devicetree"
	refute_output --partial "?"
	[ ! -e "$WORKFILE" ]
}

# Description: init reports the workfile's absolute path, that it created it, and the workspace's
# settings.
# Steps:
#   1. Set the workfile to w.dtso, a relative path.
#   2. Run init, with --json; check it succeeds.
#   3. Check the path is the absolute path of w.dtso, .created is true, and the message gives
#      the tree, the base and the overlay, created.
# bats test_tags=req:INIT-05, id:L0183
@test "init reports the absolute path of the workfile and that it created it" {
	new_project linux workfile=w.dtso
	run_json init
	assert_success
	assert_json '.path' "$PROJECT/w.dtso"
	assert_json '.created' true
	assert_json '.message' "Workspace ready: linux $LINUX_TREE, devicetree $LINUX_BASE, overlay $PROJECT/w.dtso (created)"
}

# Description: in human mode, init writes the tree, the base and the overlay it created.
# Steps:
#   1. Run init.
#   2. Check it succeeds and prints Workspace ready, then the Linux, Devicetree and Overlay
#      lines, the overlay marked created.
# bats test_tags=req:INIT-05, id:L0184
@test "init in human mode writes what it created and where" {
	run aa init
	assert_success
	assert_line --index 0 'Workspace ready'
	assert_line "  Linux:         $LINUX_TREE"
	assert_line "  Devicetree:    $LINUX_BASE"
	assert_line "  Overlay:       $WORKFILE (created)"
}

# Description: init with no binding caches fails with a configuration error, says how to build
# them, and creates nothing.
# Steps:
#   1. Remove the project's binding caches.
#   2. Run init, with --json; check it is refused and the errors name compat-index and
#      validation.json.
#   3. Check the hint points to config --reload, and no workfile was created.
#   4. Run init in human mode; check it points to config --reload too.
# bats test_tags=req:INIT-06, id:L0185
@test "init with no binding caches says how to build them, and creates nothing" {
	rm -r "$PROJECT/.analog-attach/linux/"*.json "$PROJECT/.analog-attach/linux/validation-cache"
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'compat-index,validation.json'
	assert_json '.hints[0]' "Run 'analog-attach config --reload' to build the binding caches."
	[ ! -e "$WORKFILE" ]
	run aa init
	assert_output --partial "Run 'analog-attach config --reload' to build the binding caches."
}

# Description: init with one binding cache missing names that cache and where it was looked for.
# Steps:
#   1. Remove validation.json from the project's caches.
#   2. Run init, with --json; check it is refused.
#   3. Check the only error is on validation.json and says it is not found in the project's
#      validation-cache directory.
# bats test_tags=req:INIT-06, id:L0186
@test "init with one cache missing names it" {
	rm "$PROJECT/.analog-attach/linux/validation-cache/validation.json"
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'validation.json'
	assert_json '.errors[0].message' "validation.json not found or unreadable in $PROJECT/.analog-attach/linux/validation-cache"
}

# --- INIT-07-LNX: starter scripts ----------------------------------------------------------

# `mode <file>`: the file's permission bits, in octal.
mode() {
	stat -c %a "$1"
}

# Description: init writes the starter aa_build.sh and aa_deploy.sh at the project root, executable,
# and reports them.
# Steps:
#   1. Run init, with --json; check it succeeds.
#   2. Check .scripts names aa_build.sh then aa_deploy.sh at the project root, both created.
#   3. Check both files are there with mode 755, begin with #!/bin/sh, and say how to restore
#      them.
#   4. Check aa_deploy.sh names the config var commands of BOARD_IP and of the secret
#      BOARD_PASSWORD.
# bats test_tags=req:INIT-07-LNX, req:SET-14-LNX, id:L0422
@test "init writes the starter aa_build.sh and aa_deploy.sh, executable" {
	run_json init
	assert_success
	assert_json '[.scripts[] | "\(.path) \(.created)"] | join(",")' "$PROJECT/aa_build.sh true,$PROJECT/aa_deploy.sh true"
	local script
	for script in build deploy; do
		[ "$(mode "$PROJECT/aa_$script.sh")" = 755 ] || fail "aa_$script.sh: mode $(mode "$PROJECT/aa_$script.sh")"
		[ "$(head -1 "$PROJECT/aa_$script.sh")" = "#!/bin/sh" ]
		grep -q "init --restore $script" "$PROJECT/aa_$script.sh"
	done
	grep -q "config var BOARD_IP" "$PROJECT/aa_deploy.sh"
	grep -q "config var BOARD_PASSWORD --secret" "$PROJECT/aa_deploy.sh"
}

# Description: init keeps a aa_build.sh and a aa_deploy.sh that are there, and says so.
# Steps:
#   1. Write a aa_build.sh of the user's, and run init, with --json.
#   2. Check aa_build.sh is reported kept and is unchanged, and aa_deploy.sh is created.
#   3. Run init in human mode, and check the aa_build.sh and aa_deploy.sh lines say kept.
# bats test_tags=req:INIT-07-LNX, id:L0423
@test "init keeps the scripts that are there, and says so" {
	printf '#!/bin/sh\necho mine\n' >"$PROJECT/aa_build.sh"
	run_json init
	assert_success
	assert_json '[.scripts[] | .created] | join(",")' "false,true"
	[ "$(cat "$PROJECT/aa_build.sh")" = $'#!/bin/sh\necho mine' ]
	run aa init
	assert_success
	assert_line "  aa_build.sh:   $PROJECT/aa_build.sh (kept)"
	assert_line "  aa_deploy.sh:  $PROJECT/aa_deploy.sh (kept)"
}

# Description: a starter init can't write is a warning: the workfile is still created, and the
# script is left out.
# Steps:
#   1. Make a folder named aa_deploy.sh at the project root.
#   2. Run init, with --json; check it succeeds, the workfile created.
#   3. Check standard error warns that the starter aa_deploy.sh was not written, and .scripts has
#      aa_build.sh only.
# bats test_tags=req:INIT-07-LNX, id:L0424
@test "a starter init can't write is a warning, and the workfile is still created" {
	mkdir "$PROJECT/aa_deploy.sh"
	run_json init
	assert_success
	assert_json '.ok' true
	assert_json '.created' true
	assert_json '[.scripts[].path] | join(",")' "$PROJECT/aa_build.sh"
	[[ "$stderr" == *"warning: the starter aa_deploy.sh was not written: "* ]] || fail "standard error: $stderr"
}

# Description: init --restore writes one starter again, over the file there, and nothing else.
# Steps:
#   1. Write a aa_deploy.sh of the user's, and run init --restore deploy, with --json.
#   2. Check it succeeds with the path, created false, and aa_deploy.sh is the starter, mode 755.
#   3. Check no workfile and no aa_build.sh were written.
#   4. Remove aa_deploy.sh, run init --restore deploy, and check the line it writes.
# bats test_tags=req:INIT-07-LNX, req:SET-14-LNX, id:L0425
@test "init --restore writes one starter again, and nothing else" {
	printf '#!/bin/sh\necho mine\n' >"$PROJECT/aa_deploy.sh"
	run_json init --restore deploy
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$PROJECT/aa_deploy.sh"
	assert_json '.created' false
	assert_json '.message' "Wrote the starter aa_deploy.sh: $PROJECT/aa_deploy.sh"
	grep -q "init --restore deploy" "$PROJECT/aa_deploy.sh"
	[ "$(mode "$PROJECT/aa_deploy.sh")" = 755 ]
	[ ! -e "$WORKFILE" ]
	[ ! -e "$PROJECT/aa_build.sh" ]
	rm "$PROJECT/aa_deploy.sh"
	run aa init --restore deploy
	assert_success
	assert_output "Wrote the starter aa_deploy.sh: $PROJECT/aa_deploy.sh"
}

# Description: init --restore refuses a script that isn't build or deploy, and a path it can't
# write.
# Steps:
#   1. Run init --restore all, with --json; check it is refused as unknown-choice.
#   2. Make a folder named aa_build.sh, run init --restore build, with --json, and check it is
#      refused as write-failed, saying the path is not a file.
# bats test_tags=req:INIT-07-LNX, id:L0426
@test "init --restore refuses an unknown script and a path it can't write" {
	run_json init --restore all
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' unknown-choice
	assert_json '.message' "Unknown script 'all'. Restore one of: build, deploy"
	mkdir "$PROJECT/aa_build.sh"
	run_json init --restore build
	assert_json '.ok' false
	assert_json '.error_type' write-failed
	assert_json '.message' "Cannot write the starter aa_build.sh: $PROJECT/aa_build.sh is not a file"
}

# --- INIT-08-LNX: the starters' variables -------------------------------------------------

# `variables`: the project's variables in the settings file, as compact JSON (null when none).
variables() {
	jq -c '.linux.variables' "$PROJECT/.analog-attach/config.json"
}

# `variable <name>`: "<kind> <value>" of config var --json's entry for <name>, empty when none.
variable() {
	aa --json config var | jq -r --arg name "$1" '.variables[] | select(.name == $name) | "\(.kind) \(.value)"'
}

# The variables init sets with the starter aa_deploy.sh, as --json reports them.
DEPLOY_VARIABLES='[{"name":"BOARD_IP","secret":false,"value":"analog.local"},{"name":"BOARD_USER","secret":false,"value":"analog"},{"name":"BOARD_PASSWORD","secret":true}]'

# Description: init on a new project sets the variables the starter aa_deploy.sh uses, to Kuiper's
# defaults, the password a secret by name only, and reports them with aa_deploy.sh.
# Steps:
#   1. Run init, with --json; check it succeeds.
#   2. Check aa_build.sh's .variables is empty and aa_deploy.sh's names BOARD_IP analog.local,
#      BOARD_USER analog and the secret BOARD_PASSWORD, in that order.
#   3. Run config var, with --json; check BOARD_IP is a project variable analog.local,
#      BOARD_USER a project variable analog, and BOARD_PASSWORD a secret with no value.
#   4. Check the settings file has the three, BOARD_PASSWORD as {"secret": true}.
# bats test_tags=req:INIT-08-LNX, id:L0480
@test "init sets the variables of the starter aa_deploy.sh, the password a secret" {
	run_json init
	assert_success
	assert_json '.scripts[0].variables | tojson' '[]'
	assert_json '.scripts[1].variables | tojson' "$DEPLOY_VARIABLES"
	[ "$(variable BOARD_IP)" = "project analog.local" ]
	[ "$(variable BOARD_USER)" = "project analog" ]
	[ "$(variable BOARD_PASSWORD)" = "secret null" ]
	[ "$(variables)" = '{"BOARD_IP":"analog.local","BOARD_USER":"analog","BOARD_PASSWORD":{"secret":true}}' ]
}

# Description: in human mode, init names the variables it set and how to change them; a second
# init, which keeps the scripts, sets none and names none.
# Steps:
#   1. Run init; check it succeeds and has the line naming BOARD_IP = analog.local,
#      BOARD_USER = analog and BOARD_PASSWORD as a secret, set now, and the line pointing to
#      config var.
#   2. Run init again; check it has no Variables line and no config var line.
# bats test_tags=req:INIT-08-LNX, id:L0481
@test "init in human mode names the variables it set, and how to change them" {
	run aa init
	assert_success
	assert_line "  aa_deploy.sh:  $PROJECT/aa_deploy.sh (created)"
	assert_line "  Variables:     BOARD_IP = analog.local, BOARD_USER = analog, BOARD_PASSWORD as a secret (set now)"
	assert_line "  Change a variable with analog-attach config var <NAME> <value>."
	run aa init
	assert_success
	refute_output --partial "Variables:"
	refute_output --partial "config var"
}

# Description: init keeps a variable the project has, whatever its value or kind, and sets only
# the others.
# Steps:
#   1. Set BOARD_IP to 10.0.0.5, and BOARD_PASSWORD as a plain variable, plain-pw.
#   2. Run init, with --json; check aa_deploy.sh's .variables names BOARD_USER analog alone.
#   3. Check config var shows BOARD_IP 10.0.0.5 and BOARD_PASSWORD still a plain variable,
#      plain-pw, and BOARD_USER analog.
# bats test_tags=req:INIT-08-LNX, id:L0482
@test "init keeps a variable the project has, and sets only the others" {
	aa config var BOARD_IP 10.0.0.5 >/dev/null
	aa config var BOARD_PASSWORD plain-pw >/dev/null
	run_json init
	assert_success
	assert_json '.scripts[1].variables | tojson' '[{"name":"BOARD_USER","secret":false,"value":"analog"}]'
	[ "$(variable BOARD_IP)" = "project 10.0.0.5" ]
	[ "$(variable BOARD_PASSWORD)" = "project plain-pw" ]
	[ "$(variable BOARD_USER)" = "project analog" ]
}

# Description: a aa_deploy.sh init keeps is the user's: init sets none of its variables.
# Steps:
#   1. Write a aa_deploy.sh of the user's, and run init, with --json.
#   2. Check aa_deploy.sh is reported kept with no variables, aa_build.sh created with none.
#   3. Check the settings file has no variables.
# bats test_tags=req:INIT-08-LNX, id:L0483
@test "a aa_deploy.sh init keeps gets none of the starter's variables" {
	printf '#!/bin/sh\necho mine\n' >"$PROJECT/aa_deploy.sh"
	run_json init
	assert_success
	assert_json '[.scripts[] | "\(.created) \(.variables | tojson)"] | join(",")' 'true [],false []'
	[ "$(variables)" = null ]
}

# Description: init --restore deploy sets the starter's variables the project hasn't, keeps the
# others, and says which it set.
# Steps:
#   1. Run init, then set BOARD_IP to 192.0.2.1 and reset BOARD_USER.
#   2. Run init --restore deploy, with --json; check .variables names BOARD_USER analog alone.
#   3. Check config var shows BOARD_IP 192.0.2.1, BOARD_USER analog, BOARD_PASSWORD a secret.
#   4. Reset BOARD_USER and BOARD_PASSWORD, run init --restore deploy; check it writes the
#      starter's line, then Set variable BOARD_USER = analog and Set variable BOARD_PASSWORD as
#      a secret.
#   5. Run init --restore deploy, with --json; check .variables is empty.
# bats test_tags=req:INIT-08-LNX, id:L0484
@test "init --restore deploy sets the variables the project hasn't, and says which" {
	aa init >/dev/null
	aa config var BOARD_IP 192.0.2.1 >/dev/null
	aa config var BOARD_USER --reset >/dev/null
	run_json init --restore deploy
	assert_success
	assert_json '.variables | tojson' '[{"name":"BOARD_USER","secret":false,"value":"analog"}]'
	[ "$(variable BOARD_IP)" = "project 192.0.2.1" ]
	[ "$(variable BOARD_USER)" = "project analog" ]
	[ "$(variable BOARD_PASSWORD)" = "secret null" ]
	aa config var BOARD_USER --reset >/dev/null
	aa config var BOARD_PASSWORD --reset >/dev/null
	run aa init --restore deploy
	assert_success
	assert_output "Wrote the starter aa_deploy.sh: $PROJECT/aa_deploy.sh
Set variable BOARD_USER = analog
Set variable BOARD_PASSWORD as a secret"
	run_json init --restore deploy
	assert_json '.variables | tojson' '[]'
}

# Description: init --restore build sets no variable: the starter aa_build.sh uses none.
# Steps:
#   1. Run init --restore build, with --json; check it succeeds with .variables empty.
#   2. Check the settings file has no variables.
# bats test_tags=req:INIT-08-LNX, id:L0485
@test "init --restore build sets no variable" {
	run_json init --restore build
	assert_success
	assert_json '.ok' true
	assert_json '.variables | tojson' '[]'
	[ "$(variables)" = null ]
}

# Description: a variable init can't set is a warning: the starter is still written and the
# workfile created, and the variable left out.
# Steps:
#   1. Make the project's settings file read-only.
#   2. Run init, with --json; check it succeeds, the workfile and aa_deploy.sh created, and
#      aa_deploy.sh's .variables empty.
#   3. Check standard error warns, for each of BOARD_IP, BOARD_USER and BOARD_PASSWORD, that the
#      variable of aa_deploy.sh was not set.
#   4. Check the settings file has no variables.
# bats test_tags=req:INIT-08-LNX, id:L0486
@test "a variable init can't set is a warning, and the starter is still written" {
	chmod a-w "$PROJECT/.analog-attach/config.json"
	run_json init
	chmod u+w "$PROJECT/.analog-attach/config.json"
	assert_success
	assert_json '.ok' true
	assert_json '.created' true
	assert_json '[.scripts[] | "\(.created) \(.variables | tojson)"] | join(",")' 'true [],true []'
	local name
	for name in BOARD_IP BOARD_USER BOARD_PASSWORD; do
		[[ "$stderr" == *"warning: the variable $name of aa_deploy.sh was not set: "* ]] || fail "standard error: $stderr"
	done
	[ "$(variables)" = null ]
}
