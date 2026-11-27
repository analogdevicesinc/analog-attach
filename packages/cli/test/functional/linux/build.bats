# build where the backend is linux: the project's aa_build.sh run, whose starter (init writes it)
# compiles the overlay into a .dtbo with the dtc on PATH.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, workfile overlay.dtso
# set but not created yet; each test creates the overlay (and with it the starter aa_build.sh) when
# it needs one.
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

# `build_script <lines>`: the project's aa_build.sh, executable: #!/bin/sh, then the lines.
build_script() {
	printf '#!/bin/sh\n%s\n' "$1" >"$PROJECT/aa_build.sh"
	chmod +x "$PROJECT/aa_build.sh"
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
#   1. Write a aa_build.sh, then run build, with --json, before any init.
#   2. Check it is refused, the one error is on workfile and says it does not exist, and the
#      hint points to init and config workfile.
#   3. Check no .dtbo was written.
#   4. Run build in human mode; check it points to init too.
# bats test_tags=req:BUILD-02, id:L0035
@test "build with no workfile says how to create it, and compiles nothing" {
	build_script 'touch ran'
	run_config_error build
	assert_json '.errors | length' 1
	assert_json '.errors[0].field' workfile
	assert_json '.errors[0].message' "workfile: $WORKFILE does not exist"
	assert_json '.hints[0]' "Run 'analog-attach init' to create it, or 'analog-attach config workfile <name>' to use another."
	[ ! -e "$PROJECT/ran" ]
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
	run aa build
	assert_output --partial "Run 'analog-attach init' to create it"
}

# Description: with no dtc on PATH, the starter aa_build.sh stops, saying how to install dtc, and
# build is refused with that.
# Steps:
#   1. Create the overlay with init (which writes the starter aa_build.sh).
#   2. Run build, with --json, with a PATH that has everything but dtc; check it is refused
#      with the type tool-failed, the message saying AA_BUILD exited with status 1, then the
#      script's line that dtc is not on PATH and how to install it.
#   3. Check no .dtbo was written.
# bats test_tags=req:BUILD-02, req:BUILD-07, id:L0036
@test "build reports a dtc that isn't on PATH" {
	with_overlay
	local bin
	bin=$(path_without dtc)
	PATH="$bin" run_json build
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' tool-failed
	assert_json '.message' $'Build failed: AA_BUILD exited with status 1\naa_build.sh: dtc 1.6.0 or later is not on PATH: install it (the device-tree-compiler package)'
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
}

# Description: with output devicetree, which needs the base, build fails with a configuration
# error when the preprocessor can't read the base devicetree, naming the preprocessor, and runs
# no aa_build.sh.
# Steps:
#   1. Create the overlay with init, set output to devicetree, and replace aa_build.sh with one
#      that leaves a mark when it runs.
#   2. Set AA_PREPROCESS_COMMAND to a command that does not exist, no-such-cpp.
#   3. Run build, with --json; check it is refused and an error mentions no-such-cpp.
#   4. Check aa_build.sh didn't run and no .dtb was written.
# bats test_tags=req:BUILD-02, req:BUILD-01-LNX-FULL, id:L0037
@test "build reports a base devicetree the preprocessor can't read" {
	with_overlay
	aa config output devicetree >/dev/null
	build_script 'touch ran'
	aa config var AA_PREPROCESS_COMMAND 'no-such-cpp -o "$AA_PREPROCESS_OUTPUT" "$AA_PREPROCESS_INPUT"' >/dev/null
	run_config_error build
	assert_json '.errors | length > 0' true
	assert_json '[.errors[].message] | join(" ") | test("no-such-cpp")' true
	[ ! -e "$PROJECT/ran" ]
	[ ! -e "$PROJECT/build/overlay.dtb" ]
}

# Description: build reports the absolute path of the .dtbo it wrote.
# Steps:
#   1. Create the overlay with init.
#   2. Run build, with --json; check the path is the project's build/overlay.dtbo and the message is
#      Built <workfile> with AA_BUILD.
#   3. Run build in human mode; check the output shows that path.
# bats test_tags=req:BUILD-03, id:L0038
@test "build reports the absolute path of the .dtbo" {
	with_overlay
	run_json build
	assert_json '.path' "$PROJECT/build/overlay.dtbo"
	assert_json '.message' "Built $WORKFILE with AA_BUILD"
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
#   2. Run build; check it is refused (exit 0), standard output is Build failed: AA_BUILD exited
#      with status <n> alone, and dtc's duplicate label error is on standard error.
#   3. Check no .dtbo was written.
#   4. Run build, with --json; check .ok is false, severity error, and the message is that
#      line, then a newline and dtc's error.
# bats test_tags=req:BUILD-07, id:L0040
@test "a failed compile shows dtc's messages and says the build failed" {
	with_overlay
	duplicate_labels
	run --separate-stderr aa build
	assert_success  # a refusal: the command ran (GEN-09)
	assert_output --regexp '^Build failed: AA_BUILD exited with status [1-9][0-9]*$'
	[[ "$stderr" == *"ERROR (duplicate_label)"* ]] || fail "no dtc error on standard error: $stderr"
	[[ "$stderr" == *"Duplicate label 'x'"* ]] || fail "no dtc error on standard error: $stderr"
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
	run_json build
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | test("^Build failed: AA_BUILD exited with status [0-9]+\n")' true
	assert_json '.message | test("ERROR \\(duplicate_label\\)")' true
}

# Description: with output devicetree, build writes the base devicetree with the overlay applied, as a
# .dts in the build folder that includes the base and adds the overlay's nodes, and compiles it
# into a .dtb: the base's nodes and the added one in one tree, with nothing left for a loader to
# resolve.
# Steps:
#   1. Create the overlay with init, add adi,adxl345 under spi0, and set output to devicetree.
#   2. Run build, with --json; check it succeeds with Built <workfile> with AA_BUILD, path the
#      build folder's overlay.dtb and source its overlay.dts, and that no .dtbo was written.
#   3. Check overlay.dts includes the base devicetree and has a &spi0 block with the adxl345.
#   4. Decompile overlay.dtb with the bundled dtc; check it has the base's board compatible and
#      the adxl345 compatible, and no __fixups__.
# bats test_tags=req:BUILD-01, req:BUILD-01-LNX-FULL, req:SET-12-LNX, id:L0355
@test "build with output devicetree writes the base with the overlay applied, as a .dts and its .dtb" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
	aa config output devicetree >/dev/null
	run_json build
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Built $WORKFILE with AA_BUILD"
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

# Description: with output devicetree, build says in human mode which two files it wrote.
# Steps:
#   1. Create the overlay with init and set output to devicetree.
#   2. Run build; check it succeeds and standard output is Build completed successfully, then
#      the absolute paths of overlay.dts and overlay.dtb in the build folder, one per line; the
#      progress line is on standard error.
# bats test_tags=req:BUILD-03, req:BUILD-01-LNX-FULL, id:L0356
@test "build with output devicetree names the .dts and the .dtb it wrote" {
	with_overlay
	aa config output devicetree >/dev/null
	run --separate-stderr aa build
	assert_success
	[[ "$stderr" == *"Building $WORKFILE with AA_BUILD"* ]] || fail "no progress line: $stderr"
	assert_line --index 0 "Build completed successfully"
	assert_line --index 1 "  $PROJECT/build/overlay.dts"
	assert_line --index 2 "  $PROJECT/build/overlay.dtb"
}

# Description: with output devicetree, a fragment whose target names no node is refused with error
# type unresolved, as validate and import report a target that names no node, and nothing is
# written.
# Steps:
#   1. Create the overlay with init, replace it with one whose fragment@0 targets &nothere, and set
#      output to devicetree.
#   2. Run build, with --json; check .ok is false, error type unresolved, and the message is
#      Build failed: the target of fragment@0 is in neither the base devicetree nor the overlay.
#   3. Check no .dtb was written.
# bats test_tags=req:BUILD-01-LNX-FULL, req:GEN-17, id:L0474
@test "with output devicetree, a target that names no node is refused as unresolved" {
	with_overlay
	printf '/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&nothere>;\n\t\t__overlay__ {\n\t\t\tstatus = "okay";\n\t\t};\n\t};\n};\n' >"$WORKFILE"
	aa config output devicetree >/dev/null
	run_json build
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' unresolved
	assert_json '.message' 'Build failed: the target of fragment@0 is in neither the base devicetree nor the overlay'
	[ ! -e "$PROJECT/build/overlay.dtb" ]
}

# Description: with output devicetree, a failed compile shows dtc's messages, says the build failed,
# and writes no .dtb.
# Steps:
#   1. Create the overlay with init, replace it with one where two nodes share a label, and set
#      output to devicetree.
#   2. Run build, with --json; check .ok is false, severity error, and the message starts with
#      Build failed: AA_BUILD exited with status <n> and holds dtc's duplicate label error.
#   3. Check no .dtb was written.
# bats test_tags=req:BUILD-07, req:BUILD-01-LNX-FULL, id:L0357
@test "with output devicetree, a failed compile shows dtc's messages and says the build failed" {
	with_overlay
	duplicate_labels
	aa config output devicetree >/dev/null
	run_json build
	assert_success
	assert_json '.ok' false
	assert_json '.severity' error
	assert_json '.message | test("^Build failed: AA_BUILD exited with status [0-9]+\n")' true
	assert_json '.message | test("Duplicate label .x.")' true
	[ ! -e "$PROJECT/build/overlay.dtb" ]
}

# Description: with output devicetree, a fragment on a node a later fragment of the overlay adds is
# written after that fragment, so dtc finds the node, and its properties replace those of the
# fragment that adds it, as the Raspberry Pi loader merges them.
# Steps:
#   1. Create the overlay with init, replace it with one whose fragment@0 targets &ts and sets
#      touchscreen-inverted-x and touchscreen-size-x = <480>, and whose fragment@1 adds ts: ts@38
#      under i2c1 with touchscreen-size-x = <800>; set output to devicetree.
#   2. Run build, with --json; check it succeeds.
#   3. Check overlay.dts has the &i2c1 block before the block for /soc/i2c@7e804000/ts@38.
#   4. Decompile overlay.dtb; check ts@38 has its reg, touchscreen-inverted-x and
#      touchscreen-size-x = <0x1e0> (480), not <0x320> (800).
# bats test_tags=req:BUILD-01, req:BUILD-01-LNX-FULL, id:L0389
@test "with output devicetree, a fragment on a node a later fragment adds is applied after it" {
	with_overlay
	printf '/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&ts>;\n\t\t__overlay__ {\n\t\t\ttouchscreen-inverted-x;\n\t\t\ttouchscreen-size-x = <480>;\n\t\t};\n\t};\n\tfragment@1 {\n\t\ttarget = <&i2c1>;\n\t\t__overlay__ {\n\t\t\tts: ts@38 {\n\t\t\t\tcompatible = "edt,edt-ft5406";\n\t\t\t\treg = <0x38>;\n\t\t\t\ttouchscreen-size-x = <800>;\n\t\t\t};\n\t\t};\n\t};\n};\n' >"$WORKFILE"
	aa config output devicetree >/dev/null
	run_json build
	assert_success
	assert_json '.ok' true
	local adds waits
	adds="$(grep -n '^&i2c1 {$' "$PROJECT/build/overlay.dts" | cut -d: -f1)"
	waits="$(grep -nF '&{/soc/i2c@7e804000/ts@38} {' "$PROJECT/build/overlay.dts" | cut -d: -f1)"
	[ -n "$adds" ] && [ -n "$waits" ] || fail "blocks missing: $(cat "$PROJECT/build/overlay.dts")"
	[ "$adds" -lt "$waits" ] || fail "the &ts block comes before the one adding ts@38"
	run dtc -I dtb -O dts "$PROJECT/build/overlay.dtb"
	assert_output --partial 'reg = <0x38>;'
	assert_output --partial 'touchscreen-inverted-x;'
	assert_output --partial 'touchscreen-size-x = <0x1e0>;'
	refute_output --partial 'touchscreen-size-x = <0x320>;'
}

# Description: with output devicetree, a label the overlay defines that the base has on another node is
# written as <label>_1 in the full devicetree, and so are the overlay's references to it, so dtc
# finds no duplicate label; the workfile keeps its own label.
# Steps:
#   1. Create the overlay with init, replace it with one that adds uart0_pins: uart0_ovl_pins
#      under gpio (the RPi 4 base has uart0_pins on another node of gpio) and sets
#      pinctrl-0 = <&uart0_pins> on uart0; set output to devicetree.
#   2. Run build, with --json; check it succeeds.
#   3. Check overlay.dts has uart0_pins_1: uart0_ovl_pins and pinctrl-0 = <&uart0_pins_1>.
#   4. Check the workfile still has uart0_pins: uart0_ovl_pins and <&uart0_pins>.
# bats test_tags=req:BUILD-01, req:BUILD-01-LNX-FULL, id:L0390
@test "with output devicetree, an overlay label the base has on another node is renamed" {
	with_overlay
	printf '/dts-v1/;\n/plugin/;\n/ {\n\tfragment@0 {\n\t\ttarget = <&gpio>;\n\t\t__overlay__ {\n\t\t\tuart0_pins: uart0_ovl_pins {\n\t\t\t\tbrcm,pins = <14 15>;\n\t\t\t\tbrcm,function = <4>;\n\t\t\t};\n\t\t};\n\t};\n\tfragment@1 {\n\t\ttarget = <&uart0>;\n\t\t__overlay__ {\n\t\t\tpinctrl-names = "default";\n\t\t\tpinctrl-0 = <&uart0_pins>;\n\t\t};\n\t};\n};\n' >"$WORKFILE"
	aa config output devicetree >/dev/null
	run_json build
	assert_success
	assert_json '.ok' true
	run cat "$PROJECT/build/overlay.dts"
	assert_output --partial 'uart0_pins_1: uart0_ovl_pins {'
	assert_output --partial 'pinctrl-0 = <&uart0_pins_1>;'
	run cat "$WORKFILE"
	assert_output --partial 'uart0_pins: uart0_ovl_pins {'
	assert_output --partial 'pinctrl-0 = <&uart0_pins>;'
}

# --- The script: aa_build.sh -------------------------------------------------------------------

# Description: with no aa_build.sh at the project root, build is refused with a configuration error
# that says how to write the starter, and doesn't write one itself; the restore command then
# makes build work.
# Steps:
#   1. Create the overlay with init and remove aa_build.sh.
#   2. Run build, with --json; check it is refused, the one error is on aa_build.sh, kind missing,
#      type not-generated, saying aa_build.sh is not found in the project, and the hint is
#      init --restore build.
#   3. Run build in human mode; check it says the same, then the hint.
#   4. Check no aa_build.sh was written.
#   5. Run init --restore build, then build; check it succeeds and the .dtbo is there.
# bats test_tags=req:SET-14-LNX, req:BUILD-02, id:L0405
@test "build with no aa_build.sh says how to restore it, and doesn't write one itself" {
	with_overlay
	rm "$PROJECT/aa_build.sh"
	run_config_error build
	assert_json '.errors | length' 1
	assert_json '.errors[0] | [.field, .kind, .error_type] | join(" ")' 'aa_build.sh missing not-generated'
	assert_json '.errors[0].message' "aa_build.sh not found in $PROJECT"
	assert_json '.hints[0]' "Run 'analog-attach init --restore build' to write the starter aa_build.sh, or set AA_BUILD to another command ('analog-attach config var AA_BUILD <command>')."
	run --separate-stderr aa build
	assert_success
	assert_output "$(printf 'aa_build.sh not found in %s\n\nRun %s to write the starter aa_build.sh, or set AA_BUILD to another command (%s).' "$PROJECT" "'analog-attach init --restore build'" "'analog-attach config var AA_BUILD <command>'")"
	[ ! -e "$PROJECT/aa_build.sh" ]
	aa init --restore build >/dev/null
	run_json build
	assert_json '.ok' true
	[ -f "$PROJECT/build/overlay.dtbo" ]
}

# Description: a aa_build.sh that isn't executable, or a folder of that name, is refused with a
# configuration error saying how to fix it; nothing runs.
# Steps:
#   1. Create the overlay with init and make aa_build.sh not executable.
#   2. Run build, with --json; check it is refused, the error is on aa_build.sh, kind invalid,
#      type tool-missing, saying it is not executable, with the hint chmod +x.
#   3. Replace aa_build.sh with a folder; run build, with --json; check the error says it is not a
#      file and the hint says to move it away, then init --restore build.
# bats test_tags=req:SET-14-LNX, req:BUILD-02, id:L0406
@test "build refuses a aa_build.sh that isn't an executable file" {
	with_overlay
	chmod -x "$PROJECT/aa_build.sh"
	run_config_error build
	assert_json '.errors[0] | [.field, .kind, .error_type] | join(" ")' 'aa_build.sh invalid tool-missing'
	assert_json '.errors[0].message' "$PROJECT/aa_build.sh is not executable"
	assert_json '.hints[0]' "Run 'chmod +x $PROJECT/aa_build.sh'."
	rm "$PROJECT/aa_build.sh"
	mkdir "$PROJECT/aa_build.sh"
	run_config_error build
	assert_json '.errors[0].message' "$PROJECT/aa_build.sh is not a file"
	assert_json '.hints[0]' "Move it away, then run 'analog-attach init --restore build'."
	[ ! -e "$PROJECT/build/overlay.dtbo" ]
}

# Description: build runs aa_build.sh in the project root with the system variables and the
# project's plain variables in its environment; no secret reaches it, not even one the caller's
# environment has, and an AA_ variable of the caller's is replaced or dropped.
# Steps:
#   1. Create the overlay with init; set the variable BOARD_IP and the secret BOARD_PASSWORD.
#   2. Replace aa_build.sh with one that writes its folder and environment to a file.
#   3. Run build, with --json, with BOARD_PASSWORD, AA_DTBO and AA_OLD in the environment; check
#      it succeeds with a warning, as no .dtbo was written.
#   4. Check the script ran in the project, and had AA_PROJECT, AA_OUTPUT, AA_BUILD_DIR, AA_DTSO,
#      AA_DTBO (the CLI's, not the caller's), AA_DTC, AA_LINUX and BOARD_IP; and neither
#      BOARD_PASSWORD, AA_OLD nor AA_DTS and AA_DTB (for the other output).
#   5. Set output to devicetree, run build; check the script had AA_DTS (the preprocessed full
#      devicetree, which exists) and AA_DTB, and no AA_DTBO.
# bats test_tags=req:SET-15-LNX, req:SET-16-LNX, id:L0407
@test "aa_build.sh gets the AA_ variables and the project's, never a secret" {
	with_overlay
	aa config var BOARD_IP 10.0.0.5 >/dev/null
	aa config var BOARD_PASSWORD --secret >/dev/null
	build_script 'pwd >env.txt; env | grep -E "^(AA_|BOARD_)" | sort >>env.txt'
	BOARD_PASSWORD=hunter2 AA_DTBO=/elsewhere AA_OLD=x run_json build
	assert_success
	assert_json '.ok' true
	assert_json '.error_type' output-missing
	run cat "$PROJECT/env.txt"
	assert_line --index 0 "$PROJECT"
	assert_line "AA_PROJECT=$PROJECT"
	assert_line "AA_OUTPUT=overlay"
	assert_line "AA_BUILD_DIR=$PROJECT/build"
	assert_line "AA_DTSO=$WORKFILE"
	assert_line "AA_DTBO=$PROJECT/build/overlay.dtbo"
	assert_line "AA_DTC=$(command -v dtc)"
	assert_line "AA_LINUX=$LINUX_TREE"
	assert_line "BOARD_IP=10.0.0.5"
	refute_output --partial BOARD_PASSWORD
	refute_output --partial hunter2
	refute_output --partial AA_OLD
	refute_output --partial AA_DTS=
	refute_output --partial AA_DTB=
	aa config output devicetree >/dev/null
	run_json build
	assert_json '.ok' true
	run cat "$PROJECT/env.txt"
	assert_line "AA_DTS=$PROJECT/.analog-attach/linux/build.preprocessed.dts"
	assert_line "AA_DTB=$PROJECT/build/overlay.dtb"
	refute_output --partial AA_DTBO=
	[ -s "$PROJECT/.analog-attach/linux/build.preprocessed.dts" ]
}

# Description: a aa_build.sh that succeeds but leaves no output file gives a warning, not a success
# with a path.
# Steps:
#   1. Create the overlay with init and replace aa_build.sh with one that only exits 0.
#   2. Run build, with --json; check .ok is true, severity warn, type output-missing, the message
#      saying AA_BUILD succeeded but the .dtbo is not there, and no path.
#   3. Check the warning is on standard error.
# bats test_tags=req:BUILD-03, id:L0408
@test "a aa_build.sh that leaves no output file gives a warning" {
	with_overlay
	build_script 'exit 0'
	run_json build
	assert_success
	assert_json '.ok' true
	assert_json '.severity' warn
	assert_json '.error_type' output-missing
	assert_json '.message' "AA_BUILD succeeded, but $PROJECT/build/overlay.dtbo is not there"
	assert_json 'has("path")' false
	[[ "$stderr" == *"warning: AA_BUILD succeeded, but $PROJECT/build/overlay.dtbo is not there"* ]] || fail "standard error: $stderr"
}

# Description: build shows what aa_build.sh writes on standard error as it runs, after a progress
# line, so standard output has the result alone; in JSON mode too.
# Steps:
#   1. Create the overlay with init and replace aa_build.sh with one that writes a line to each
#      stream, then runs the starter's compile.
#   2. Run build; check standard output is Build completed successfully and the .dtbo's path
#      alone, and standard error has the progress line and both of the script's lines.
#   3. Run build, with --json; check standard output is the JSON alone and standard error has
#      the script's lines.
# bats test_tags=req:BUILD-07, req:SET-14-LNX, id:L0409
@test "aa_build.sh's output is on standard error, the result alone on standard output" {
	with_overlay
	build_script 'echo to-stdout; echo to-stderr >&2; mkdir -p "$AA_BUILD_DIR"; "$AA_DTC" -@ -I dts -O dtb -o "$AA_DTBO" "$AA_DTSO"'
	run --separate-stderr aa build
	assert_success
	assert_output "$(printf 'Build completed successfully\n\n  %s' "$PROJECT/build/overlay.dtbo")"
	[[ "$stderr" == *"Building $WORKFILE with AA_BUILD"* ]] || fail "no progress line: $stderr"
	[[ "$stderr" == *to-stdout* && "$stderr" == *to-stderr* ]] || fail "the script's lines aren't on standard error: $stderr"
	run_json build
	assert_json '.ok' true
	[[ "$stderr" == *to-stdout* ]] || fail "standard error: $stderr"
}

# --- The command: AA_BUILD ------------------------------------------------------------------

# Description: build runs AA_BUILD, a command of the project's in place of aa_build.sh: a shell
# script of several lines, run with sh in the project root with the scripts' variables, whose
# output is shown; aa_build.sh then isn't needed, and --reset brings it back.
# Steps:
#   1. Create the overlay with init, remove aa_build.sh, and set AA_BUILD to three lines: echo a
#      marker with the working directory, make the build folder, compile $AA_DTSO into $AA_DTBO
#      with $AA_DTC.
#   2. Run build in a folder under the project; check it succeeds with the .dtbo's path on
#      standard output, and standard error has the progress line naming AA_BUILD and the marker
#      with the project root.
#   3. Run build, with --json; check the message is Built <workfile> with AA_BUILD and the path
#      the .dtbo.
#   4. Reset AA_BUILD, run build, with --json; check it is refused: aa_build.sh is not found.
# bats test_tags=req:BUILD-01-LNX, req:SET-17-LNX, req:BUILD-07, id:L0495
@test "build runs AA_BUILD, a shell script of the project's, in place of aa_build.sh" {
	with_overlay
	rm "$PROJECT/aa_build.sh"
	aa config var AA_BUILD $'echo "hello from AA_BUILD in $(pwd)"\nmkdir -p "$AA_BUILD_DIR"\n"$AA_DTC" -@ -I dts -O dtb -o "$AA_DTBO" "$AA_DTSO"' >/dev/null
	mkdir "$PROJECT/sub"
	cd "$PROJECT/sub"
	run --separate-stderr aa build
	cd "$PROJECT"
	assert_success
	assert_output "$(printf 'Build completed successfully\n\n  %s' "$PROJECT/build/overlay.dtbo")"
	[[ "$stderr" == *"Building $WORKFILE with AA_BUILD"* ]] || fail "no progress line: $stderr"
	[[ "$stderr" == *"hello from AA_BUILD in $PROJECT"* ]] || fail "the command's line isn't on standard error: $stderr"
	run_json build
	assert_json '.message' "Built $WORKFILE with AA_BUILD"
	assert_json '.path' "$PROJECT/build/overlay.dtbo"
	aa config var AA_BUILD --reset >/dev/null
	run_config_error build
	assert_json '.errors[0].message' "aa_build.sh not found in $PROJECT"
}
