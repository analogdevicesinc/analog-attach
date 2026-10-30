# build where the backend is noos: the generated CAPI project built with CMake.
#
# The fixtures' capi is not a real one, so a real build needs the real trees, given by:
#   AA_CAPI_PATH     a capi checkout
#   AA_MODULE_PATHS  the module repositories, colon-separated
#   AA_TARGET        the board (default max32655fthr; real_sensor wires a part for it)
# plus cmake, ninja and arm-none-eabi-gcc (and MAXIM_SDK_PATH for a maxim board). The tests
# tagged needs:toolchain skip without them.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# `real_sensor`: on the real trees, a valid workfile with an ADXL355 whose chip select is a
# GPIO pin (port 2 pin 0 of max32655fthr), generated.
real_sensor() {
	real_project
	aa init >/dev/null || fail "init failed"
	aa add adxl355 >/dev/null || fail "add adxl355 failed"
	aa add capi_gpio_pin --name cs_pin >/dev/null || fail "add capi_gpio_pin failed"
	aa update cs_pin port_handle bsp_gpio2_cfg_handle >/dev/null || fail "update failed"
	aa update cs_pin number 0 >/dev/null || fail "update failed"
	aa update adxl355_spi_dev cs_gpio cs_pin >/dev/null || fail "update failed"
	run_json validate
	assert_json '.errors | length' 0
	run_json generate
	assert_json '.ok' true
}

# `path_without <tool>...`: PATH with the named tools shadowed by stand-ins that fail, as a
# missing tool would.
path_without() {
	local dir="$BATS_TEST_TMPDIR/missing" tool
	mkdir -p "$dir"
	for tool in "$@"; do
		printf '#!/bin/sh\nexit 127\n' >"$dir/$tool"
		chmod +x "$dir/$tool"
	done
	echo "$dir:$PATH"
}

# `tree_sum <dir>`: one checksum of every file under <dir>.
tree_sum() {
	(cd "$1" && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum)
}

# --- Before building: what the build needs --------------------------------------------------

# bats test_tags=req:BUILD-02, req:BUILD-06
@test "build with no generated project says to generate it, and generates nothing" {
	with_sensor
	run_json build
	assert_json '.ok' false
	assert_json '.message | test("Run: analog-attach generate")' true
	[ ! -e "$PROJECT/out" ]
}

# bats test_tags=req:BUILD-02
@test "build reports that cmake is missing" {
	with_sensor
	aa generate >/dev/null
	local path
	path=$(path_without cmake)
	PATH="$path" run_json build
	assert_json '.ok' false
	assert_json '.message | test("cmake was not found")' true
}

# bats test_tags=req:BUILD-02
@test "build reports that ninja is missing" {
	need cmake
	with_sensor
	aa generate >/dev/null
	local path
	path=$(path_without ninja)
	PATH="$path" run_json build
	assert_json '.ok' false
	assert_json '.message | test("ninja was not found")' true
}

# bats test_tags=req:BUILD-02
@test "build reports every missing tool at once" {
	with_sensor
	aa generate >/dev/null
	local path
	path=$(path_without cmake ninja)
	PATH="$path" run_json build
	assert_json '.ok' false
	assert_json '.message | test("cmake") and test("ninja")' true
}

# bats test_tags=req:BUILD-02
@test "build reports a capi-path that is not a capi checkout" {
	need cmake ninja
	with_sensor
	aa generate >/dev/null
	run_json build
	assert_json '.ok' false
	assert_json '.message | test("is not a capi checkout") and test("capi-path")' true
}

# bats test_tags=req:BUILD-02, needs:toolchain
@test "build reports a maxim board's MAXIM_SDK_PATH missing" {
	real_sensor
	grep -q '"PLATFORM": "maxim"' "$PROJECT/out/project/CMakePresets.json" || skip "not a maxim board"
	run --separate-stderr env -u MAXIM_SDK_PATH node "$CLI_DIR/dist/cli.js" --json build
	assert_json '.ok' false
	assert_json '.message | test("MAXIM_SDK_PATH is not set")' true
	[ ! -e "$PROJECT/out/project/build" ]
}

# --- build and generate stay apart ----------------------------------------------------------

# bats test_tags=req:BUILD-06
@test "build doesn't regenerate the project from a changed workfile" {
	with_sensor
	aa generate >/dev/null
	local before
	before=$(tree_sum "$PROJECT/out/project")
	aa update testpart_cs_gpio number 5 >/dev/null
	aa config build-command true
	run_json build
	assert_json '.ok' true
	[ "$(tree_sum "$PROJECT/out/project")" = "$before" ]
}

# --- Building -------------------------------------------------------------------------------

# bats test_tags=req:BUILD-07
@test "a failed build command shows its messages and says the build failed" {
	with_sensor
	aa generate >/dev/null
	aa config build-command 'echo "compiler: something broke" >&2; exit 3'
	run aa build
	assert_output --partial "compiler: something broke"
	assert_output --partial "Build failed with exit code 3"
	run_json build
	assert_json '.ok' false
	assert_json '.message' "Build failed with exit code 3"
}

# bats test_tags=req:BUILD-01, req:BUILD-01-CAPI, req:BUILD-03, req:GENERATE-01, needs:toolchain
@test "build builds the generated project into a firmware image and says where it is" {
	real_sensor
	run_json build
	assert_success
	assert_json '.ok' true
	local elf="$PROJECT/out/project/build/project_app.elf"
	assert_json '.path' "$elf"
	[ "$(head -c 4 "$elf" | od -An -c | tr -d ' ')" = '177ELF' ]
	# The human output names the same file.
	run aa build
	assert_success
	assert_line "Build completed successfully"
	assert_line "  $elf"
}

# bats test_tags=req:BUILD-04, needs:toolchain
@test "build --clean removes the previous build output first" {
	real_sensor
	mkdir -p "$PROJECT/out/project/build"
	touch "$PROJECT/out/project/build/left-over"
	run_json build --clean
	assert_json '.ok' true
	[ ! -e "$PROJECT/out/project/build/left-over" ]
	[ -f "$PROJECT/out/project/build/project_app.elf" ]
}

# bats test_tags=req:BUILD-07, needs:toolchain
@test "a failed compile shows the compiler's messages and says the build failed" {
	real_sensor
	echo 'this is not C;' >>"$PROJECT/out/project/src/app.c"
	run aa build
	assert_output --partial "app.c"
	assert_output --partial "error:"
	assert_output --partial "Build failed with exit code"
	[ ! -e "$PROJECT/out/project/build/project_app.elf" ]
}
