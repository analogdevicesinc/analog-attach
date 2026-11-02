# generate where the backend is noos: the workfile rendered into a CAPI project.
# Whether the generated project builds is checked in build.bats, on the real trees.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, and a
# workfile with the eval-testpart board added (with_sensor), valid; no project generated yet.
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# `project_files <dir>`: the files under <dir>, relative and sorted, one per line.
project_files() {
	(cd "$1" && find . -type f | sed 's|^\./||' | sort)
}

# `my_templates <dir>`: a template set of one's own, rendering only hello.txt.
my_templates() {
	mkdir -p "$1"
	printf '%s\n' '{ "files": [ { "template": "hello.eta", "output": "hello.txt", "protect": false } ] }' \
		>"$1/project_structure.json"
	printf 'made by my templates\n' >"$1/hello.eta"
}

# Description: with project-path unset, generate writes the project to out/project, named after the
# default project name.
# Steps:
#   1. Generate, with --json.
#   2. Check it succeeds and the message names $PROJECT/out/project.
#   3. Check the project has CMakeLists.txt, CMakePresets.json, src/main.c and src/app.c.
#   4. Check CMakeLists.txt declares the project_app project.
# bats test_tags=req:GENERATE-01, id:N0133
@test "generate writes the project to out/<project-name> when project-path is unset" {
	run_json generate
	assert_success
	assert_json '.ok' true
	assert_json '.message | test("in '"$PROJECT"'/out/project ")' true
	run project_files "$PROJECT/out/project"
	assert_line CMakeLists.txt
	assert_line CMakePresets.json
	assert_line src/main.c
	assert_line src/app.c
	grep -q 'project(project_app' "$PROJECT/out/project/CMakeLists.txt"
}

# Description: the project-name setting names the output directory and the CMake project.
# Steps:
#   1. Set project-name to blinky with config.
#   2. Generate, with --json, and check it succeeds (.ok true).
#   3. Check the project is in out/blinky and CMakeLists.txt declares blinky_app.
# bats test_tags=req:GENERATE-01, id:N0134
@test "generate names the project after the project-name setting" {
	aa config project-name blinky
	run_json generate
	assert_json '.ok' true
	[ -f "$PROJECT/out/blinky/CMakeLists.txt" ]
	grep -q 'project(blinky_app' "$PROJECT/out/blinky/CMakeLists.txt"
}

# Description: with project-path set, generate writes the project there and not under out.
# Steps:
#   1. Set project-path to a directory outside the project with config.
#   2. Generate, with --json, and check it succeeds (.ok true).
#   3. Check CMakeLists.txt is in that directory, and no out directory was made.
# bats test_tags=req:GENERATE-01, id:N0135
@test "generate writes the project to project-path when it is set" {
	aa config project-path "$BATS_TEST_TMPDIR/elsewhere"
	run_json generate
	assert_json '.ok' true
	[ -f "$BATS_TEST_TMPDIR/elsewhere/CMakeLists.txt" ]
	[ ! -e "$PROJECT/out" ]
}

# Description: generate --output writes the project to the given directory for this run, without
# saving it as a setting.
# Steps:
#   1. Generate --output gen2, with --json, and check it succeeds (.ok true).
#   2. Check the project is in gen2 and no out directory was made.
#   3. Check the project-path setting is still unset.
#   4. Generate again without --output, and check the project is written to out/project.
# bats test_tags=req:GENERATE-02, id:N0136
@test "generate --output writes the project to that directory, for this run only" {
	run_json generate --output gen2
	assert_json '.ok' true
	[ -f "$PROJECT/gen2/CMakeLists.txt" ]
	[ -f "$PROJECT/gen2/src/main.c" ]
	[ ! -e "$PROJECT/out" ]
	run_json config project-path
	assert_json '.configs[0].source' unset
	run_json generate
	[ -f "$PROJECT/out/project/CMakeLists.txt" ]
}

# Description: generate --output takes precedence over the project-path setting.
# Steps:
#   1. Set project-path to a directory outside the project with config.
#   2. Generate --output gen2, with --json, and check it succeeds (.ok true).
#   3. Check the project is in gen2, and the project-path directory was not made.
# bats test_tags=req:GENERATE-02, id:N0137
@test "generate --output takes over from the project-path setting" {
	aa config project-path "$BATS_TEST_TMPDIR/elsewhere"
	run_json generate --output gen2
	assert_json '.ok' true
	[ -f "$PROJECT/gen2/CMakeLists.txt" ]
	[ ! -e "$BATS_TEST_TMPDIR/elsewhere" ]
}

# Description: by default generate uses the bundled capi template set.
# Steps:
#   1. Generate, with --json.
#   2. Check the message names the capi template set.
# bats test_tags=req:GENERATE-03, id:N0138
@test "generate uses the capi template set by default" {
	run_json generate
	assert_json '.message | test("templates: capi,")' true
}

# Description: --project-template with a bundled set's name selects that set.
# Steps:
#   1. Generate --project-template capi-iio, with --json.
#   2. Check it is refused (.ok false), the message naming the capi-iio template set, which shows
#      that set was used.
# bats test_tags=req:GENERATE-03, id:N0139
@test "generate --project-template chooses a bundled set by name" {
	# capi-iio serves IIO devices only, and the fixture's sensor is not one: its refusal
	# shows the set was chosen.
	run_json generate --project-template capi-iio
	assert_json '.ok' false
	assert_json '.message | test("capi-iio template set")' true
}

# Description: --project-template with a directory path uses the template set found there.
# Steps:
#   1. Make a template set of one's own that renders only hello.txt.
#   2. Generate --project-template <that directory> --output gen, with --json.
#   3. Check it succeeds (.ok true).
#   4. Check gen holds only hello.txt, with the text the template gives.
# bats test_tags=req:GENERATE-03, id:N0140
@test "generate --project-template chooses a set by path" {
	my_templates "$BATS_TEST_TMPDIR/mine"
	run_json generate --project-template "$BATS_TEST_TMPDIR/mine" --output gen
	assert_json '.ok' true
	run project_files "$PROJECT/gen"
	assert_output hello.txt
	run cat "$PROJECT/gen/hello.txt"
	assert_output "made by my templates"
}

# Description: generate uses the project-template setting, and --project-template replaces it for
# one run without changing the setting.
# Steps:
#   1. Make a template set of one's own and set project-template to it with config.
#   2. Generate --output a, with --json, and check it succeeds and a has hello.txt.
#   3. Generate --output b --project-template capi, with --json, and check it succeeds, b has
#      CMakeLists.txt and no hello.txt.
#   4. Check the project-template setting still names one's own set.
# bats test_tags=req:GENERATE-03, id:N0141
@test "generate uses the project-template setting, and --project-template overrides it for this run" {
	my_templates "$BATS_TEST_TMPDIR/mine"
	aa config project-template "$BATS_TEST_TMPDIR/mine"
	run_json generate --output a
	assert_json '.ok' true
	[ -f "$PROJECT/a/hello.txt" ]
	run_json generate --output b --project-template capi
	assert_json '.ok' true
	[ -f "$PROJECT/b/CMakeLists.txt" ]
	[ ! -e "$PROJECT/b/hello.txt" ]
	run_json config project-template
	assert_json '.configs[0].value' "$BATS_TEST_TMPDIR/mine"
}

# Description: an unknown --project-template is refused, the message listing the bundled sets, and
# nothing is generated.
# Steps:
#   1. Generate --project-template nope, with --json.
#   2. Check it is refused (.ok false), naming nope and the bundled sets capi and capi-iio.
#   3. Check no out directory was made.
# bats test_tags=req:GENERATE-03, id:N0142
@test "generate --project-template refuses a set that doesn't exist, naming the bundled ones" {
	run_json generate --project-template nope
	assert_json '.ok' false
	assert_json '.message | test("nope") and test("capi, capi-iio")' true
	[ ! -e "$PROJECT/out" ]
}

# Description: generating again keeps the user's edits to the application source and the user's
# own source files.
# Steps:
#   1. Generate.
#   2. Rewrite src/app.c and add a new file src/mine.c.
#   3. Generate again, with --json, and check it succeeds (.ok true).
#   4. Check src/app.c and src/mine.c still hold the user's text.
# bats test_tags=req:GENERATE-05, id:N0143
@test "generating again keeps the user's application source" {
	aa generate
	local app="$PROJECT/out/project/src/app.c"
	printf 'int app_main(void) { return 42; } /* mine */\n' >"$app"
	printf 'int helper(void) { return 1; }\n' >"$PROJECT/out/project/src/mine.c"
	run_json generate
	assert_json '.ok' true
	run cat "$app"
	assert_output 'int app_main(void) { return 42; } /* mine */'
	run cat "$PROJECT/out/project/src/mine.c"
	assert_output 'int helper(void) { return 1; }'
}

# Description: generating again overwrites the generated files.
# Steps:
#   1. Generate.
#   2. Overwrite src/main.c with stale text.
#   3. Generate again.
#   4. Check src/main.c no longer holds the stale text.
# bats test_tags=req:GENERATE-05, id:N0144
@test "generating again rewrites the generated files" {
	aa generate
	printf 'stale\n' >"$PROJECT/out/project/src/main.c"
	aa generate
	run cat "$PROJECT/out/project/src/main.c"
	refute_output stale
}
