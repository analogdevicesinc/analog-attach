# build where the backend is linux: the overlay compiled into a .dtbo with the dtc on PATH.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, workfile overlay.dtso
# set but not created yet; each test creates the overlay when it needs one.
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

# `path_without <name>`: a PATH with everything of this one but <name>: one directory of links to
# the files of its directories, the first of each name (ln leaves a taken name as it is).
path_without() {
	local bin="$BATS_TEST_TMPDIR/path-without-$1" directory directories
	mkdir -p "$bin"
	IFS=: read -ra directories <<<"$PATH"
	for directory in "${directories[@]}"; do
		[ -d "$directory" ] && ln -s "$directory"/* "$bin/" 2>/dev/null
	done
	rm -f "$bin/$1"
	echo "$bin"
}

# `duplicate_labels`: an overlay that parses but dtc refuses: two nodes with one label.
duplicate_labels() {
	printf '/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&spi0>;\n\t\t__overlay__ {\n\t\t\tx: a@0 { reg = <0>; };\n\t\t\tx: b@1 { reg = <1>; };\n\t\t};\n\t};\n};\n' >"$WORKFILE"
}

# Description: build compiles the overlay into a .dtbo in the build folder, with the added node in it and
# the reference to the base's spi0 left as a fixup for the loader.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Run build, with --json; check it succeeds (.ok true).
#   3. Check build/overlay.dtbo exists and starts with the flattened devicetree magic d00dfeed.
#   4. Decompile it with dtc; check it has the adxl345 compatible and a __fixups__
#      entry for spi0 on fragment@0's target.
# bats test_tags=req:BUILD-01, req:BUILD-01-LNX, id:L0033
@test "build compiles the overlay into a .dtbo in the build folder" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	run_json build
	assert_success
	assert_json '.ok' true
	local dtbo="$PROJECT/build/overlay.dtbo"
	[ -f "$dtbo" ]
	# A flattened device tree: magic d00dfeed.
	[ "$(head -c 4 "$dtbo" | od -An -tx1 | tr -d ' ')" = d00dfeed ]
	# The added node is in it, and the reference to the base's spi0 is left for the loader.
	run dtc -I dtb -O dts "$dtbo"
	assert_output --partial 'compatible = "adi,adxl345";'
	assert_output --partial '__fixups__'
	assert_output --partial 'spi0 = "/fragment@0:target:0";'
}

# Description: build replaces an earlier .dtbo with one compiled from the overlay as it is now.
# Steps:
#   1. Create the overlay with init and build it, with --json; check it succeeds (.ok true) and
#      keep a copy of the .dtbo.
#   2. Add adi,adxl345 under spi0 and build again, with --json; check it succeeds (.ok true).
#   3. Check build/overlay.dtbo differs from the copy and starts with the flattened devicetree magic
#      d00dfeed.
#   4. Decompile it with dtc; check it has the adxl345 compatible.
# bats test_tags=req:BUILD-01-LNX, id:L0034
@test "build replaces an earlier .dtbo" {
	with_overlay
	local dtbo="$PROJECT/build/overlay.dtbo"
	run_json build
	assert_success
	assert_json '.ok' true
	cp "$dtbo" "$BATS_TEST_TMPDIR/first.dtbo"
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
	run_json build
	assert_success
	assert_json '.ok' true
	! cmp -s "$dtbo" "$BATS_TEST_TMPDIR/first.dtbo" || fail "overlay.dtbo is the first build's"
	[ "$(head -c 4 "$dtbo" | od -An -tx1 | tr -d ' ')" = d00dfeed ]
	run dtc -I dtb -O dts "$dtbo"
	assert_output --partial 'compatible = "adi,adxl345";'
}

# Description: build with no workfile fails with a configuration error saying how to create it,
# and compiles nothing.
# Steps:
#   1. Run build, with --json, before any init.
#   2. Check it is refused, the error is on workfile and says it does not exist, and the
#      hint points to init and config workfile.
#   3. Check no .dtbo was written.
#   4. Run build in human mode; check it points to init too.
# bats test_tags=req:BUILD-02, id:L0035
@test "build with no workfile says how to create it, and compiles nothing" {
	run_config_error build
	assert_json '.errors[0].field' workfile
	assert_json '.errors[0].message' "workfile: $WORKFILE does not exist"
	assert_json '.hints[0]' "Run 'analog-attach init' to create it, or 'analog-attach config workfile <name>' to use another."
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
	run aa build
	assert_output --partial "Run 'analog-attach init' to create it"
}

# Description: build fails with a configuration error when dtc isn't on PATH, saying how to
# install it.
# Steps:
#   1. Create the overlay with init.
#   2. Run build, with --json, with a PATH that has everything but dtc; check it is refused
#      with the type tool-missing, the error is on dtc and says it is not on PATH, and the hint
#      says how to install dtc.
#   3. Check no .dtbo was written.
# bats test_tags=req:BUILD-02, id:L0036
@test "build reports a dtc that isn't on PATH" {
	with_overlay
	local bin
	bin=$(path_without dtc)
	PATH="$bin" run_json build
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' tool-missing
	assert_json '.errors[0].field' dtc
	assert_json '.errors[0].message' 'dtc not found on PATH'
	assert_json '.hints[0] | startswith("Install dtc")' true
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
}

# Description: build fails with a configuration error when the preprocessor can't read the base
# devicetree, naming the preprocessor.
# Steps:
#   1. Create the overlay with init.
#   2. Set preprocess-command to a command that does not exist, no-such-cpp.
#   3. Run build, with --json; check it is refused and an error mentions no-such-cpp.
#   4. Check no .dtbo was written.
# bats test_tags=req:BUILD-02, id:L0037
@test "build reports a base devicetree the preprocessor can't read" {
	with_overlay
	aa config preprocess-command 'no-such-cpp -o {output} {input}' >/dev/null
	run_config_error build
	assert_json '.errors | length > 0' true
	assert_json '[.errors[].message] | join(" ") | test("no-such-cpp")' true
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
}

# Description: build reports the absolute path of the .dtbo it wrote.
# Steps:
#   1. Create the overlay with init.
#   2. Run build, with --json; check the path is the project's build/overlay.dtbo and the message is
#      Compiled overlay.
#   3. Run build in human mode; check the output shows that path.
# bats test_tags=req:BUILD-03, id:L0038
@test "build reports the absolute path of the .dtbo" {
	with_overlay
	run_json build
	assert_json '.path' "$PROJECT/build/overlay.dtbo"
	assert_json '.message' 'Compiled overlay'
	run aa build
	assert_output --partial "$PROJECT/build/overlay.dtbo"
}

# Description: build reports where its output is in the same form as the other ecosystems: a
# success line, then the path on the next line.
# Steps:
#   1. Create the overlay with init.
#   2. Run build; check it succeeds.
#   3. Check it prints Build completed successfully, and the .dtbo's path on a line indented by
#      two spaces.
# bats test_tags=req:BUILD-03, id:L0039
@test "build reports where the output is in the same form as the other ecosystems" {
	with_overlay
	run aa build
	assert_success
	assert_line "Build completed successfully"
	assert_line "  $PROJECT/build/overlay.dtbo"
}

# Description: a failed compile shows dtc's messages, says the build failed, and writes no .dtbo.
# Steps:
#   1. Create the overlay with init, then replace it with one where two nodes share a label.
#   2. Run build; check it is refused (exit 0), the first line is Build failed:, and dtc's
#      duplicate label error is shown.
#   3. Check no .dtbo was written.
#   4. Run build, with --json; check .ok is false, severity error, and the message starts with
#      Build failed: and holds dtc's error.
# bats test_tags=req:BUILD-07, id:L0040
@test "a failed compile shows dtc's messages and says the build failed" {
	with_overlay
	duplicate_labels
	run aa build
	assert_success  # a refusal: the command ran (GEN-09)
	assert_line --index 0 "Build failed:"
	assert_output --partial "ERROR (duplicate_label)"
	assert_output --partial "Duplicate label 'x'"
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
	run_json build
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | startswith("Build failed:\n")' true
	assert_json '.message | test("ERROR \\(duplicate_label\\)")' true
}

# Description: with output full, build writes the base devicetree with the overlay applied, as a
# .dts in the build folder that includes the base and adds the overlay's nodes, and compiles it
# into a .dtb: the base's nodes and the added one in one tree, with nothing left for a loader to
# resolve.
# Steps:
#   1. Create the overlay with init, add adi,adxl345 under spi0, and set output to full.
#   2. Run build, with --json; check it succeeds with Compiled devicetree, path the build
#      folder's overlay.dtb and source its overlay.dts, and that no .dtbo was written.
#   3. Check overlay.dts includes the base devicetree and has a &spi0 block with the adxl345.
#   4. Decompile overlay.dtb with the bundled dtc; check it has the base's board compatible and
#      the adxl345 compatible, and no __fixups__.
# bats test_tags=req:BUILD-01, req:BUILD-01-LNX-FULL, req:SET-12-LNX, id:L0355
@test "build with output full writes the base with the overlay applied, as a .dts and its .dtb" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
	aa config output full >/dev/null
	run_json build
	assert_success
	assert_json '.ok' true
	assert_json '.message' 'Compiled devicetree'
	assert_json '.path' "$PROJECT/build/overlay.dtb"
	assert_json '.source' "$PROJECT/build/overlay.dts"
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
	run grep -c '^#include ".*bcm2711-rpi-4-b.dts"$' "$PROJECT/build/overlay.dts"
	assert_output 1
	run cat "$PROJECT/build/overlay.dts"
	assert_line '&spi0 {'
	assert_output --partial 'compatible = "adi,adxl345";'
	[ "$(head -c 4 "$PROJECT/build/overlay.dtb" | od -An -tx1 | tr -d ' ')" = d00dfeed ]
	run dtc -I dtb -O dts "$PROJECT/build/overlay.dtb"
	# dtc 1.7.0 prints a string list as "a\0b", later ones as "a", "b"
	assert_output --partial 'compatible = "raspberrypi,4-model-b'
	assert_output --partial 'compatible = "adi,adxl345";'
	refute_output --partial '__fixups__'
}

# Description: with output full, build says in human mode which two files it wrote.
# Steps:
#   1. Create the overlay with init and set output to full.
#   2. Run build; check it succeeds and prints Build completed successfully, then the absolute
#      paths of overlay.dts and overlay.dtb in the build folder, one per line.
# bats test_tags=req:BUILD-03, req:BUILD-01-LNX-FULL, id:L0356
@test "build with output full names the .dts and the .dtb it wrote" {
	with_overlay
	aa config output full >/dev/null
	run aa build
	assert_success
	assert_line --index 0 "Build completed successfully"
	assert_line --index 1 "  $PROJECT/build/overlay.dts"
	assert_line --index 2 "  $PROJECT/build/overlay.dtb"
}

# Description: with output full, a failed compile shows dtc's messages, says the build failed,
# and writes no .dtb.
# Steps:
#   1. Create the overlay with init, replace it with one where two nodes share a label, and set
#      output to full.
#   2. Run build, with --json; check .ok is false, severity error, and the message starts with
#      Build failed: and holds dtc's duplicate label error.
#   3. Check no .dtb was written.
# bats test_tags=req:BUILD-07, req:BUILD-01-LNX-FULL, id:L0357
@test "with output full, a failed compile shows dtc's messages and says the build failed" {
	with_overlay
	duplicate_labels
	aa config output full >/dev/null
	run_json build
	assert_success
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | startswith("Build failed:\n")' true
	assert_json '.message | test("Duplicate label .x.")' true
	[ ! -e "$PROJECT/build/overlay.dtb" ]
}
