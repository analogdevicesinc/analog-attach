# build where the backend is linux: the overlay compiled into a .dtbo with the bundled dtc.

# bats file_tags=eco:linux

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

# bats test_tags=req:BUILD-01, req:BUILD-01-LNX
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

# bats test_tags=req:BUILD-01-LNX
@test "build replaces an earlier .dtbo" {
	with_overlay
	echo old >"$PROJECT/overlay.dtbo"
	run_json build
	assert_json '.ok' true
	run cat "$PROJECT/overlay.dtbo"
	refute_output old
}

# bats test_tags=req:BUILD-02
@test "build with no workfile says how to create it, and compiles nothing" {
	run_config_error build
	assert_json '.errors[0].field' workfile
	assert_json '.errors[0].message' "workfile: $WORKFILE does not exist"
	assert_json '.hints[0]' "Run 'analog-attach init' to create it, or 'analog-attach config workfile <name>' to use another."
	[ ! -e "$PROJECT/overlay.dtbo" ]
	run aa build
	assert_output --partial "Run 'analog-attach init' to create it"
}

# bats test_tags=req:BUILD-02
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

# bats test_tags=req:BUILD-02
@test "build reports a base devicetree the preprocessor can't read" {
	with_overlay
	aa config preprocess-command 'no-such-cpp -o {output} {input}' >/dev/null
	run_config_error build
	assert_json '.errors | length > 0' true
	assert_json '[.errors[].message] | join(" ") | test("no-such-cpp")' true
	[ ! -e "$PROJECT/overlay.dtbo" ]
}

# bats test_tags=req:BUILD-03
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
# bats test_tags=req:BUILD-03, gap
@test "build reports where the output is in the same form as the other ecosystems" {
	with_overlay
	run aa build
	assert_success
	assert_line "Build completed successfully"
	assert_line "  $PROJECT/overlay.dtbo"
}

# bats test_tags=req:BUILD-07
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
