# config where the backend is linux.

# bats file_tags=eco:linux

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

# bats test_tags=req:CONFIG-01
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

# bats test_tags=req:CONFIG-01
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

# bats test_tags=req:CONFIG-02
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

# bats test_tags=req:CONFIG-03
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

# bats test_tags=req:CONFIG-03
@test "a value that is not one of the choices is refused with the reason, and nothing is written" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config overlay-syntax braces
	assert_output --partial 'overlay-syntax: "braces" is not one of fragment | label'
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# bats test_tags=req:CONFIG-03
@test "a path that does not exist is refused with the reason" {
	run aa config devicetree "$BATS_TEST_TMPDIR/nowhere.dts"
	assert_output --partial "devicetree: $BATS_TEST_TMPDIR/nowhere.dts does not exist"
	run aa config linux "$BATS_TEST_TMPDIR/nowhere"
	assert_output --partial "linux: $BATS_TEST_TMPDIR/nowhere does not exist"
	[ "$(local_setting devicetree)" = "\"$LINUX_BASE\"" ]
	[ "$(local_setting linux)" = "\"$LINUX_TREE\"" ]
}

# bats test_tags=req:CONFIG-03
@test "a directory that is not a Linux tree is refused as linux" {
	run aa config linux "$BATS_TEST_TMPDIR"
	assert_output --partial "linux: no Documentation/devicetree/bindings/ under $BATS_TEST_TMPDIR (not a Linux source tree)"
	[ "$(local_setting linux)" = "\"$LINUX_TREE\"" ]
}

# bats test_tags=req:CONFIG-03
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

# bats test_tags=req:CONFIG-04
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

# bats test_tags=req:CONFIG-04
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

# bats test_tags=req:CONFIG-05
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

# bats test_tags=req:CONFIG-05
@test "the project settings are found from a subdirectory" {
	mkdir -p "$PROJECT/src/deep"
	cd "$PROJECT/src/deep"
	run_json config devicetree
	assert_success
	assert_json '.configs[0].value' "$LINUX_BASE"
	assert_json '.configs[0].source' local
}

# --- CONFIG-06: where a change goes --------------------------------------------------------

# bats test_tags=req:CONFIG-06
@test "a change goes to the project settings when the project has them" {
	mkdir -p "$PROJECT/src"
	cd "$PROJECT/src"
	aa config deploy-ip 192.0.2.1
	[ "$(local_setting deploy-ip)" = '"192.0.2.1"' ]
	[ "$(global_setting deploy-ip)" = null ]
	[ ! -e "$PROJECT/src/.analog-attach" ]
}

# bats test_tags=req:CONFIG-06
@test "with --global a change goes to the user settings" {
	aa config deploy-ip 192.0.2.1 --global
	[ "$(global_setting deploy-ip)" = '"192.0.2.1"' ]
	[ "$(local_setting deploy-ip)" = null ]
}

# bats test_tags=req:CONFIG-06
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

# bats test_tags=req:CONFIG-07, req:CONFIG-07-LNX
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

# bats test_tags=req:CONFIG-07
@test "config --reload in human mode says what it rebuilt" {
	run --separate-stderr aa config --reload
	assert_success
	assert_output "Rebuilt the binding index and validation.json."
}

# bats test_tags=req:CONFIG-07-LNX
@test "config --reload with no Linux tree names the setting" {
	drop_setting linux
	run aa config --reload
	assert_output --partial "Missing config field linux"
	assert_output --partial "analog-attach config linux <path>"
}

# bats test_tags=req:CONFIG-08
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

# bats test_tags=req:CONFIG-09
@test "config changes one setting per call" {
	local before
	before=$(cat "$PROJECT/.analog-attach/config.json")
	run aa config overlay-syntax label deploy-ip 192.0.2.1
	assert_failure 2
	assert_output --partial "overlay-syntax takes one value; got 3"
	[ "$(cat "$PROJECT/.analog-attach/config.json")" = "$before" ]
}

# bats test_tags=req:CONFIG-09
@test "config shows one setting when given a key" {
	run_json config overlay-syntax
	assert_json '.configs | length' 1
	assert_json '.message' "1 config field(s)"
}

# --- CONFIG-10: names and storage ----------------------------------------------------------

# bats test_tags=req:CONFIG-10
@test "setting names are kebab-case and the settings are stored as JSON" {
	run_json config
	assert_json '[.configs[].field_name | select(test("^[a-z]+(-[a-z]+)*$") | not)] | length' 0
	aa config overlay-syntax label
	aa config deploy-user pi --global
	jq -e '.linux["overlay-syntax"] == "label"' "$PROJECT/.analog-attach/config.json" >/dev/null
	jq -e '.linux["deploy-user"] == "pi"' "$HOME/.config/analog-attach/config.json" >/dev/null
}

# --- CONFIG-11: unknown setting ------------------------------------------------------------

# bats test_tags=req:CONFIG-11
@test "an unknown setting is refused, naming the valid ones" {
	run aa config nosuchkey 1
	assert_failure 2
	assert_output --partial "Unknown config field: nosuchkey"
	assert_output --partial "devicetree"
	assert_output --partial "overlay-syntax"
}

# Gap: an unknown key lists every valid one, and names no closest setting.
# bats test_tags=req:CONFIG-11, gap
@test "a mistyped setting is refused, naming the closest setting" {
	run aa config overlay-sintax label
	assert_failure 2
	assert_output --partial "Unknown config field: overlay-sintax"
	assert_output --partial "Did you mean overlay-syntax?"
}

# --- GEN-13: a command that needs a setting --------------------------------------------------

# bats test_tags=req:GEN-13
@test "a command that needs an unset setting names it" {
	# The exit status differs by mode today (0 as text, 2 with --json): gen.bats checks it.
	drop_setting linux
	run aa read
	assert_output --partial "Missing config field linux"
	assert_output --partial "analog-attach config linux <path>"
}
