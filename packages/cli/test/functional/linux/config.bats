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
	rm -f "$PROJECT/.analog-attach/linux/compat-index.json" "$PROJECT/.analog-attach/linux/validation.json" \
		"$PROJECT/.analog-attach/linux/validation.stamp.json"
}

# --- CONFIG-01: every setting --------------------------------------------------------------

# Description: config lists every linux setting, in order, with its category, value, where the
# value comes from and whether it is required.
# Steps:
#   1. Set deploy-user pi with --global.
#   2. Run config, with --json.
#   3. Check it succeeds and lists the nine linux settings in order, in the categories Deploy,
#      General and Workspace.
#   4. Check linux and devicetree are required and overlay-syntax is not.
#   5. Check the sources: linux local, deploy-user global, overlay-syntax default (fragment),
#      deploy-ip unset.
# bats test_tags=req:CONFIG-01, id:L0059
@test "config lists every setting of linux with its category, value, source and whether it is required" {
	aa config deploy-user pi --global
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | join(",")' \
		"backend,linux,devicetree,workfile,overlay-syntax,preprocess-command,deploy-ip,deploy-user,deploy-password"
	assert_json '[.configs[].category] | unique | sort | join(",")' "Deploy,General,Workspace"
	assert_json '.configs[] | select(.field_name == "linux") | .required' true
	assert_json '.configs[] | select(.field_name == "devicetree") | .required' true
	assert_json '.configs[] | select(.field_name == "overlay-syntax") | .required' false
	assert_json '.configs[] | select(.field_name == "linux") | "\(.value) \(.source)"' "$LINUX_TREE local"
	assert_json '.configs[] | select(.field_name == "deploy-user") | "\(.value) \(.source)"' "pi global"
	assert_json '.configs[] | select(.field_name == "overlay-syntax") | "\(.value) \(.source)"' "fragment default"
	assert_json '.configs[] | select(.field_name == "deploy-ip") | "\(.value) \(.source)"' "null unset"
}

# Description: config as text groups the settings under their categories, with each value's
# source and required settings marked.
# Steps:
#   1. Run config.
#   2. Check it succeeds and shows the headings General, Workspace and Deploy.
#   3. Check linux and devicetree are marked required, with their values and source local.
#   4. Check overlay-syntax shows fragment from default, and deploy-ip shows it is not set.
#   5. Check there is a legend for the required mark.
# bats test_tags=req:CONFIG-01, id:L0060
@test "config shows the settings grouped by category, sources and required marked" {
	run aa config
	assert_success
	local category
	for category in General Workspace Deploy; do
		assert_line "  $category"
	done
	assert_line --regexp "^  \* linux +$LINUX_TREE +local$"
	assert_line --regexp '^  \* devicetree +/.*/bcm2711-rpi-4-b\.dts +local$'
	assert_line --regexp '^    overlay-syntax +fragment +default$'
	assert_line --regexp '^    deploy-ip +\(not set\)$'
	assert_line "  * required"
}

# --- CONFIG-02: one setting ----------------------------------------------------------------

# Description: config with one setting's name shows its value, its description and its options.
# Steps:
#   1. Run config overlay-syntax.
#   2. Check it succeeds and shows the value fragment (default), the description and the options
#      fragment and label.
#   3. Run config devicetree, with --json.
#   4. Check it succeeds with one entry, the base devicetree's path as value and a description.
# bats test_tags=req:CONFIG-02, id:L0061
@test "config <key> shows the value, what it is for and its choices" {
	run aa config overlay-syntax
	assert_success
	assert_output --regexp "Value: +fragment +\(default\)"
	assert_output --partial "Description:  Output syntax for the overlay file"
	assert_output --regexp "Options: +fragment, label"
	run_json config devicetree
	assert_success
	assert_json '.configs | length' 1
	assert_json '.configs[0].value' "$LINUX_BASE"
	assert_json '.configs[0].description | length > 0' true
}

# --- CONFIG-03: change a setting -----------------------------------------------------------

# Description: config with a setting and a value sets it, in the project's settings.
# Steps:
#   1. Run config overlay-syntax label, with --json.
#   2. Check it succeeds (.ok true) and says overlay-syntax was set to label.
#   3. Check the project's settings file has overlay-syntax label.
#   4. Run config overlay-syntax, with --json, and check the value is label, source local.
# bats test_tags=req:CONFIG-03, id:L0062
@test "config <key> <value> sets the setting" {
	run_json config overlay-syntax label
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set overlay-syntax = label"
	[ "$(local_setting overlay-syntax)" = '"label"' ]
	run_json config overlay-syntax
	assert_json '.configs[0].value' label
	assert_json '.configs[0].source' local
}

# Description: a value that is not one of the setting's options is refused, saying why, and the
# settings file is not written.
# Steps:
#   1. Keep a copy of the project's settings file.
#   2. Run config overlay-syntax braces.
#   3. Check the message says braces is not one of fragment and label.
#   4. Check the settings file is unchanged.
# bats test_tags=req:CONFIG-03, id:L0063
@test "a value that is not one of the choices is refused with the reason, and nothing is written" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config overlay-syntax braces
	assert_output --partial 'overlay-syntax: "braces" is not one of fragment | label'
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
#   1. Set overlay-syntax label.
#   2. Run config overlay-syntax --reset, with --json.
#   3. Check it succeeds and says overlay-syntax was reset, its default fragment.
#   4. Check config overlay-syntax now gives fragment from default, and the project's settings
#      no longer have it.
# bats test_tags=req:CONFIG-04, id:L0067
@test "config --reset returns a setting to its default" {
	aa config overlay-syntax label
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
#   1. Set overlay-syntax label with --global.
#   2. Check config overlay-syntax, with --json, gives label from global.
#   3. Set deploy-user fromuser with --global, and fromproject in the project.
#   4. Check config deploy-user, with --json, gives fromproject from local.
# bats test_tags=req:CONFIG-05, id:L0069
@test "a user setting applies, and the project's value wins over it" {
	aa config overlay-syntax label --global
	run_json config overlay-syntax
	assert_json '.configs[0].value' label
	assert_json '.configs[0].source' global
	aa config deploy-user fromuser --global
	aa config deploy-user fromproject
	run_json config deploy-user
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
#   2. Run config deploy-ip 192.0.2.1.
#   3. Check the project's settings have it, the user's do not, and src has no settings folder.
# bats test_tags=req:CONFIG-06, id:L0071
@test "a change goes to the project settings when the project has them" {
	mkdir -p "$PROJECT/src"
	cd "$PROJECT/src"
	aa config deploy-ip 192.0.2.1
	[ "$(local_setting deploy-ip)" = '"192.0.2.1"' ]
	[ "$(global_setting deploy-ip)" = null ]
	[ ! -e "$PROJECT/src/.analog-attach" ]
}

# Description: with --global a change goes to the user's settings, not the project's.
# Steps:
#   1. Run config deploy-ip 192.0.2.1 --global.
#   2. Check the user's settings have it and the project's do not.
# bats test_tags=req:CONFIG-06, id:L0072
@test "with --global a change goes to the user settings" {
	aa config deploy-ip 192.0.2.1 --global
	[ "$(global_setting deploy-ip)" = '"192.0.2.1"' ]
	[ "$(local_setting deploy-ip)" = null ]
}

# Description: outside any project, a change creates the project settings in the current folder.
# Steps:
#   1. Go to a new folder outside the project.
#   2. Run config backend linux and check it succeeds.
#   3. Check that folder now has a settings file with backend linux.
#   4. Run config overlay-syntax label and check it succeeds and is stored in that file.
# bats test_tags=req:CONFIG-06, id:L0073
@test "with no project settings, a change creates them in the current directory" {
	mkdir -p "$BATS_TEST_TMPDIR/elsewhere"
	cd "$BATS_TEST_TMPDIR/elsewhere"
	run aa config backend linux
	assert_success
	[ "$(jq -r .backend "$BATS_TEST_TMPDIR/elsewhere/.analog-attach/config.json")" = linux ]
	run aa config overlay-syntax label
	assert_success
	[ "$(jq -r '.linux["overlay-syntax"]' "$BATS_TEST_TMPDIR/elsewhere/.analog-attach/config.json")" = label ]
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
	[ -s "$PROJECT/.analog-attach/linux/validation.json" ]
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
#   4. Check standard error shows the indexing progress and a duration in seconds.
#   5. Check the index and validation files are written.
# bats test_tags=req:CONFIG-08, id:L0077
@test "setting linux builds the caches from that tree, saying it takes a while" {
	no_caches
	run_json config linux "$LINUX_TREE"
	assert_success
	assert_json '.ok' true
	assert_json '.message | test("^Set linux = .*; Indexed [0-9]+ compatibles")' true
	[[ "$stderr" == *"Indexing device bindings and compiling binding schemas..."* ]] || fail "no progress: $stderr"
	[[ "$stderr" =~ in\ [0-9.]+s ]] || fail "no duration: $stderr"
	[ -s "$PROJECT/.analog-attach/linux/compat-index.json" ]
	[ -s "$PROJECT/.analog-attach/linux/validation.json" ]
}

# --- CONFIG-09: one setting per call -------------------------------------------------------

# Description: config sets one setting per call; extra words are refused with a usage error.
# Steps:
#   1. Keep a copy of the project's settings file.
#   2. Run config overlay-syntax label deploy-ip 192.0.2.1.
#   3. Check it fails with a usage error (exit 2), saying overlay-syntax takes one value and got 3.
#   4. Check the settings file is unchanged.
# bats test_tags=req:CONFIG-09, id:L0078
@test "config changes one setting per call" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config overlay-syntax label deploy-ip 192.0.2.1
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
#   2. Set overlay-syntax label, and deploy-user pi with --global.
#   3. Check the project's settings file is JSON with overlay-syntax label under linux.
#   4. Check the user's settings file is JSON with deploy-user pi under linux.
# bats test_tags=req:CONFIG-10, id:L0080
@test "setting names are kebab-case and the settings are stored as JSON" {
	run_json config
	assert_json '[.configs[].field_name | select(test("^[a-z]+(-[a-z]+)*$") | not)] | length' 0
	aa config overlay-syntax label
	aa config deploy-user pi --global
	jq -e '.linux["overlay-syntax"] == "label"' "$PROJECT/.analog-attach/config.json" >/dev/null
	jq -e '.linux["deploy-user"] == "pi"' "$HOME/.config/analog-attach/config.json" >/dev/null
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
#   1. Run config overlay-sintax label.
#   2. Check it fails with a usage error (exit 2) naming the unknown setting.
#   3. Check the message asks whether overlay-syntax was meant.
# bats test_tags=req:CONFIG-11, id:L0082
@test "a mistyped setting is refused, naming the closest setting" {
	run aa config overlay-sintax label
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
