# config where the backend is linux.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree, its settings
# (linux, devicetree, workfile) in the project's settings file, its binding caches in place, no
# user settings and no workfile yet.
setup() {
	load ../helpers
	new_project linux
}

# `local_setting <key>` / `global_setting <key>`: a linux setting as stored in the project's or
# the user's settings file, as JSON (null when not there).
local_setting() {
	jq -c --arg key "$1" '.linux[$key]' "$PROJECT/.analog-attach/config.json"
}
global_setting() {
	local file="$HOME/.config/analog-attach/config.json"
	[ -f "$file" ] || { echo null; return; }
	jq -c --arg key "$1" '.linux[$key]' "$file"
}

# `no_caches`: the project's binding caches removed, as before the first `config linux`.
no_caches() {
	rm -rf "$PROJECT/.analog-attach/linux/compat-index.json" "$PROJECT/.analog-attach/linux/validation-cache"
}

# --- CONFIG-01: every setting --------------------------------------------------------------

# Description: config lists every linux setting, in order, with its category, value, where the
# value comes from and whether it is required.
# Steps:
#   1. Set build-dir out with --global, and reset the project's workfile.
#   2. Run config, with --json.
#   3. Check it succeeds and lists the eight linux settings in order, in the categories Build,
#      General and Workspace.
#   4. Check linux and devicetree are required and overlay-syntax is not.
#   5. Check the sources: linux local, build-dir global, overlay-syntax default (fragment),
#      workfile unset.
# bats test_tags=req:CONFIG-01, id:L0059
@test "config lists every setting of linux with its category, value, source and whether it is required" {
	aa config build-dir out --global
	aa config workfile --reset
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | join(",")' \
		"backend,linux,devicetree,workfile,overlay-syntax,interview,output,build-dir"
	assert_json '[.configs[].category] | unique | sort | join(",")' "Build,General,Workspace"
	assert_json '.configs[] | select(.field_name == "linux") | .required' true
	assert_json '.configs[] | select(.field_name == "devicetree") | .required' true
	assert_json '.configs[] | select(.field_name == "overlay-syntax") | .required' false
	assert_json '.configs[] | select(.field_name == "linux") | "\(.value) \(.source)"' "$LINUX_TREE local"
	assert_json '.configs[] | select(.field_name == "build-dir") | "\(.value) \(.source)"' "out global"
	assert_json '.configs[] | select(.field_name == "overlay-syntax") | "\(.value) \(.source)"' "fragment default"
	assert_json '.configs[] | select(.field_name == "workfile") | "\(.value) \(.source)"' "null unset"
}

# Description: config as text groups the settings under their categories, with each value's
# source and required settings marked.
# Steps:
#   1. Reset the project's workfile, and run config.
#   2. Check it succeeds and shows the headings General, Workspace and Build.
#   3. Check linux and devicetree are marked required, with their values and source local.
#   4. Check overlay-syntax shows fragment from default, and workfile shows it is not set.
#   5. Check there is a legend for the required mark.
# bats test_tags=req:CONFIG-01, id:L0060
@test "config shows the settings grouped by category, sources and required marked" {
	aa config workfile --reset
	run aa config
	assert_success
	local category
	for category in General Workspace Build; do
		assert_line "  $category"
	done
	assert_line --regexp "^  \* linux +$LINUX_TREE +local$"
	assert_line --regexp '^  \* devicetree +/.*/bcm2711-rpi-4-b\.dts +local$'
	assert_line --regexp '^    overlay-syntax +fragment +default$'
	assert_line --regexp '^    workfile +\(not set\)$'
	assert_line "  * required"
}

# --- CONFIG-02: one setting ----------------------------------------------------------------

# Description: config with one setting's name shows its value, its description and its options.
# Steps:
#   1. Run config overlay-syntax.
#   2. Check it succeeds and shows the value fragment (default), the description and the options
#      fragment and reference.
#   3. Run config devicetree, with --json.
#   4. Check it succeeds with one entry, the base devicetree's path as value and a description.
# bats test_tags=req:CONFIG-02, id:L0061
@test "config <key> shows the value, what it is for and its choices" {
	run aa config overlay-syntax
	assert_success
	assert_output --regexp "Value: +fragment +\(default\)"
	assert_output --partial "Description:  fragment: fragment@0 { target = <&spi0>; __overlay__ { … }; };"
	assert_output --regexp "Options: +fragment, reference"
	run_json config devicetree
	assert_success
	assert_json '.configs | length' 1
	assert_json '.configs[0].value' "$LINUX_BASE"
	assert_json '.configs[0].description | length > 0' true
}

# --- CONFIG-03: change a setting -----------------------------------------------------------

# Description: config with a setting and a value sets it, in the project's settings.
# Steps:
#   1. Run config overlay-syntax reference, with --json.
#   2. Check it succeeds (.ok true) and says overlay-syntax was set to reference.
#   3. Check the project's settings file has overlay-syntax reference.
#   4. Run config overlay-syntax, with --json, and check the value is reference, source local.
# bats test_tags=req:CONFIG-03, id:L0062
@test "config <key> <value> sets the setting" {
	run_json config overlay-syntax reference
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set overlay-syntax = reference"
	[ "$(local_setting overlay-syntax)" = '"reference"' ]
	run_json config overlay-syntax
	assert_json '.configs[0].value' reference
	assert_json '.configs[0].source' local
}

# Description: a value that is not one of the setting's options is refused, saying why, and the
# settings file is not written.
# Steps:
#   1. Keep a copy of the project's settings file.
#   2. Run config overlay-syntax braces.
#   3. Check the message says braces is not one of fragment and reference.
#   4. Check the settings file is unchanged.
# bats test_tags=req:CONFIG-03, id:L0063
@test "a value that is not one of the choices is refused with the reason, and nothing is written" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config overlay-syntax braces
	assert_output --partial 'overlay-syntax: "braces" is not one of fragment | reference'
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# Description: a path setting given a path that does not exist is refused, saying why.
# Steps:
#   1. Run config devicetree with a file that does not exist and check the message says it does
#      not exist.
#   2. Run config linux with a folder that does not exist and check the same.
#   3. Check devicetree and linux keep their values in the project's settings.
# bats test_tags=req:CONFIG-03, id:L0064
@test "a path that does not exist is refused with the reason" {
	run aa config devicetree "$BATS_TEST_TMPDIR/nowhere.dts"
	assert_output --partial "devicetree: $BATS_TEST_TMPDIR/nowhere.dts does not exist"
	run aa config linux "$BATS_TEST_TMPDIR/nowhere"
	assert_output --partial "linux: $BATS_TEST_TMPDIR/nowhere does not exist"
	[ "$(local_setting devicetree)" = "\"$LINUX_BASE\"" ]
	[ "$(local_setting linux)" = "\"$LINUX_TREE\"" ]
}

# Description: a folder that is not a Linux source tree is refused as the linux setting.
# Steps:
#   1. Run config linux with the test's temporary folder.
#   2. Check the message says it has no Documentation/devicetree/bindings/ and is not a Linux
#      source tree.
#   3. Check linux keeps its value.
# bats test_tags=req:CONFIG-03, id:L0065
@test "a directory that is not a Linux tree is refused as linux" {
	run aa config linux "$BATS_TEST_TMPDIR"
	assert_output --partial "linux: no Documentation/devicetree/bindings/ under $BATS_TEST_TMPDIR (not a Linux source tree)"
	[ "$(local_setting linux)" = "\"$LINUX_TREE\"" ]
}

# Description: workfile takes a file that does not exist yet, which init will create, but not one
# in a folder that does not exist.
# Steps:
#   1. Run config workfile with a new file in the project, with --json.
#   2. Check it succeeds (.ok true) and the message says the file is not created yet.
#   3. Check the setting is stored and the file was not created.
#   4. Run config workfile with a file in a folder that does not exist.
#   5. Check the message says the folder is not a directory, and the setting keeps the first file.
# bats test_tags=req:CONFIG-03, id:L0066
@test "workfile takes a file init will create, but not one in a folder that does not exist" {
	run_json config workfile "$PROJECT/new.dtso"
	assert_json '.ok' true
	assert_json '.message | test("not created yet")' true
	[ "$(local_setting workfile)" = "\"$PROJECT/new.dtso\"" ]
	[ ! -e "$PROJECT/new.dtso" ]
	run aa config workfile "$BATS_TEST_TMPDIR/nowhere/overlay.dtso"
	assert_output --partial "workfile: $BATS_TEST_TMPDIR/nowhere is not a directory"
	[ "$(local_setting workfile)" = "\"$PROJECT/new.dtso\"" ]
}

# --- CONFIG-04: reset ----------------------------------------------------------------------

# Description: config --reset returns a setting with a default to that default.
# Steps:
#   1. Set overlay-syntax reference.
#   2. Run config overlay-syntax --reset, with --json.
#   3. Check it succeeds and says overlay-syntax was reset, its default fragment.
#   4. Check config overlay-syntax now gives fragment from default, and the project's settings
#      no longer have it.
# bats test_tags=req:CONFIG-04, id:L0067
@test "config --reset returns a setting to its default" {
	aa config overlay-syntax reference
	run_json config overlay-syntax --reset
	assert_success
	assert_json '.message' "Reset overlay-syntax (default: fragment)"
	run_json config overlay-syntax
	assert_json '.configs[0].value' fragment
	assert_json '.configs[0].source' default
	[ "$(local_setting overlay-syntax)" = null ]
}

# Description: config --reset on a setting without a default unsets it.
# Steps:
#   1. Run config devicetree --reset, with --json.
#   2. Check it succeeds and says devicetree was reset and is not set.
#   3. Check config devicetree gives no value, source unset, and the project's settings no longer
#      have it.
# bats test_tags=req:CONFIG-04, id:L0068
@test "config --reset unsets a setting that has no default" {
	run_json config devicetree --reset
	assert_success
	assert_json '.message' "Reset devicetree (not set)"
	run_json config devicetree
	assert_json '.configs[0].value' null
	assert_json '.configs[0].source' unset
	[ "$(local_setting devicetree)" = null ]
}

# --- CONFIG-05: user and project settings --------------------------------------------------

# Description: a user setting applies when the project has none, and the project's value is
# taken over the user's.
# Steps:
#   1. Set overlay-syntax reference with --global.
#   2. Check config overlay-syntax, with --json, gives reference from global.
#   3. Set build-dir fromuser with --global, and fromproject in the project.
#   4. Check config build-dir, with --json, gives fromproject from local.
# bats test_tags=req:CONFIG-05, id:L0069
@test "a user setting applies, and the project's value wins over it" {
	aa config overlay-syntax reference --global
	run_json config overlay-syntax
	assert_json '.configs[0].value' reference
	assert_json '.configs[0].source' global
	aa config build-dir fromuser --global
	aa config build-dir fromproject
	run_json config build-dir
	assert_json '.configs[0].value' fromproject
	assert_json '.configs[0].source' local
}

# Description: the project's settings are found when the CLI runs from a subfolder of the project.
# Steps:
#   1. Make the folder src/deep in the project and go there.
#   2. Run config devicetree, with --json.
#   3. Check it succeeds with the base devicetree's path, source local.
# bats test_tags=req:CONFIG-05, id:L0070
@test "the project settings are found from a subdirectory" {
	mkdir -p "$PROJECT/src/deep"
	cd "$PROJECT/src/deep"
	run_json config devicetree
	assert_success
	assert_json '.configs[0].value' "$LINUX_BASE"
	assert_json '.configs[0].source' local
}

# --- CONFIG-06: where a change goes --------------------------------------------------------

# Description: a change made from inside a project goes to the project's settings, not the user's
# and not a new settings folder.
# Steps:
#   1. Go to a subfolder src of the project.
#   2. Run config build-dir out.
#   3. Check the project's settings have it, the user's do not, and src has no settings folder.
# bats test_tags=req:CONFIG-06, id:L0071
@test "a change goes to the project settings when the project has them" {
	mkdir -p "$PROJECT/src"
	cd "$PROJECT/src"
	aa config build-dir out
	[ "$(local_setting build-dir)" = '"out"' ]
	[ "$(global_setting build-dir)" = null ]
	[ ! -e "$PROJECT/src/.analog-attach" ]
}

# Description: with --global a change goes to the user's settings, not the project's.
# Steps:
#   1. Run config build-dir out --global.
#   2. Check the user's settings have it and the project's do not.
# bats test_tags=req:CONFIG-06, id:L0072
@test "with --global a change goes to the user settings" {
	aa config build-dir out --global
	[ "$(global_setting build-dir)" = '"out"' ]
	[ "$(local_setting build-dir)" = null ]
}

# Description: outside any project, a change creates the project settings in the current folder.
# Steps:
#   1. Go to a new folder outside the project.
#   2. Run config backend linux and check it succeeds.
#   3. Check that folder now has a settings file with backend linux.
#   4. Run config overlay-syntax reference and check it succeeds and is stored in that file.
# bats test_tags=req:CONFIG-06, id:L0073
@test "with no project settings, a change creates them in the current directory" {
	mkdir -p "$BATS_TEST_TMPDIR/elsewhere"
	cd "$BATS_TEST_TMPDIR/elsewhere"
	run aa config backend linux
	assert_success
	[ "$(jq -r .backend "$BATS_TEST_TMPDIR/elsewhere/.analog-attach/config.json")" = linux ]
	run aa config overlay-syntax reference
	assert_success
	[ "$(jq -r '.linux["overlay-syntax"]' "$BATS_TEST_TMPDIR/elsewhere/.analog-attach/config.json")" = reference ]
}

# --- CONFIG-07, CONFIG-08: caches ----------------------------------------------------------

# Description: config --reload rebuilds the binding index and the validation data from the Linux
# tree.
# Steps:
#   1. Remove the project's binding caches.
#   2. Run config --reload, with --json.
#   3. Check it succeeds (.ok true) and says how many compatibles it indexed from how many bindings.
#   4. Check the index and validation files are written again, the index mapping adi,adxl345 to
#      its binding file.
# bats test_tags=req:CONFIG-07, req:CONFIG-07-LNX, id:L0074
@test "config --reload rebuilds the binding index and the validation data from the Linux tree" {
	no_caches
	run_json config --reload
	assert_success
	assert_json '.ok' true
	assert_json '.message | test("^Indexed [0-9]+ compatibles from [0-9]+ bindings and compiled binding schemas in ")' true
	[ -s "$PROJECT/.analog-attach/linux/compat-index.json" ]
	[ -s "$PROJECT/.analog-attach/linux/validation-cache/validation.json" ]
	jq -e '.entries["adi,adxl345"] | test("adi,adxl345.yaml$")' "$PROJECT/.analog-attach/linux/compat-index.json" >/dev/null
}

# Description: config --reload as text says what it rebuilt.
# Steps:
#   1. Run config --reload, standard error kept apart.
#   2. Check it succeeds and prints only that it rebuilt the binding index and validation.json.
# bats test_tags=req:CONFIG-07, id:L0075
@test "config --reload in human mode says what it rebuilt" {
	run --separate-stderr aa config --reload
	assert_success
	assert_output "Rebuilt the binding index and validation.json."
}

# Description: config --reload without the linux setting says the setting is missing and how to
# set it.
# Steps:
#   1. Remove the linux setting.
#   2. Run config --reload.
#   3. Check the message names the missing linux setting and the config linux <path> command.
# bats test_tags=req:CONFIG-07-LNX, id:L0076
@test "config --reload with no Linux tree names the setting" {
	drop_setting linux
	run aa config --reload
	assert_output --partial "Missing config field linux"
	assert_output --partial "analog-attach config linux <path>"
}

# Description: setting linux builds the binding caches from that tree, showing progress and how
# long it took.
# Steps:
#   1. Remove the project's binding caches.
#   2. Run config linux with the Linux tree, with --json.
#   3. Check it succeeds (.ok true) and the message says linux was set and the bindings indexed.
#   4. Check standard error shows the indexing progress and how long it took (seconds, or
#      minutes and seconds on a slow machine: 2m 37s).
#   5. Check the index and validation files are written.
# bats test_tags=req:CONFIG-08, id:L0077
@test "setting linux builds the caches from that tree, saying it takes a while" {
	no_caches
	run_json config linux "$LINUX_TREE"
	assert_success
	assert_json '.ok' true
	assert_json '.message | test("^Set linux = .*; Indexed [0-9]+ compatibles")' true
	[[ "$stderr" == *"Indexing device bindings and compiling binding schemas..."* ]] || fail "no progress: $stderr"
	[[ "$stderr" =~ in\ ([0-9]+m\ )?[0-9.]+s ]] || fail "no duration: $stderr"
	[ -s "$PROJECT/.analog-attach/linux/compat-index.json" ]
	[ -s "$PROJECT/.analog-attach/linux/validation-cache/validation.json" ]
}

# --- CONFIG-09: one setting per call -------------------------------------------------------

# Description: config sets one setting per call; extra words are refused with a usage error.
# Steps:
#   1. Keep a copy of the project's settings file.
#   2. Run config overlay-syntax reference build-dir out.
#   3. Check it fails with a usage error (exit 2), saying overlay-syntax takes one value and got 3.
#   4. Check the settings file is unchanged.
# bats test_tags=req:CONFIG-09, id:L0078
@test "config changes one setting per call" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config overlay-syntax reference build-dir out
	assert_failure 2
	assert_output --partial "overlay-syntax takes one value; got 3"
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# Description: config with a setting's name shows that one setting only.
# Steps:
#   1. Run config overlay-syntax, with --json.
#   2. Check there is one entry and the message says 1 config field.
# bats test_tags=req:CONFIG-09, id:L0079
@test "config shows one setting when given a key" {
	run_json config overlay-syntax
	assert_json '.configs | length' 1
	assert_json '.message' "1 config field(s)"
}

# --- CONFIG-10: names and storage ----------------------------------------------------------

# Description: every setting name is kebab-case, and the project's and the user's settings are
# stored as JSON.
# Steps:
#   1. Run config, with --json, and check no setting name breaks the kebab-case pattern.
#   2. Set overlay-syntax reference, and build-dir out with --global.
#   3. Check the project's settings file is JSON with overlay-syntax reference under linux.
#   4. Check the user's settings file is JSON with build-dir out under linux.
# bats test_tags=req:CONFIG-10, id:L0080
@test "setting names are kebab-case and the settings are stored as JSON" {
	run_json config
	assert_json '[.configs[].field_name | select(test("^[a-z]+(-[a-z]+)*$") | not)] | length' 0
	aa config overlay-syntax reference
	aa config build-dir out --global
	jq -e '.linux["overlay-syntax"] == "reference"' "$PROJECT/.analog-attach/config.json" >/dev/null
	jq -e '.linux["build-dir"] == "out"' "$HOME/.config/analog-attach/config.json" >/dev/null
}

# --- CONFIG-11: unknown setting ------------------------------------------------------------

# Description: an unknown setting is refused with a usage error that lists the valid settings.
# Steps:
#   1. Run config nosuchkey 1.
#   2. Check it fails with a usage error (exit 2) naming the unknown setting.
#   3. Check the message names valid settings such as devicetree and overlay-syntax.
# bats test_tags=req:CONFIG-11, id:L0081
@test "an unknown setting is refused, naming the valid ones" {
	run aa config nosuchkey 1
	assert_failure 2
	assert_output --partial "Unknown config field: nosuchkey"
	assert_output --partial "devicetree"
	assert_output --partial "overlay-syntax"
}

# Description: a mistyped setting is refused, the message suggesting the closest valid setting.
# Steps:
#   1. Run config overlay-sintax reference.
#   2. Check it fails with a usage error (exit 2) naming the unknown setting.
#   3. Check the message asks whether overlay-syntax was meant.
# bats test_tags=req:CONFIG-11, id:L0082
@test "a mistyped setting is refused, naming the closest setting" {
	run aa config overlay-sintax reference
	assert_failure 2
	assert_output --partial "Unknown config field: overlay-sintax"
	assert_output --partial "Did you mean overlay-syntax?"
}

# --- GEN-13: a command that needs a setting --------------------------------------------------

# Description: a command that needs a setting that is not set names it and says how to set it.
# Steps:
#   1. Remove the linux setting.
#   2. Run read.
#   3. Check the message names the missing linux setting and the config linux <path> command.
# bats test_tags=req:GEN-13, id:L0083
@test "a command that needs an unset setting names it" {
	# The exit status differs by mode today (0 as text, 2 with --json): gen.bats checks it.
	drop_setting linux
	run aa read
	assert_output --partial "Missing config field linux"
	assert_output --partial "analog-attach config linux <path>"
}

# --- SET-15-LNX: script variables ----------------------------------------------------------

# `variable <name> <jq>`: <jq> applied to the entry of config var --json for <name>.
variable() {
	aa --json config var | jq -r --arg name "$1" ".variables[] | select(.name == \$name) | $2"
}

# Description: config var lists the system variables, in order, with their values and the
# scripts that get each, and then the project's.
# Steps:
#   1. Set the project variable BOARD_IP 192.0.2.1 and check the answer.
#   2. Run config var, with --json, and check the names: the system variables first in the order
#      of COM-153, then the executable ones AA_BUILD, AA_DEPLOY and AA_PREPROCESS_COMMAND, and
#      BOARD_IP last, and the message counts fifteen.
#   3. Check AA_PROJECT is the project, of kind system, for build, deploy and preprocess, AA_DTS
#      and AA_DTC are for build only, and AA_PREPROCESS_INPUT for preprocess only.
#   4. Check BOARD_IP is 192.0.2.1, of kind project, for build, deploy and preprocess.
#   5. Check the project's settings file has it under linux.variables.
# bats test_tags=req:SET-15-LNX, req:CONFIG-03, id:L0417
@test "config var lists the system variables and the project's" {
	run aa config var BOARD_IP 192.0.2.1
	assert_success
	assert_output "Set variable BOARD_IP = 192.0.2.1"
	run_json config var
	assert_json '[.variables[].name] | join(",")' \
		"AA_PROJECT,AA_OUTPUT,AA_BUILD_DIR,AA_DTSO,AA_DTBO,AA_DTS,AA_DTB,AA_DTC,AA_LINUX,AA_PREPROCESS_INPUT,AA_PREPROCESS_OUTPUT,AA_BUILD,AA_DEPLOY,AA_PREPROCESS_COMMAND,BOARD_IP"
	assert_json '.message' "15 variable(s)"
	[ "$(variable AA_PROJECT '"\(.value) \(.kind) \(.scripts | join("+"))"')" = "$PROJECT system build+deploy+preprocess" ]
	[ "$(variable AA_DTS '.scripts | join("+")')" = build ]
	[ "$(variable AA_DTC '.scripts | join("+")')" = build ]
	[ "$(variable AA_PREPROCESS_INPUT '"\(.value) \(.scripts | join("+"))"')" = "null preprocess" ]
	[ "$(variable BOARD_IP '"\(.value) \(.kind) \(.scripts | join("+"))"')" = "192.0.2.1 project build+deploy+preprocess" ]
	[ "$(local_setting variables)" = '{"BOARD_IP":"192.0.2.1"}' ]
}

# Description: config shows the variables after the settings, and config var <NAME> one of them.
# Steps:
#   1. Run config, and check it has the Variables heading, an AA_PROJECT line, an AA_BUILD line
#      (executable, its default) and the hint that the project has no variables.
#   2. Set BOARD_IP 192.0.2.1, and run config var BOARD_IP.
#   3. Check it shows its value, kind and scripts.
#   4. Run config var BORD_IP, and check it is refused, suggesting BOARD_IP.
# bats test_tags=req:SET-15-LNX, req:CONFIG-01, id:L0418
@test "config shows the variables, and config var <NAME> one of them" {
	run aa config
	assert_success
	assert_line "  Variables"
	assert_line --regexp "^    AA_PROJECT +$PROJECT +system, build, deploy and preprocess$"
	assert_line --regexp '^    AA_BUILD +\./aa_build\.sh +executable \(default\), run by build$'
	assert_line "  No project variables: analog-attach config var <NAME> <value>, or --secret for a password."
	aa config var BOARD_IP 192.0.2.1
	run aa config var BOARD_IP
	assert_success
	assert_line --regexp '^  Value: +192\.0\.2\.1$'
	assert_line --regexp '^  Kind: +project$'
	assert_line --regexp '^  Scripts: +build, deploy, preprocess$'
	run_json config var BORD_IP
	assert_json '.ok' false
	assert_json '.error_type' not-found
	assert_json '.message' "Unknown variable BORD_IP. Did you mean BOARD_IP? Set it with analog-attach config var BORD_IP <value>."
}

# Description: config var refuses a name that isn't a variable's or is the system's, a --global
# one and an empty value, and --reset removes a variable.
# Steps:
#   1. Run config var AA_BOARD 1, with --json, and check it is refused as invalid-name.
#   2. Run config var 1BOARD 1, with --json, and check it is refused as invalid-name.
#   3. Run config var AA_DTC --reset, with --json, and check it is refused as read-only.
#   4. Run config var BOARD_IP 192.0.2.1 --global, and check it is refused, with nothing in the
#      user's settings file.
#   5. Run config var BOARD_IP with an empty value, and check it is refused.
#   6. Set BOARD_IP, reset it, check the answer, and check the settings file has no variables.
# bats test_tags=req:SET-15-LNX, id:L0419
@test "config var refuses system and invalid names, --global and empty values; --reset removes one" {
	run_json config var AA_BOARD 1
	assert_json '.ok' false
	assert_json '.error_type' invalid-name
	assert_json '.message' "AA_BOARD starts with AA_, the system variables' prefix"
	run_json config var 1BOARD 1
	assert_json '.error_type' invalid-name
	assert_json '.message' '"1BOARD" is not a variable name: letters, digits and _, not starting with a digit'
	run_json config var AA_DTC --reset
	assert_json '.error_type' read-only
	run_json config var BOARD_IP 192.0.2.1 --global
	assert_json '.ok' false
	assert_json '.message' "Variables belong to the project and can't be in the global settings: set them without --global"
	[ "$(global_setting variables)" = null ]
	run_json config var BOARD_IP ""
	assert_json '.ok' false
	assert_json '.message' "BOARD_IP: must not be empty: analog-attach config var BOARD_IP --reset removes it"
	[ "$(local_setting variables)" = null ]
	aa config var BOARD_IP 192.0.2.1
	run aa config var BOARD_IP --reset
	assert_success
	assert_output "Reset variable BOARD_IP (not set)"
	[ "$(local_setting variables)" = null ]
}

# --- SET-16-LNX: secrets -------------------------------------------------------------------

# Description: a secret is stored by name only, for deploy only, and config says whether the
# environment has its value.
# Steps:
#   1. Set BOARD_PASSWORD as a plain variable, then with --secret, and check the answer says the
#      stored value was removed.
#   2. Check the project's settings file has BOARD_PASSWORD as {"secret": true} and no value.
#   3. Run config var BOARD_PASSWORD, with --json, and check it is a secret with no value, for
#      deploy only, not in the environment.
#   4. Run it again with BOARD_PASSWORD in the environment, and check in_environment is true and
#      the value is still null.
#   5. Run config var BOARD_PASSWORD x, and check it is refused, the file unchanged.
# bats test_tags=req:SET-16-LNX, id:L0420
@test "a secret is stored by name only, and config says whether the environment has it" {
	aa config var BOARD_PASSWORD hunter2
	run aa config var BOARD_PASSWORD --secret
	assert_success
	assert_output "Set variable BOARD_PASSWORD as a secret (its stored value removed)"
	[ "$(local_setting variables)" = '{"BOARD_PASSWORD":{"secret":true}}' ]
	run ! grep -r hunter2 "$PROJECT/.analog-attach"
	run_json config var BOARD_PASSWORD
	assert_json '.variables[0] | "\(.kind) \(.value) \(.scripts | join("+")) \(.in_environment)"' "secret null deploy false"
	BOARD_PASSWORD=from-env run_json config var BOARD_PASSWORD
	assert_json '.variables[0] | "\(.value) \(.in_environment)"' "null true"
	run_json config var BOARD_PASSWORD x
	assert_json '.ok' false
	assert_json '.error_type' invalid-setting
	[ "$(local_setting variables)" = '{"BOARD_PASSWORD":{"secret":true}}' ]
}

# --- SET-17-LNX: the executable variables ----------------------------------------------

# Description: AA_BUILD, AA_DEPLOY and AA_PREPROCESS_COMMAND are executable variables: config var
# sets one (several lines too), shows it with its default and the step that runs it, never makes
# it a secret nor empty, and --reset goes back to the default.
# Steps:
#   1. Run config var AA_BUILD, and check its value is ./aa_build.sh, of kind executable, run by
#      build, the default in use.
#   2. Set AA_BUILD to a two-line command, and check the answer and that the project's settings
#      file has it under linux.variables.
#   3. Run config var AA_BUILD, with --json, and check value, kind, runs, default and that no
#      script gets it; and as text that the list's line is executable, run by build.
#   4. Run config var AA_BUILD --secret, with --json, and check it is refused as invalid-setting,
#      the file unchanged.
#   5. Run config var AA_DEPLOY with a value of spaces, with --json, and check it is refused.
#   6. Run config var AA_BUILD --reset, and check the answer names the default and the file has
#      no variables.
# bats test_tags=req:SET-17-LNX, req:SET-16-LNX, id:L0492
@test "config var sets, shows and resets an executable variable, never a secret" {
	run aa config var AA_BUILD
	assert_success
	assert_line --regexp '^  Value: +\./aa_build\.sh$'
	assert_line --regexp '^  Kind: +executable$'
	assert_line --regexp '^  Runs: +build$'
	assert_line --regexp '^  Default: +\./aa_build\.sh \(in use\)$'
	run aa config var AA_BUILD $'mkdir -p "$AA_BUILD_DIR"\nmake overlay'
	assert_success
	assert_output $'Set variable AA_BUILD = mkdir -p "$AA_BUILD_DIR"\nmake overlay'
	[ "$(local_setting variables)" = '{"AA_BUILD":"mkdir -p \"$AA_BUILD_DIR\"\nmake overlay"}' ]
	run_json config var AA_BUILD
	assert_json '.variables[0] | "\(.kind) \(.runs) \(.default) \(.scripts | length)"' "executable build ./aa_build.sh 0"
	assert_json '.variables[0].value' $'mkdir -p "$AA_BUILD_DIR"\nmake overlay'
	run aa config var
	assert_line --regexp '^    AA_BUILD +mkdir -p "\$AA_BUILD_DIR" … +executable, run by build$'
	run_json config var AA_BUILD --secret
	assert_json '.ok' false
	assert_json '.error_type' invalid-setting
	assert_json '.message' "AA_BUILD is a command linux runs, and can't be a secret: put a password in a secret of its own, which deploy gets"
	[ "$(local_setting variables)" = '{"AA_BUILD":"mkdir -p \"$AA_BUILD_DIR\"\nmake overlay"}' ]
	run_json config var AA_DEPLOY "  "
	assert_json '.ok' false
	assert_json '.message' "AA_DEPLOY: must not be empty: analog-attach config var AA_DEPLOY --reset goes back to the default, ./aa_deploy.sh"
	run aa config var AA_BUILD --reset
	assert_success
	assert_output "Reset variable AA_BUILD (default ./aa_build.sh)"
	[ "$(local_setting variables)" = null ]
}

# Description: preprocess-command is no setting of linux any more: the C preprocessor is the
# executable variable AA_PREPROCESS_COMMAND, and the key left in a settings file is unknown.
# Steps:
#   1. Run config preprocess-command cpp, and check it fails with a usage error naming it.
#   2. Write preprocess-command into the project's settings file, run config, with --json, and
#      check it reports the unknown key linux.preprocess-command.
# bats test_tags=req:SET-17-LNX, req:SET-04, req:CONFIG-11, id:L0493
@test "preprocess-command is an unknown setting" {
	run aa config preprocess-command cpp
	assert_failure 2
	assert_output --partial "Unknown config field: preprocess-command"
	local file="$PROJECT/.analog-attach/config.json"
	jq '.linux["preprocess-command"] = "cpp"' "$file" >"$file.new" && mv "$file.new" "$file"
	run aa --json config
	assert_output --partial "unknown key linux.preprocess-command"
}

# --- CONFIG-11: the removed build and deploy settings -------------------------------------

# Description: build-command, deploy-command, deploy-ip, deploy-user and deploy-password are no
# settings of linux.
# Steps:
#   1. For each of the five, run config <key> x.
#   2. Check each fails with a usage error (exit 2) naming the unknown setting.
# bats test_tags=req:CONFIG-11, id:L0421
@test "the removed build and deploy settings are unknown" {
	local key
	for key in build-command deploy-command deploy-ip deploy-user deploy-password; do
		run aa config "$key" x
		assert_failure 2
		assert_output --partial "Unknown config field: $key"
	done
}
