# Examples: config where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet, and no
# user settings file. local_setting and global_setting read a setting from the project's or the
# user's settings file.
setup() {
	load ../helpers
	new_project noos
}

# Description: config --reset returns a setting to its default value.
# Steps:
#   1. Set probe to jlink.
#   2. Run config probe --reset; check it succeeds.
#   3. Show config probe, with --json; check it is openocd, from the default.
# bats test_tags=req:CONFIG-04, id:N0055
@test "config --reset returns a setting to its default" {
	aa config probe jlink
	run aa config probe --reset
	assert_success
	run_json config probe
	assert_success
	assert_json '.configs[0].value' openocd
	assert_json '.configs[0].source' default
}

# Description: an unknown setting is a usage error, and the message lists the valid settings.
# Steps:
#   1. Run config nosuchkey 1.
#   2. Check it fails with a usage error (exit 2), calling the setting unknown and naming
#      capi-path among the valid ones.
# bats test_tags=req:CONFIG-11, id:N0056
@test "an unknown setting is refused, naming the valid ones" {
	run aa config nosuchkey 1
	assert_failure 2
	assert_output --partial "Unknown config field: nosuchkey"
	assert_output --partial "capi-path"
}

# Description: init creates the workfile, and a second init refuses to overwrite it.
# Steps:
#   1. Run init, with --json; check it succeeds, reports it created the workfile, and the file
#      is there.
#   2. Run init again, with --json; check it is refused (.ok false).
# bats test_tags=req:INIT-01, req:INIT-02, id:N0057
@test "init creates the workfile, then refuses to overwrite it" {
	run_json init
	assert_success
	assert_json '.created' true
	[ -f "$PROJECT/workfile.json" ]
	run_json init
	assert_json '.ok' false
}

# `local_setting <key>` / `global_setting <key>`: a noos setting as stored in the project's or
# the user's settings file, as JSON (null when not there).
local_setting() {
	jq -c --arg key "$1" '.noos[$key]' "$PROJECT/.analog-attach/config.json"
}
global_setting() {
	local file="$HOME/.config/analog-attach/config.json"
	[ -f "$file" ] || { echo null; return; }
	jq -c --arg key "$1" '.noos[$key]' "$file"
}

# --- CONFIG-01: every setting --------------------------------------------------------------

# Description: config lists every noos setting with its category, value, source, and whether it
# is required.
# Steps:
#   1. Set probe to jlink in the user settings.
#   2. Run config, with --json; check it succeeds.
#   3. Check it lists the noos settings in order, with the categories General, Sources, Target,
#      Workfile, Project and Build.
#   4. Check capi-path is required and probe is not.
#   5. Check the values and sources: target from the project, probe from the user, bootstrap
#      true by default, project-name unset.
# bats test_tags=req:CONFIG-01, id:N0058
@test "config lists every setting of noos with its category, value, source and whether it is required" {
	aa config probe jlink --global
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | join(",")' \
		"backend,capi-path,module-paths,target,workfile,bootstrap,interview,project-name,project-path,project-template,example,build-command,deploy-command,probe,build-dir"
	assert_json '[.configs[].category] | unique | sort | join(",")' "Build,General,Project,Sources,Target,Workfile"
	assert_json '.configs[] | select(.field_name == "capi-path") | .required' true
	assert_json '.configs[] | select(.field_name == "probe") | .required' false
	assert_json '.configs[] | select(.field_name == "target") | "\(.value) \(.source)"' "otherboard local"
	assert_json '.configs[] | select(.field_name == "probe") | "\(.value) \(.source)"' "jlink global"
	assert_json '.configs[] | select(.field_name == "bootstrap") | "\(.value) \(.source)"' "true default"
	assert_json '.configs[] | select(.field_name == "project-name") | "\(.value) \(.source)"' "null unset"
}

# Description: config without --json shows the settings grouped by category, with their
# sources, and marks the required ones.
# Steps:
#   1. Run config.
#   2. Check it succeeds, with a heading for each category.
#   3. Check capi-path is marked required, with its path and source local; probe shows openocd,
#      default; project-name shows not set.
#   4. Check there is a legend for the required mark.
# bats test_tags=req:CONFIG-01, id:N0059
@test "config shows the settings grouped by category, sources and required marked" {
	run aa config
	assert_success
	local category
	for category in General Sources Target Workfile Project Build; do
		assert_line "  $category"
	done
	assert_line --regexp '^  \* capi-path +/.*/capi +local$'
	assert_line --regexp '^    probe +openocd +default$'
	assert_line --regexp '^    project-name +\(not set\)$'
	assert_line "  * required"
}

# --- CONFIG-02: one setting ----------------------------------------------------------------

# Description: config <key> shows the setting's value, description and choices.
# Steps:
#   1. Run config probe; check it succeeds, showing openocd as the default, the description, and
#      the options openocd and jlink.
#   2. Show config target, with --json; check it gives one setting, otherboard, with a
#      description and the target choices of the fixture.
# bats test_tags=req:CONFIG-02, id:N0060
@test "config <key> shows the value, what it is for and its choices" {
	run aa config probe
	assert_success
	assert_output --regexp "Value: +openocd +\(default\)"
	assert_output --partial "Description:  Debug probe 'deploy' flashes through"
	assert_output --regexp "Options: +openocd, jlink"
	run_json config target
	assert_success
	assert_json '.configs | length' 1
	assert_json '.configs[0].value' otherboard
	assert_json '.configs[0].description | length > 0' true
	assert_json '.configs[0].type.options | join(",")' "testboard,otherboard,twobusboard,testsoc,othersoc,boardless"
}

# --- CONFIG-03: change a setting -----------------------------------------------------------

# Description: config <key> <value> sets the setting in the project settings.
# Steps:
#   1. Set probe to jlink, with --json; check it succeeds, saying probe is set to jlink.
#   2. Check the project settings file has probe jlink.
#   3. Show config probe, with --json; check it is jlink, from the project settings.
# bats test_tags=req:CONFIG-03, id:N0061
@test "config <key> <value> sets the setting" {
	run_json config probe jlink
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set probe = jlink"
	[ "$(local_setting probe)" = '"jlink"' ]
	run_json config probe
	assert_json '.configs[0].value' jlink
	assert_json '.configs[0].source' local
}

# Description: a value outside a setting's choices is refused, with the reason, and the
# settings file is not written.
# Steps:
#   1. Keep the project settings file's contents.
#   2. Set probe to stlink; check it exits 0 and says stlink is not one of the probes.
#   3. Set bootstrap to yes; check it exits 0 and says yes is not true or false.
#   4. Set target to nosuchboard; check it exits 0 and says it is not one of the targets.
#   5. Check the project settings file didn't change.
# bats test_tags=req:CONFIG-03, id:N0062
@test "a value that is not one of the choices is refused with the reason, and nothing is written" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config probe stlink
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial 'probe: "stlink" is not one of openocd | jlink'
	run aa config bootstrap yes
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial 'bootstrap: "yes" is not true or false'
	run aa config target nosuchboard
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial 'target: "nosuchboard" is not one of testboard | otherboard'
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# Description: a path setting given a path that doesn't exist is refused, with the reason.
# Steps:
#   1. Set capi-path to a missing directory; check it exits 0 and says the path does not exist.
#   2. Set module-paths to the platform and a missing directory; check it exits 0 and says the
#      missing one does not exist.
#   3. Check capi-path in the project settings is still the fixture's capi.
# bats test_tags=req:CONFIG-03, id:N0063
@test "a path that does not exist is refused with the reason" {
	run aa config capi-path "$BATS_TEST_TMPDIR/nowhere"
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "capi-path: $BATS_TEST_TMPDIR/nowhere does not exist"
	run aa config module-paths "$NOOS_FIXTURES/platform" "$BATS_TEST_TMPDIR/nowhere"
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "module-paths: $BATS_TEST_TMPDIR/nowhere does not exist"
	[ "$(local_setting capi-path)" = "\"$NOOS_FIXTURES/capi\"" ]
}

# Description: capi-path refuses a directory that is not a capi checkout.
# Steps:
#   1. Set capi-path to the test's temporary directory.
#   2. Check it exits 0 and says it is not a capi checkout, having no module.yml.
# bats test_tags=req:CONFIG-03, id:N0064
@test "a directory that is not a capi checkout is refused as capi-path" {
	run aa config capi-path "$BATS_TEST_TMPDIR"
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "is not a capi checkout (it has no module.yml)"
}

# --- CONFIG-04: reset ----------------------------------------------------------------------

# Description: config --reset unsets a setting that has no default.
# Steps:
#   1. Set project-name to myproject.
#   2. Run config project-name --reset, with --json; check it succeeds, saying it is not set.
#   3. Show config project-name, with --json; check it has no value and its source is unset.
#   4. Check the project settings file no longer has project-name.
# bats test_tags=req:CONFIG-04, id:N0065
@test "config --reset unsets a setting that has no default" {
	aa config project-name myproject
	run_json config project-name --reset
	assert_success
	assert_json '.message' "Reset project-name (not set)"
	run_json config project-name
	assert_json '.configs[0].value' null
	assert_json '.configs[0].source' unset
	[ "$(local_setting project-name)" = null ]
}

# --- CONFIG-05: user and project settings --------------------------------------------------

# Description: a user setting applies when the project doesn't set it, and the project's value
# wins over it.
# Steps:
#   1. Set probe to jlink in the user settings.
#   2. Show config probe, with --json; check it is jlink, from the user settings.
#   3. Set project-name to fromuser in the user settings, and to fromproject in the project.
#   4. Show config project-name, with --json; check it is fromproject, from the project.
# bats test_tags=req:CONFIG-05, id:N0066
@test "a user setting applies, and the project's value wins over it" {
	aa config probe jlink --global
	run_json config probe
	assert_json '.configs[0].value' jlink
	assert_json '.configs[0].source' global
	aa config project-name fromuser --global
	aa config project-name fromproject
	run_json config project-name
	assert_json '.configs[0].value' fromproject
	assert_json '.configs[0].source' local
}

# Description: config finds the project settings from a subdirectory of the project.
# Steps:
#   1. Make a subdirectory src/deep of the project and go there.
#   2. Show config target, with --json.
#   3. Check it succeeds, giving otherboard from the project settings.
# bats test_tags=req:CONFIG-05, id:N0067
@test "the project settings are found from a subdirectory" {
	mkdir -p "$PROJECT/src/deep"
	cd "$PROJECT/src/deep"
	run_json config target
	assert_success
	assert_json '.configs[0].value' otherboard
	assert_json '.configs[0].source' local
}

# --- CONFIG-06: where a change goes --------------------------------------------------------

# Description: a change made from inside the project goes to the project settings.
# Steps:
#   1. Make a subdirectory src of the project and go there.
#   2. Set probe to jlink.
#   3. Check the project settings have probe jlink and the user settings don't.
#   4. Check no settings directory was created in src.
# bats test_tags=req:CONFIG-06, id:N0068
@test "a change goes to the project settings when the project has them" {
	mkdir -p "$PROJECT/src"
	cd "$PROJECT/src"
	aa config probe jlink
	[ "$(local_setting probe)" = '"jlink"' ]
	[ "$(global_setting probe)" = null ]
	[ ! -e "$PROJECT/src/.analog-attach" ]
}

# Description: with --global, a change goes to the user settings.
# Steps:
#   1. Set probe to jlink with --global.
#   2. Check the user settings have probe jlink and the project settings don't.
# bats test_tags=req:CONFIG-06, id:N0069
@test "with --global a change goes to the user settings" {
	aa config probe jlink --global
	[ "$(global_setting probe)" = '"jlink"' ]
	[ "$(local_setting probe)" = null ]
}

# Description: outside any project, a change creates the project settings in the current
# directory.
# Steps:
#   1. Make a directory outside the project and go there.
#   2. Set backend to noos; check it succeeds.
#   3. Check that directory now has a settings file with backend noos.
# bats test_tags=req:CONFIG-06, id:N0070
@test "with no project settings, a change creates them in the current directory" {
	mkdir -p "$BATS_TEST_TMPDIR/elsewhere"
	cd "$BATS_TEST_TMPDIR/elsewhere"
	run aa config backend noos
	assert_success
	[ "$(jq -r .backend "$BATS_TEST_TMPDIR/elsewhere/.analog-attach/config.json")" = noos ]
}

# --- CONFIG-07: caches ---------------------------------------------------------------------

# Description: config --reload says the noos backend has no caches to rebuild.
# Steps:
#   1. Run config --reload, with --json.
#   2. Check it succeeds (.ok true), saying the noos backend keeps no caches.
#   3. Check no noos cache directory was created.
# bats test_tags=req:CONFIG-07, id:N0071
@test "config --reload says that noos caches nothing" {
	run_json config --reload
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Nothing to rebuild: the noos backend keeps no caches"
	[ ! -e "$PROJECT/.analog-attach/noos" ]
}

# --- CONFIG-09: one setting per call -------------------------------------------------------

# Description: config sets one setting per call; more words are a usage error, and nothing is
# written.
# Steps:
#   1. Keep the project settings file's contents.
#   2. Run config probe jlink bootstrap false.
#   3. Check it fails with a usage error (exit 2), saying probe takes one value and got 3.
#   4. Check the project settings file didn't change.
# bats test_tags=req:CONFIG-09, id:N0072
@test "config changes one setting per call" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config probe jlink bootstrap false
	assert_failure 2
	assert_output --partial "probe takes one value; got 3"
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# Description: config <key> shows only that one setting.
# Steps:
#   1. Show config probe, with --json.
#   2. Check it gives one setting, and the message says 1 config field.
# bats test_tags=req:CONFIG-09, id:N0073
@test "config shows one setting when given a key" {
	run_json config probe
	assert_json '.configs | length' 1
	assert_json '.message' "1 config field(s)"
}

# --- CONFIG-10: names and storage ----------------------------------------------------------

# Description: the setting names are kebab-case, and the settings files are JSON.
# Steps:
#   1. List the settings with config, with --json; check every name is kebab-case.
#   2. Set project-name to myproject, and probe to jlink with --global.
#   3. Check the project settings file holds project-name, and the user settings file holds
#      probe, both read as JSON.
# bats test_tags=req:CONFIG-10, id:N0074
@test "setting names are kebab-case and the settings are stored as JSON" {
	run_json config
	assert_json '[.configs[].field_name | select(test("^[a-z]+(-[a-z]+)*$") | not)] | length' 0
	aa config project-name myproject
	aa config probe jlink --global
	jq -e '.noos["project-name"] == "myproject"' "$PROJECT/.analog-attach/config.json" >/dev/null
	jq -e '.noos.probe == "jlink"' "$HOME/.config/analog-attach/config.json" >/dev/null
}

# --- CONFIG-11: unknown setting ------------------------------------------------------------

# Description: a mistyped setting is a usage error that names the closest setting.
# Steps:
#   1. Run config targt testboard.
#   2. Check it fails with a usage error (exit 2), calling targt unknown and suggesting target.
# bats test_tags=req:CONFIG-11, id:N0075
@test "a mistyped setting is refused, naming the closest setting" {
	run aa config targt testboard
	assert_failure 2
	assert_output --partial "Unknown config field: targt"
	assert_output --regexp "(mean|closest)[^.]*target"
}
