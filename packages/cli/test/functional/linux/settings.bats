# The settings of linux (SET-*): what each one does.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree, its settings
# in the project's settings file, no user settings and no workfile yet. with_accel makes an
# overlay with an ADXL345 on i2c1 (label adxl345); stub puts a logging stand-in tool on PATH.
setup() {
	load ../helpers
	new_project linux
}

# `field <key> <jq filter>`: the filter on the `config --json <key>` entry of a setting.
field() {
	aa --json config "$1" | jq -r ".configs[0] | $2"
}

# `with_accel`: an overlay with an ADXL345 on i2c1 (label adxl345).
with_accel() {
	with_overlay
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
}

# `stub <name> <log>`: a stand-in for a tool on PATH that logs its arguments to <log> (and
# SSHPASS, which sshpass -e reads), then succeeds.
stub() {
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho "SSHPASS=$SSHPASS $*" >>"%s"\n' "$2" >"$BATS_TEST_TMPDIR/bin/$1"
	chmod +x "$BATS_TEST_TMPDIR/bin/$1"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

# --- SET-01: the ecosystem -----------------------------------------------------------------

# Description: the backend setting selects the ecosystem, and is stored in the project's settings.
# Steps:
#   1. Run config backend, with --json.
#   2. Check the value is linux from local, with the option linux alone (noos is not offered:
#      SET-13).
#   3. Check the project's settings file has backend linux.
#   4. Run --help and check it shows Backend: linux.
# bats test_tags=req:SET-01, id:L0264
@test "the backend setting selects the ecosystem and is stored with the project" {
	run_json config backend
	assert_json '.configs[0].value' linux
	assert_json '.configs[0].source' local
	assert_json '.configs[0].type.options | join(",")' linux
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = linux ]
	run aa --help
	assert_output --partial "Backend: linux"
}

# Description: two projects on one machine can each have their own backend.
# Steps:
#   1. Make a second project whose settings file names noos (config can't pick it: SET-13).
#   2. Check config backend there, with --json, gives noos from the local settings.
#   3. Go back to the project and check config backend gives linux.
# bats test_tags=req:SET-01, id:L0265
@test "two projects on one machine can target different ecosystems" {
	mkdir -p "$BATS_TEST_TMPDIR/second/.analog-attach"
	echo '{"backend": "noos"}' >"$BATS_TEST_TMPDIR/second/.analog-attach/config.json"
	cd "$BATS_TEST_TMPDIR/second"
	run_json config backend
	assert_json '.configs[0].value' noos
	assert_json '.configs[0].source' local
	cd "$PROJECT"
	run_json config backend
	assert_json '.configs[0].value' linux
}

# Description: the backend is a project setting; setting it with --global is refused.
# Steps:
#   1. Run config backend linux --global.
#   2. Check the message says backend belongs to the project and can't be global.
#   3. Check the user's settings file does not exist or has no backend.
# bats test_tags=req:SET-01, id:L0266
@test "the backend can't be a user setting" {
	run aa config backend linux --global
	assert_output --partial "backend belongs to the project and can't be in the global settings"
	[ ! -e "$HOME/.config/analog-attach/config.json" ] || [ "$(jq -r '.backend // "none"' "$HOME/.config/analog-attach/config.json")" = none ]
}

# Description: switching the backend to noos and back keeps the linux settings.
# Steps:
#   1. Set overlay-syntax reference, then set backend noos in the settings file (config can't
#      pick it: SET-13).
#   2. Check config overlay-syntax, with --json, fails with a usage error (exit 2): noos has no
#      such setting.
#   3. Run config backend linux.
#   4. Check overlay-syntax is still reference and devicetree still the base devicetree.
# bats test_tags=req:SET-01, id:L0267
@test "switching the backend keeps each ecosystem's settings" {
	aa config overlay-syntax reference
	jq '.backend = "noos"' "$PROJECT/.analog-attach/config.json" >"$BATS_TEST_TMPDIR/config.json"
	mv "$BATS_TEST_TMPDIR/config.json" "$PROJECT/.analog-attach/config.json"
	run_json config overlay-syntax
	assert_failure 2
	aa config backend linux
	run_json config overlay-syntax
	assert_json '.configs[0].value' reference
	run_json config devicetree
	assert_json '.configs[0].value' "$LINUX_BASE"
}

# --- SET-13: CAPI not offered --------------------------------------------------------------

# Description: no project can pick noos: config refuses it, and the help, the hints and
# completion name linux alone; a project set to noos already runs it, and may switch to linux but
# not back.
# Steps:
#   1. Run config backend noos; check it is refused as a value outside the options, and the
#      backend is still linux.
#   2. Check --help names the linux backend and no other.
#   3. In a folder with no settings, run read; check the error names config backend <linux>.
#   4. In a project whose settings file names noos, check --help names noos, and offers linux.
#   5. Run config backend linux there; check it succeeds; run config backend noos; check it is
#      refused and the backend stays linux.
# bats test_tags=req:SET-13, id:L0404
@test "noos can't be picked; a project set to it already runs it" {
	run aa config backend noos
	assert_output --partial 'backend: "noos" is not one of linux'
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = linux ]
	run aa --help
	assert_output --partial "Backend: linux (Linux device tree overlays)."
	refute_output --partial "config backend noos"
	mkdir -p "$BATS_TEST_TMPDIR/empty"
	cd "$BATS_TEST_TMPDIR/empty"
	run aa read
	assert_failure 2
	assert_output --partial "'analog-attach config backend <linux>'"
	mkdir -p "$BATS_TEST_TMPDIR/old/.analog-attach"
	echo '{"backend": "noos"}' >"$BATS_TEST_TMPDIR/old/.analog-attach/config.json"
	cd "$BATS_TEST_TMPDIR/old"
	run aa --help
	assert_output --partial "Backend: noos (no-OS CAPI projects). Another: 'analog-attach config backend linux'."
	run aa config backend linux
	assert_success
	run aa config backend noos
	assert_output --partial 'backend: "noos" is not one of linux'
	[ "$(jq -r .backend "$BATS_TEST_TMPDIR/old/.analog-attach/config.json")" = linux ]
}

# --- SET-03: Linux sources and target ------------------------------------------------------

# Description: linux and devicetree are required path settings; init without them names both and
# creates no workfile.
# Steps:
#   1. Check config gives both as required, of type path.
#   2. Remove the linux and devicetree settings.
#   3. Run init.
#   4. Check the message names both missing settings, and no workfile was created.
# bats test_tags=req:SET-03, id:L0268
@test "linux and devicetree are required paths" {
	[ "$(field linux .required)" = true ]
	[ "$(field linux .type)" = path ]
	[ "$(field devicetree .required)" = true ]
	[ "$(field devicetree .type)" = path ]
	drop_setting linux devicetree
	run aa init
	assert_output --partial "Missing config field linux"
	assert_output --partial "Missing config field devicetree"
	[ ! -e "$WORKFILE" ]
}

# Description: the linux setting names the Linux tree the bindings are read from.
# Steps:
#   1. Create the overlay with init.
#   2. Run list devices adi,adxl345.
#   3. Check it succeeds and names the binding file in the Linux tree's bindings folder.
# bats test_tags=req:SET-03, id:L0269
@test "linux names the Linux tree the bindings come from" {
	with_overlay
	run aa list devices adi,adxl345
	assert_success
	assert_output --partial "binding: $LINUX_TREE/Documentation/devicetree/bindings/iio/accel/adi,adxl345.yaml"
}

# Description: the devicetree setting names the base the overlay applies to; changing it changes
# what read sees of the base.
# Steps:
#   1. Create the overlay with init.
#   2. Run read / model, with --json, and check it is Raspberry Pi 4 Model B, from base.
#   3. Set devicetree to the Raspberry Pi 400 base.
#   4. Run read / model again and check it is Raspberry Pi 400.
# bats test_tags=req:SET-03, id:L0270
@test "devicetree names the base the overlay is for" {
	with_overlay
	run_json read / model
	assert_json '.value' "Raspberry Pi 4 Model B"
	assert_json '.source' base
	aa config devicetree "$LINUX_TREE/arch/arm/boot/dts/broadcom/bcm2711-rpi-400.dts"
	run_json read / model
	assert_json '.value' "Raspberry Pi 400"
}

# --- SET-04: output options ----------------------------------------------------------------

# Description: overlay-syntax is fragment by default, and the overlay is then written with
# fragment and __overlay__ nodes.
# Steps:
#   1. Check config gives overlay-syntax fragment from default, options fragment and reference.
#   2. Make the overlay with the ADXL345 (with_accel).
#   3. Check the overlay has fragment@0 with target = <&i2c_arm>, an __overlay__ node and the
#      adxl345 node.
# bats test_tags=req:SET-04, id:L0271
@test "overlay-syntax is fragment by default: the overlay is written in fragments" {
	[ "$(field overlay-syntax '"\(.value) \(.source)"')" = "fragment default" ]
	[ "$(field overlay-syntax '.type.options | join(",")')" = "fragment,reference" ]
	with_accel
	run cat "$WORKFILE"
	assert_output --partial "fragment@0 {"
	assert_output --partial "target = <&i2c_arm>;"
	assert_output --partial "__overlay__ {"
	assert_output --partial "adxl345: adi,adxl345@0 {"
}

# Description: overlay-syntax reference writes the overlay as references to labels, without
# fragments.
# Steps:
#   1. Set overlay-syntax reference.
#   2. Make the overlay with the ADXL345.
#   3. Check the overlay has an &i2c_arm node holding the adxl345 node.
#   4. Check it has no fragment@ and no __overlay__.
# bats test_tags=req:SET-04, id:L0272
@test "overlay-syntax reference writes the overlay as label references" {
	aa config overlay-syntax reference
	with_accel
	run cat "$WORKFILE"
	assert_output --partial "&i2c_arm {"
	assert_output --partial "adxl345: adi,adxl345@0 {"
	refute_output --partial "fragment@"
	refute_output --partial "__overlay__"
}

# Description: AA_PREPROCESS_COMMAND is the C preprocessor command run on the base devicetree, cpp
# by default, with $AA_LINUX, $AA_PREPROCESS_INPUT and $AA_PREPROCESS_OUTPUT in its environment.
# Steps:
#   1. Check config var AA_PREPROCESS_COMMAND is executable, a cpp command, its default.
#   2. Create the overlay with init, and a preprocessor script that logs its arguments and runs
#      cpp.
#   3. Set AA_PREPROCESS_COMMAND to that script, with -I "$AA_LINUX/include", -o
#      "$AA_PREPROCESS_OUTPUT" and "$AA_PREPROCESS_INPUT".
#   4. Run read spi0, with --json, and check it gives the spi@7e204000 node.
#   5. Check the log shows the script called with the Linux tree's include folder and the base
#      devicetree.
# bats test_tags=req:SET-04, req:SET-17-LNX, id:L0273
@test "AA_PREPROCESS_COMMAND is the C preprocessor run on the base device tree" {
	run_json config var AA_PREPROCESS_COMMAND
	assert_json '.variables[0] | "\(.kind) \(.runs) \(.value == .default)"' "executable preprocess true"
	assert_json '.variables[0].value | test("^cpp ")' true
	with_overlay
	# A preprocessor of the user's: cpp, logging how it was called.
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho "$@" >>"%s"\nexec cpp "$@"\n' "$BATS_TEST_TMPDIR/cpp.log" >"$BATS_TEST_TMPDIR/bin/mycpp"
	chmod +x "$BATS_TEST_TMPDIR/bin/mycpp"
	aa config var AA_PREPROCESS_COMMAND \
		"$BATS_TEST_TMPDIR/bin/mycpp -nostdinc -undef -x assembler-with-cpp -P -I \"\$AA_LINUX/include\" -o \"\$AA_PREPROCESS_OUTPUT\" \"\$AA_PREPROCESS_INPUT\""
	run_json read spi0
	assert_json '.key' "spi@7e204000"
	run grep -F -- "-I $LINUX_TREE/include" "$BATS_TEST_TMPDIR/cpp.log"
	assert_success
	assert_output --partial "$LINUX_BASE"
}

# Description: an AA_PREPROCESS_COMMAND whose tool is not on PATH is named in the error.
# Steps:
#   1. Create the overlay with init.
#   2. Set AA_PREPROCESS_COMMAND to nosuchcpp "$AA_PREPROCESS_INPUT" "$AA_PREPROCESS_OUTPUT".
#   3. Run read spi0.
#   4. Check the message says nosuchcpp was not found on PATH.
# bats test_tags=req:SET-04, id:L0274
@test "an AA_PREPROCESS_COMMAND whose tool is missing is named" {
	with_overlay
	aa config var AA_PREPROCESS_COMMAND 'nosuchcpp "$AA_PREPROCESS_INPUT" "$AA_PREPROCESS_OUTPUT"'
	run aa read spi0
	assert_output --partial "AA_PREPROCESS_COMMAND: nosuchcpp not found on PATH"
}

# Description: an AA_PREPROCESS_COMMAND that is a shell script of several lines isn't checked
# for its tool: it runs with sh, gets the project's variables too, and what it writes to
# $AA_PREPROCESS_OUTPUT is the base.
# Steps:
#   1. Create the overlay with init, and set the project variable MARK to a file.
#   2. Set AA_PREPROCESS_COMMAND to two lines: touch "$MARK", then cpp of $AA_PREPROCESS_INPUT
#      into $AA_PREPROCESS_OUTPUT with "$AA_LINUX/include".
#   3. Run read spi0, with --json, and check it gives the spi@7e204000 node.
#   4. Check the MARK file was made.
# bats test_tags=req:SET-04, req:SET-17-LNX, id:L0494
@test "AA_PREPROCESS_COMMAND runs as a shell script, with the project's variables" {
	with_overlay
	aa config var MARK "$BATS_TEST_TMPDIR/preprocessed" >/dev/null
	aa config var AA_PREPROCESS_COMMAND $'touch "$MARK"\ncpp -nostdinc -undef -x assembler-with-cpp -P -I "$AA_LINUX/include" -o "$AA_PREPROCESS_OUTPUT" "$AA_PREPROCESS_INPUT"' >/dev/null
	run_json read spi0
	assert_json '.key' "spi@7e204000"
	[ -e "$BATS_TEST_TMPDIR/preprocessed" ]
}

# --- SET-08: interview ---------------------------------------------------------------------

# Description: interview is on by default, and add then asks on a terminal for the required
# properties left to set.
# Steps:
#   1. Check config gives interview true from default.
#   2. Create the overlay with init.
#   3. Run add adi,adxl345 --parent i2c1 on a terminal, pressing Ctrl-C at the interrupt-parent
#      prompt.
#   4. Check it asked for interrupt-parent, the first of two.
# bats test_tags=req:SET-08, id:L0275
@test "interview is on by default and asks, on a terminal, for what is left after add" {
	[ "$(field interview '"\(.value) \(.source)"')" = "true default" ]
	with_overlay
	tty_run "interrupt-parent [a]:" $'\x03' -- add adi,adxl345 --parent i2c1
	assert_output --partial "[1/2] interrupt-parent"
}

# Description: with interview off, add on a terminal asks nothing and lists the missing required
# properties.
# Steps:
#   1. Run config interview false and check it succeeds.
#   2. Create the overlay with init.
#   3. Run add adi,adxl345 --parent i2c1 on a terminal, typing nothing.
#   4. Check it succeeds without a prompt, listing interrupt-parent and interrupts as missing.
# bats test_tags=req:SET-08, id:L0276
@test "with interview off, add asks nothing on a terminal" {
	run aa config interview false
	assert_success
	with_overlay
	tty_run -- add adi,adxl345 --parent i2c1
	assert_success
	refute_output --partial "[1/2]"
	assert_output --partial "Missing required: interrupt-parent, interrupts"
}

# --- SET-11: build folder ------------------------------------------------------------------

# Description: build-dir names the folder build writes to, build by default.
# Steps:
#   1. Run config build-dir, with --json.
#   2. Check it succeeds with the value build, from default.
#   3. Set build-dir to a folder build-a, make the overlay with the ADXL345 and build it.
#   4. Check overlay.dtbo is in build-a.
# bats test_tags=req:SET-11, id:L0279
@test "build-dir names the folder build writes to, build by default" {
	run_json config build-dir
	assert_success
	assert_json '.configs[0].value' build
	assert_json '.configs[0].source' default
	aa config build-dir "$BATS_TEST_TMPDIR/build-a"
	with_accel
	aa build >/dev/null
	[ -f "$BATS_TEST_TMPDIR/build-a/overlay.dtbo" ]
}
