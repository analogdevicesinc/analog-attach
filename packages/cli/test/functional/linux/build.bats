# build where the backend is linux: the overlay compiled into a .dtbo with the bundled dtc.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, workfile overlay.dtso
# set but not created yet; each test creates the overlay when it needs one.
setup() {
	load ../helpers
	new_project linux
}

# `run_config_error <words>`: run_json for a configuration error, which is JSON on standard
# error (exit 2): $output is that JSON.
run_config_error() {
	run_json "$@"
	assert_failure 2
	output=$stderr
}

# `install_without_dtc`: a copy of the installation (dist, package.json, bundled dt-schema and
# tools) without the bundled dtc; prints the path of its cli.js.
install_without_dtc() {
	local copy="$BATS_TEST_TMPDIR/install"
	mkdir -p "$copy/bundled/linux/tools"
	cp -r "$CLI_DIR/dist" "$CLI_DIR/package.json" "$copy/"
	ln -s "$REPO_DIR/node_modules" "$copy/node_modules"
	ln -s "$CLI_DIR/bundled/linux/dt-schema" "$copy/bundled/linux/dt-schema"
	ln -s "$CLI_DIR/bundled/linux/tools/dt-mk-schema" "$CLI_DIR/bundled/linux/tools/dt-validate" \
		"$copy/bundled/linux/tools/"
	echo "$copy/dist/cli.js"
}

# `duplicate_labels`: an overlay that parses but dtc refuses: two nodes with one label.
duplicate_labels() {
	printf '/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&spi0>;\n\t\t__overlay__ {\n\t\t\tx: a@0 { reg = <0>; };\n\t\t\tx: b@1 { reg = <1>; };\n\t\t};\n\t};\n};\n' >"$WORKFILE"
}

# Description: build compiles the overlay into a .dtbo next to it, with the added node in it and
# the reference to the base's spi0 left as a fixup for the loader.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Run build, with --json; check it succeeds (.ok true).
#   3. Check overlay.dtbo exists and starts with the flattened devicetree magic d00dfeed.
#   4. Decompile it with the bundled dtc; check it has the adxl345 compatible and a __fixups__
#      entry for spi0 on fragment@0's target.
# bats test_tags=req:BUILD-01, req:BUILD-01-LNX, id:L0033
@test "build compiles the overlay into a .dtbo next to it" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	run_json build
	assert_success
	assert_json '.ok' true
	local dtbo="$PROJECT/overlay.dtbo"
	[ -f "$dtbo" ]
	# A flattened device tree: magic d00dfeed.
	[ "$(head -c 4 "$dtbo" | od -An -tx1 | tr -d ' ')" = d00dfeed ]
	# The added node is in it, and the reference to the base's spi0 is left for the loader.
	run "$CLI_DIR/bundled/linux/tools/dtc" -I dtb -O dts "$dtbo"
	assert_output --partial 'compatible = "adi,adxl345";'
	assert_output --partial '__fixups__'
	assert_output --partial 'spi0 = "/fragment@0:target:0";'
}

# Description: build replaces an earlier .dtbo.
# Steps:
#   1. Create the overlay with init and write overlay.dtbo holding old.
#   2. Run build, with --json; check it succeeds (.ok true).
#   3. Check overlay.dtbo no longer holds old.
# bats test_tags=req:BUILD-01-LNX, id:L0034
@test "build replaces an earlier .dtbo" {
	with_overlay
	echo old >"$PROJECT/overlay.dtbo"
	run_json build
	assert_json '.ok' true
	run cat "$PROJECT/overlay.dtbo"
	refute_output old
}

# Description: build with no workfile fails with a configuration error saying how to create it,
# and compiles nothing.
# Steps:
#   1. Run build, with --json, before any init.
#   2. Check it fails with exit 2, the error is on workfile and says it does not exist, and the
#      hint points to init and config workfile.
#   3. Check no .dtbo was written.
#   4. Run build in human mode; check it points to init too.
# bats test_tags=req:BUILD-02, id:L0035
@test "build with no workfile says how to create it, and compiles nothing" {
	run_config_error build
	assert_json '.errors[0].field' workfile
	assert_json '.errors[0].message' "workfile: $WORKFILE does not exist"
	assert_json '.hints[0]' "Run 'analog-attach init' to create it, or 'analog-attach config workfile <name>' to use another."
	[ ! -e "$PROJECT/overlay.dtbo" ]
	run aa build
	assert_output --partial "Run 'analog-attach init' to create it"
}

# Description: build fails with a configuration error when the bundled dtc is missing, saying the
# installation is incomplete.
# Steps:
#   1. Create the overlay with init.
#   2. Copy the installation without the bundled dtc.
#   3. Run that copy's build, with --json; check it fails with exit 2, the error is on tools and
#      names the missing dtc, and the hint says to rebuild the installation.
#   4. Check no .dtbo was written.
# bats test_tags=req:BUILD-02, id:L0036
@test "build reports a bundled dtc that is missing" {
	with_overlay
	local cli
	cli=$(install_without_dtc)
	run --separate-stderr node "$cli" --json build
	assert_failure 2
	output=$stderr
	assert_json '.errors[0].field' tools
	assert_json '.errors[0].message' "Bundled tools not found: $BATS_TEST_TMPDIR/install/bundled/linux/tools/dtc"
	assert_json '.hints[0]' 'The analog-attach installation is incomplete; rebuild it (scripts/bundle-dt-schema.sh).'
	[ ! -e "$PROJECT/overlay.dtbo" ]
}

# Description: build fails with a configuration error when the preprocessor can't read the base
# devicetree, naming the preprocessor.
# Steps:
#   1. Create the overlay with init.
#   2. Set preprocess-command to a command that does not exist, no-such-cpp.
#   3. Run build, with --json; check it fails with exit 2 and an error mentions no-such-cpp.
#   4. Check no .dtbo was written.
# bats test_tags=req:BUILD-02, id:L0037
@test "build reports a base devicetree the preprocessor can't read" {
	with_overlay
	aa config preprocess-command 'no-such-cpp -o {output} {input}' >/dev/null
	run_config_error build
	assert_json '.errors | length > 0' true
	assert_json '[.errors[].message] | join(" ") | test("no-such-cpp")' true
	[ ! -e "$PROJECT/overlay.dtbo" ]
}

# Description: build reports the absolute path of the .dtbo it wrote.
# Steps:
#   1. Create the overlay with init.
#   2. Run build, with --json; check the path is the project's overlay.dtbo and the message is
#      Compiled overlay.
#   3. Run build in human mode; check the output shows that path.
# bats test_tags=req:BUILD-03, id:L0038
@test "build reports the absolute path of the .dtbo" {
	with_overlay
	run_json build
	assert_json '.path' "$PROJECT/overlay.dtbo"
	assert_json '.message' 'Compiled overlay'
	run aa build
	assert_output --partial "$PROJECT/overlay.dtbo"
}

# Gap: Linux writes `Wrote <path>` on one line; noos writes `Build completed successfully`
# and the path on the next line, two spaces in.
# Description: build reports where its output is in the same form as the other ecosystems: a
# success line, then the path on the next line.
# Steps:
#   1. Create the overlay with init.
#   2. Run build; check it succeeds.
#   3. Check it prints Build completed successfully, and the .dtbo's path on a line indented by
#      two spaces.
# bats test_tags=req:BUILD-03, gap, id:L0039
@test "build reports where the output is in the same form as the other ecosystems" {
	with_overlay
	run aa build
	assert_success
	assert_line "Build completed successfully"
	assert_line "  $PROJECT/overlay.dtbo"
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
	[ ! -e "$PROJECT/overlay.dtbo" ]
	run_json build
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | startswith("Build failed:\n")' true
	assert_json '.message | test("ERROR \\(duplicate_label\\)")' true
}
