# build where the backend is noos: the generated CAPI project built with CMake.
#
# The fixtures' capi is not a real one, so a real build needs the real trees, given by:
#   AA_CAPI_PATH     a capi checkout
#   AA_MODULE_PATHS  the module repositories, colon-separated
#   AA_TARGET        the board (default max32655fthr; real_sensor wires a part for it)
# plus cmake, ninja and arm-none-eabi-gcc (and MAXIM_SDK_PATH for a maxim board). The tests
# tagged needs:toolchain skip without them.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet. The
# needs:toolchain tests replace these settings with the real trees (real_sensor), or skip.
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

# Description: build with no generated project is refused, says to run generate, and generates
# nothing.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run build, with --json.
#   3. Check it is refused (.ok false) and the message says to run generate.
#   4. Check there is no out folder.
# bats test_tags=req:BUILD-02, req:BUILD-06, id:N0026
@test "build with no generated project says to generate it, and generates nothing" {
	with_sensor
	run_json build
	assert_json '.ok' false
	assert_json '.message | test("Run: analog-attach generate")' true
	[ ! -e "$PROJECT/out" ]
}

# Description: build says when cmake is missing.
# Steps:
#   1. Create a workfile with the eval-testpart board added, and generate.
#   2. Run build, with --json, with a PATH where cmake fails as a missing tool would.
#   3. Check it is refused (.ok false) and the message says cmake was not found.
# bats test_tags=req:BUILD-02, id:N0027
@test "build reports that cmake is missing" {
	with_sensor
	aa generate >/dev/null
	local path
	path=$(path_without cmake)
	PATH="$path" run_json build
	assert_json '.ok' false
	assert_json '.message | test("cmake was not found")' true
}

# Description: build says when ninja is missing.
# Steps:
#   1. Skip without cmake.
#   2. Create a workfile with the eval-testpart board added, and generate.
#   3. Run build, with --json, with a PATH where ninja fails as a missing tool would.
#   4. Check it is refused (.ok false) and the message says ninja was not found.
# bats test_tags=req:BUILD-02, id:N0028
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

# Description: build names every missing tool in one report.
# Steps:
#   1. Create a workfile with the eval-testpart board added, and generate.
#   2. Run build, with --json, with a PATH where cmake and ninja both fail as missing.
#   3. Check it is refused (.ok false) and the message names cmake and ninja.
# bats test_tags=req:BUILD-02, id:N0029
@test "build reports every missing tool at once" {
	with_sensor
	aa generate >/dev/null
	local path
	path=$(path_without cmake ninja)
	PATH="$path" run_json build
	assert_json '.ok' false
	assert_json '.message | test("cmake") and test("ninja")' true
}

# Description: build says when capi-path is not a capi checkout (the fixtures' capi is not one).
# Steps:
#   1. Skip without cmake or ninja.
#   2. Create a workfile with the eval-testpart board added, and generate.
#   3. Run build, with --json.
#   4. Check it is refused (.ok false) and the message says capi-path is not a capi checkout.
# bats test_tags=req:BUILD-02, id:N0030
@test "build reports a capi-path that is not a capi checkout" {
	need cmake ninja
	with_sensor
	aa generate >/dev/null
	run_json build
	assert_json '.ok' false
	assert_json '.message | test("is not a capi checkout") and test("capi-path")' true
}

# Description: on a maxim board, build says when MAXIM_SDK_PATH is not set, and builds nothing.
# Steps:
#   1. On the real trees, make and generate a valid workfile with an ADXL355; skip if the
#      board is not a maxim one.
#   2. Run build, with --json, with MAXIM_SDK_PATH unset.
#   3. Check it is refused (.ok false) and the message says MAXIM_SDK_PATH is not set.
#   4. Check there is no build folder.
# bats test_tags=req:BUILD-02, needs:toolchain, id:N0031
@test "build reports a maxim board's MAXIM_SDK_PATH missing" {
	real_sensor
	grep -q '"PLATFORM": "maxim"' "$PROJECT/out/project/CMakePresets.json" || skip "not a maxim board"
	run --separate-stderr env -u MAXIM_SDK_PATH node "$CLI_DIR/dist/cli.js" --json build
	assert_json '.ok' false
	assert_json '.message | test("MAXIM_SDK_PATH is not set")' true
	[ ! -e "$PROJECT/out/project/build" ]
}

# --- build and generate stay apart ----------------------------------------------------------

# Description: build uses the generated project as it is, and does not generate it again after
# the workfile changed.
# Steps:
#   1. Create a workfile with the eval-testpart board added, and generate.
#   2. Take a checksum of the generated project.
#   3. Run update testpart_cs_gpio number 5, and config build-command true.
#   4. Run build, with --json, and check it is accepted.
#   5. Check the generated project has the same checksum.
# bats test_tags=req:BUILD-06, id:N0032
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

# Description: when the build command fails, build shows its messages and says the build failed,
# with the exit code.
# Steps:
#   1. Create a workfile with the eval-testpart board added, and generate.
#   2. Run config build-command with a command that writes an error and exits with 3.
#   3. Run build, and check the output has the command's message and says the build failed
#      with exit code 3.
#   4. Run build, with --json, and check it is refused (.ok false) with the same message.
# bats test_tags=req:BUILD-07, id:N0033
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

# Description: build builds the generated project into an ELF firmware image, and gives its path.
# Steps:
#   1. On the real trees, make and generate a valid workfile with an ADXL355.
#   2. Run build, with --json.
#   3. Check it succeeds and gives the path of build/project_app.elf, an ELF file.
#   4. Run build, and check it succeeds, says the build completed and names the same file.
# bats test_tags=req:BUILD-01, req:BUILD-01-CAPI, req:BUILD-03, req:GENERATE-01, needs:toolchain, id:N0034
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

# Description: build --clean removes the previous build output before building.
# Steps:
#   1. On the real trees, make and generate a valid workfile with an ADXL355.
#   2. Put a left-over file in the build folder.
#   3. Run build --clean, with --json, and check it is accepted.
#   4. Check the left-over file is gone and the image is built.
# bats test_tags=req:BUILD-04, needs:toolchain, id:N0035
@test "build --clean removes the previous build output first" {
	real_sensor
	mkdir -p "$PROJECT/out/project/build"
	touch "$PROJECT/out/project/build/left-over"
	run_json build --clean
	assert_json '.ok' true
	[ ! -e "$PROJECT/out/project/build/left-over" ]
	[ -f "$PROJECT/out/project/build/project_app.elf" ]
}

# Description: when the compile fails, build shows the compiler's messages and says the build
# failed.
# Steps:
#   1. On the real trees, make and generate a valid workfile with an ADXL355.
#   2. Add a line that is not C to the generated src/app.c.
#   3. Run build.
#   4. Check the output has the compiler's error for app.c and says the build failed.
#   5. Check no image was built.
# bats test_tags=req:BUILD-07, needs:toolchain, id:N0036
@test "a failed compile shows the compiler's messages and says the build failed" {
	real_sensor
	echo 'this is not C;' >>"$PROJECT/out/project/src/app.c"
	run aa build
	assert_output --partial "app.c"
	assert_output --partial "error:"
	assert_output --partial "Build failed with exit code"
	[ ! -e "$PROJECT/out/project/build/project_app.elf" ]
}

# Description: build writes to the build-dir folder, so builds in two folders can sit side by
# side.
# Steps:
#   1. On the real trees, make and generate a valid workfile with an ADXL355.
#   2. Run config build-dir build-a, then build, with --json.
#   3. Check it is accepted and gives the image in build-a.
#   4. Run config build-dir build-b, then build, with --json, and check the image is in build-b.
#   5. Check both images are there, and there is no build folder.
# bats test_tags=req:SET-11, needs:toolchain, id:N0037
@test "build builds in the build-dir folder, and two can sit side by side" {
	real_sensor
	aa config build-dir build-a >/dev/null
	run_json build
	assert_json '.ok' true
	assert_json '.path' "$PROJECT/out/project/build-a/project_app.elf"
	aa config build-dir build-b >/dev/null
	run_json build
	assert_json '.path' "$PROJECT/out/project/build-b/project_app.elf"
	[ -f "$PROJECT/out/project/build-a/project_app.elf" ]
	[ -f "$PROJECT/out/project/build-b/project_app.elf" ]
	[ ! -e "$PROJECT/out/project/build" ]
}

