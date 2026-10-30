# generate where the backend is noos: the workfile rendered into a CAPI project.
# Whether the generated project builds is checked in build.bats, on the real trees.

# bats file_tags=eco:noos

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

# bats test_tags=req:GENERATE-01
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

# bats test_tags=req:GENERATE-01
@test "generate names the project after the project-name setting" {
	aa config project-name blinky
	run_json generate
	assert_json '.ok' true
	[ -f "$PROJECT/out/blinky/CMakeLists.txt" ]
	grep -q 'project(blinky_app' "$PROJECT/out/blinky/CMakeLists.txt"
}

# bats test_tags=req:GENERATE-01
@test "generate writes the project to project-path when it is set" {
	aa config project-path "$BATS_TEST_TMPDIR/elsewhere"
	run_json generate
	assert_json '.ok' true
	[ -f "$BATS_TEST_TMPDIR/elsewhere/CMakeLists.txt" ]
	[ ! -e "$PROJECT/out" ]
}

# bats test_tags=req:GENERATE-02
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

# bats test_tags=req:GENERATE-02
@test "generate --output takes over from the project-path setting" {
	aa config project-path "$BATS_TEST_TMPDIR/elsewhere"
	run_json generate --output gen2
	assert_json '.ok' true
	[ -f "$PROJECT/gen2/CMakeLists.txt" ]
	[ ! -e "$BATS_TEST_TMPDIR/elsewhere" ]
}

# bats test_tags=req:GENERATE-03
@test "generate uses the capi template set by default" {
	run_json generate
	assert_json '.message | test("templates: capi,")' true
}

# bats test_tags=req:GENERATE-03
@test "generate --project-template chooses a bundled set by name" {
	# capi-iio serves IIO devices only, and the fixture's sensor is not one: its refusal
	# shows the set was chosen.
	run_json generate --project-template capi-iio
	assert_json '.ok' false
	assert_json '.message | test("capi-iio template set")' true
}

# bats test_tags=req:GENERATE-03
@test "generate --project-template chooses a set by path" {
	my_templates "$BATS_TEST_TMPDIR/mine"
	run_json generate --project-template "$BATS_TEST_TMPDIR/mine" --output gen
	assert_json '.ok' true
	run project_files "$PROJECT/gen"
	assert_output hello.txt
	run cat "$PROJECT/gen/hello.txt"
	assert_output "made by my templates"
}

# bats test_tags=req:GENERATE-03
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

# bats test_tags=req:GENERATE-03
@test "generate --project-template refuses a set that doesn't exist, naming the bundled ones" {
	run_json generate --project-template nope
	assert_json '.ok' false
	assert_json '.message | test("nope") and test("capi, capi-iio")' true
	[ ! -e "$PROJECT/out" ]
}

# bats test_tags=req:GENERATE-05
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

# bats test_tags=req:GENERATE-05
@test "generating again rewrites the generated files" {
	aa generate
	printf 'stale\n' >"$PROJECT/out/project/src/main.c"
	aa generate
	run cat "$PROJECT/out/project/src/main.c"
	refute_output stale
}
