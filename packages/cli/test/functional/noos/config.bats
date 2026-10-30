# Examples: config where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# bats test_tags=req:CONFIG-04
@test "config --reset returns a setting to its default" {
	aa config probe jlink
	run aa config probe --reset
	assert_success
	run_json config probe
	assert_success
	assert_json '.configs[0].value' openocd
	assert_json '.configs[0].source' default
}

# bats test_tags=req:CONFIG-11
@test "an unknown setting is refused, naming the valid ones" {
	run aa config nosuchkey 1
	assert_failure 2
	assert_output --partial "Unknown config field: nosuchkey"
	assert_output --partial "capi-path"
}

# bats test_tags=req:INIT-01, req:INIT-02
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

# bats test_tags=req:CONFIG-01
@test "config lists every setting of noos with its category, value, source and whether it is required" {
	aa config probe jlink --global
	run_json config
	assert_success
	assert_json '[.configs[].field_name] | join(",")' \
		"backend,capi-path,module-paths,target,workfile,bootstrap,interview,project-name,project-path,project-template,example,build-command,deploy-command,probe"
	assert_json '[.configs[].category] | unique | sort | join(",")' "Build,General,Project,Sources,Target,Workfile"
	assert_json '.configs[] | select(.field_name == "capi-path") | .required' true
	assert_json '.configs[] | select(.field_name == "probe") | .required' false
	assert_json '.configs[] | select(.field_name == "target") | "\(.value) \(.source)"' "otherboard local"
	assert_json '.configs[] | select(.field_name == "probe") | "\(.value) \(.source)"' "jlink global"
	assert_json '.configs[] | select(.field_name == "bootstrap") | "\(.value) \(.source)"' "true default"
	assert_json '.configs[] | select(.field_name == "project-name") | "\(.value) \(.source)"' "null unset"
}

# bats test_tags=req:CONFIG-01
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

# bats test_tags=req:CONFIG-02
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

# bats test_tags=req:CONFIG-03
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

# bats test_tags=req:CONFIG-03
@test "a value that is not one of the choices is refused with the reason, and nothing is written" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config probe stlink
	assert_failure 2
	assert_output --partial 'probe: "stlink" is not one of openocd | jlink'
	run aa config bootstrap yes
	assert_failure 2
	assert_output --partial 'bootstrap: "yes" is not true or false'
	run aa config target nosuchboard
	assert_failure 2
	assert_output --partial 'target: "nosuchboard" is not one of testboard | otherboard'
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# bats test_tags=req:CONFIG-03
@test "a path that does not exist is refused with the reason" {
	run aa config capi-path "$BATS_TEST_TMPDIR/nowhere"
	assert_failure 2
	assert_output --partial "capi-path: $BATS_TEST_TMPDIR/nowhere does not exist"
	run aa config module-paths "$NOOS_FIXTURES/platform" "$BATS_TEST_TMPDIR/nowhere"
	assert_failure 2
	assert_output --partial "module-paths: $BATS_TEST_TMPDIR/nowhere does not exist"
	[ "$(local_setting capi-path)" = "\"$NOOS_FIXTURES/capi\"" ]
}

# bats test_tags=req:CONFIG-03
@test "a directory that is not a capi checkout is refused as capi-path" {
	run aa config capi-path "$BATS_TEST_TMPDIR"
	assert_failure 2
	assert_output --partial "is not a capi checkout (it has no module.yml)"
}

# --- CONFIG-04: reset ----------------------------------------------------------------------

# bats test_tags=req:CONFIG-04
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

# bats test_tags=req:CONFIG-05
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

# bats test_tags=req:CONFIG-05
@test "the project settings are found from a subdirectory" {
	mkdir -p "$PROJECT/src/deep"
	cd "$PROJECT/src/deep"
	run_json config target
	assert_success
	assert_json '.configs[0].value' otherboard
	assert_json '.configs[0].source' local
}

# --- CONFIG-06: where a change goes --------------------------------------------------------

# bats test_tags=req:CONFIG-06
@test "a change goes to the project settings when the project has them" {
	mkdir -p "$PROJECT/src"
	cd "$PROJECT/src"
	aa config probe jlink
	[ "$(local_setting probe)" = '"jlink"' ]
	[ "$(global_setting probe)" = null ]
	[ ! -e "$PROJECT/src/.analog-attach" ]
}

# bats test_tags=req:CONFIG-06
@test "with --global a change goes to the user settings" {
	aa config probe jlink --global
	[ "$(global_setting probe)" = '"jlink"' ]
	[ "$(local_setting probe)" = null ]
}

# bats test_tags=req:CONFIG-06, gap
@test "with --local a change goes to the project settings, created in the current directory" {
	# Gap: there is no --local flag ("No flag registered for --local, did you mean --global?", exit 2).
	mkdir -p "$BATS_TEST_TMPDIR/elsewhere"
	cd "$BATS_TEST_TMPDIR/elsewhere"
	run aa config backend noos --local
	assert_success
	[ "$(jq -r .backend "$BATS_TEST_TMPDIR/elsewhere/.analog-attach/config.json")" = noos ]
}

# --- CONFIG-07: caches ---------------------------------------------------------------------

# bats test_tags=req:CONFIG-07
@test "config --reload says that noos caches nothing" {
	run_json config --reload
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Nothing to rebuild: the noos backend keeps no caches"
	[ ! -e "$PROJECT/.analog-attach/noos" ]
}

# --- CONFIG-09: one setting per call -------------------------------------------------------

# bats test_tags=req:CONFIG-09
@test "config changes one setting per call" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config probe jlink bootstrap false
	assert_failure 2
	assert_output --partial "probe takes one value; got 3"
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# bats test_tags=req:CONFIG-09
@test "config shows one setting when given a key" {
	run_json config probe
	assert_json '.configs | length' 1
	assert_json '.message' "1 config field(s)"
}

# --- CONFIG-10: names and storage ----------------------------------------------------------

# bats test_tags=req:CONFIG-10
@test "setting names are kebab-case and the settings are stored as JSON" {
	run_json config
	assert_json '[.configs[].field_name | select(test("^[a-z]+(-[a-z]+)*$") | not)] | length' 0
	aa config project-name myproject
	aa config probe jlink --global
	jq -e '.noos["project-name"] == "myproject"' "$PROJECT/.analog-attach/config.json" >/dev/null
	jq -e '.noos.probe == "jlink"' "$HOME/.config/analog-attach/config.json" >/dev/null
}

# --- CONFIG-11: unknown setting ------------------------------------------------------------

# bats test_tags=req:CONFIG-11, gap
@test "a mistyped setting is refused, naming the closest setting" {
	# Gap: the message lists every valid setting; it doesn't single out the closest (target for targt).
	run aa config targt testboard
	assert_failure 2
	assert_output --partial "Unknown config field: targt"
	assert_output --regexp "(mean|closest)[^.]*target"
}
