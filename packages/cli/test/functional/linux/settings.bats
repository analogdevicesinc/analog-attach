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

# Description: the backend setting selects the ecosystem, linux or noos, and is stored in the
# project's settings.
# Steps:
#   1. Run config backend, with --json.
#   2. Check the value is linux from local, with the options linux and noos.
#   3. Check the project's settings file has backend linux.
#   4. Run --help and check it shows Backend: linux.
# bats test_tags=req:SET-01, id:L0264
@test "the backend setting selects the ecosystem and is stored with the project" {
	run_json config backend
	assert_json '.configs[0].value' linux
	assert_json '.configs[0].source' local
	assert_json '.configs[0].type.options | join(",")' "linux,noos"
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = linux ]
	run aa --help
	assert_output --partial "Backend: linux"
}

# Description: two projects on one machine can each have their own backend.
# Steps:
#   1. Go to a second folder and run config backend noos there.
#   2. Check config backend, with --json, gives noos from the local settings, and the folder's
#      own settings file holds it.
#   3. Go back to the project and check config backend gives linux.
# bats test_tags=req:SET-01, id:L0265
@test "two projects on one machine can target different ecosystems" {
	mkdir -p "$BATS_TEST_TMPDIR/second"
	cd "$BATS_TEST_TMPDIR/second"
	aa config backend noos
	run_json config backend
	assert_json '.configs[0].value' noos
	assert_json '.configs[0].source' local
	[ "$(jq -r .backend "$BATS_TEST_TMPDIR/second/.analog-attach/config.json")" = noos ]
	cd "$PROJECT"
	run_json config backend
	assert_json '.configs[0].value' linux
}

# Description: the backend is a project setting; setting it with --global is refused.
# Steps:
#   1. Run config backend noos --global.
#   2. Check the message says backend belongs to the project and can't be global.
#   3. Check the user's settings file does not exist or has no backend.
# bats test_tags=req:SET-01, id:L0266
@test "the backend can't be a user setting" {
	run aa config backend noos --global
	assert_output --partial "backend belongs to the project and can't be in the global settings"
	[ ! -e "$HOME/.config/analog-attach/config.json" ] || [ "$(jq -r '.backend // "none"' "$HOME/.config/analog-attach/config.json")" = none ]
}

# Description: switching the backend to noos and back keeps the linux settings.
# Steps:
#   1. Set overlay-syntax label, then config backend noos.
#   2. Check config overlay-syntax, with --json, fails with a usage error (exit 2): noos has no
#      such setting.
#   3. Run config backend linux.
#   4. Check overlay-syntax is still label and devicetree still the base devicetree.
# bats test_tags=req:SET-01, id:L0267
@test "switching the backend keeps each ecosystem's settings" {
	aa config overlay-syntax label
	aa config backend noos
	run_json config overlay-syntax
	assert_failure 2
	aa config backend linux
	run_json config overlay-syntax
	assert_json '.configs[0].value' label
	run_json config devicetree
	assert_json '.configs[0].value' "$LINUX_BASE"
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
#   1. Check config gives overlay-syntax fragment from default, options fragment and label.
#   2. Make the overlay with the ADXL345 (with_accel).
#   3. Check the overlay has fragment@0 with target = <&i2c_arm>, an __overlay__ node and the
#      adxl345 node.
# bats test_tags=req:SET-04, id:L0271
@test "overlay-syntax is fragment by default: the overlay is written in fragments" {
	[ "$(field overlay-syntax '"\(.value) \(.source)"')" = "fragment default" ]
	[ "$(field overlay-syntax '.type.options | join(",")')" = "fragment,label" ]
	with_accel
	run cat "$WORKFILE"
	assert_output --partial "fragment@0 {"
	assert_output --partial "target = <&i2c_arm>;"
	assert_output --partial "__overlay__ {"
	assert_output --partial "adxl345: adi,adxl345@0 {"
}

# Description: overlay-syntax label writes the overlay as references to labels, without
# fragments.
# Steps:
#   1. Set overlay-syntax label.
#   2. Make the overlay with the ADXL345.
#   3. Check the overlay has an &i2c_arm node holding the adxl345 node.
#   4. Check it has no fragment@ and no __overlay__.
# bats test_tags=req:SET-04, id:L0272
@test "overlay-syntax label writes the overlay as label references" {
	aa config overlay-syntax label
	with_accel
	run cat "$WORKFILE"
	assert_output --partial "&i2c_arm {"
	assert_output --partial "adxl345: adi,adxl345@0 {"
	refute_output --partial "fragment@"
	refute_output --partial "__overlay__"
}

# Description: preprocess-command is the C preprocessor command run on the base devicetree, cpp
# by default, with {linux}, {input} and {output} filled in.
# Steps:
#   1. Check config gives preprocess-command from default, a cpp command.
#   2. Create the overlay with init, and a preprocessor script that logs its arguments and runs
#      cpp.
#   3. Set preprocess-command to that script, with -I {linux}/include, {output} and {input}.
#   4. Run read spi0, with --json, and check it gives the spi@7e204000 node.
#   5. Check the log shows the script called with the Linux tree's include folder and the base
#      devicetree.
# bats test_tags=req:SET-04, id:L0273
@test "preprocess-command is the C preprocessor run on the base device tree" {
	[ "$(field preprocess-command .source)" = default ]
	[ "$(field preprocess-command '.value | test("^cpp ")')" = true ]
	with_overlay
	# A preprocessor of the user's: cpp, logging how it was called.
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho "$@" >>"%s"\nexec cpp "$@"\n' "$BATS_TEST_TMPDIR/cpp.log" >"$BATS_TEST_TMPDIR/bin/mycpp"
	chmod +x "$BATS_TEST_TMPDIR/bin/mycpp"
	aa config preprocess-command \
		"$BATS_TEST_TMPDIR/bin/mycpp -nostdinc -undef -x assembler-with-cpp -P -I {linux}/include -o {output} {input}"
	run_json read spi0
	assert_json '.key' "spi@7e204000"
	run grep -F -- "-I $LINUX_TREE/include" "$BATS_TEST_TMPDIR/cpp.log"
	assert_success
	assert_output --partial "$LINUX_BASE"
}

# Description: a preprocess-command whose tool is not on PATH is named in the error.
# Steps:
#   1. Create the overlay with init.
#   2. Set preprocess-command to nosuchcpp {input} {output}.
#   3. Run read spi0.
#   4. Check the message says nosuchcpp was not found on PATH.
# bats test_tags=req:SET-04, id:L0274
@test "a preprocess-command whose tool is missing is named" {
	with_overlay
	aa config preprocess-command "nosuchcpp {input} {output}"
	run aa read spi0
	assert_output --partial "preprocess-command: nosuchcpp not found on PATH"
}

# --- SET-08: interview ---------------------------------------------------------------------

# Gap: linux has no interview setting (`Unknown config field: interview`, exit 2); add always
# asks on a terminal.
# Description: interview is on by default, and add then asks on a terminal for the required
# properties left to set.
# Steps:
#   1. Check config gives interview true from default.
#   2. Create the overlay with init.
#   3. Run add adi,adxl345 --parent i2c1 on a terminal, pressing Ctrl-C at the interrupt-parent
#      prompt.
#   4. Check it asked for interrupt-parent, the first of two.
# bats test_tags=req:SET-08, gap, id:L0275
@test "interview is on by default and asks, on a terminal, for what is left after add" {
	[ "$(field interview '"\(.value) \(.source)"')" = "true default" ]
	with_overlay
	tty_run "interrupt-parent [a]:" $'\x03' -- add adi,adxl345 --parent i2c1
	assert_output --partial "[1/2] interrupt-parent"
}

# Gap: linux has no interview setting; `config interview false` exits 2.
# Description: with interview off, add on a terminal asks nothing and lists the missing required
# properties.
# Steps:
#   1. Run config interview false and check it succeeds.
#   2. Create the overlay with init.
#   3. Run add adi,adxl345 --parent i2c1 on a terminal, typing nothing.
#   4. Check it succeeds without a prompt, listing interrupt-parent and interrupts as missing.
# bats test_tags=req:SET-08, gap, id:L0276
@test "with interview off, add asks nothing on a terminal" {
	run aa config interview false
	assert_success
	with_overlay
	tty_run -- add adi,adxl345 --parent i2c1
	assert_success
	refute_output --partial "[1/2]"
	assert_output --partial "Missing required: interrupt-parent, interrupts"
}

# --- SET-09: own build and deploy ----------------------------------------------------------

# Gap: linux has no build-command setting (`Unknown config field: build-command`, exit 2).
# Description: build-command replaces the build step with the user's command.
# Steps:
#   1. Make the overlay with the ADXL345.
#   2. Run config build-command with a command writing built-by-me.txt, and check it succeeds.
#   3. Run build, with --json, and check .ok is true.
#   4. Check built-by-me.txt was written and no overlay.dtbo was built.
# bats test_tags=req:SET-09, gap, id:L0277
@test "build-command replaces the build step" {
	with_accel
	run aa config build-command 'echo mine > built-by-me.txt'
	assert_success
	run_json build
	assert_json '.ok' true
	[ "$(cat "$PROJECT/built-by-me.txt")" = mine ]
	[ ! -e "$PROJECT/overlay.dtbo" ]
}

# Gap: linux has no deploy-command setting (`Unknown config field: deploy-command`, exit 2).
# Description: deploy-command replaces the deploy step with the user's command.
# Steps:
#   1. Make the overlay with the ADXL345 and build it.
#   2. Run config deploy-command with a command writing deployed-by-me.txt, and check it succeeds.
#   3. Run deploy, with --json, and check .ok is true.
#   4. Check deployed-by-me.txt was written.
# bats test_tags=req:SET-09, gap, id:L0278
@test "deploy-command replaces the deploy step" {
	with_accel
	aa build >/dev/null
	run aa config deploy-command 'echo mine > deployed-by-me.txt'
	assert_success
	run_json deploy
	assert_json '.ok' true
	[ "$(cat "$PROJECT/deployed-by-me.txt")" = mine ]
}

# --- SET-11: build folder ------------------------------------------------------------------

# Gap: linux has no build-dir setting (`Unknown config field: build-dir`, exit 2); build writes
# the .dtbo next to the workfile.
# Description: build-dir names the folder build writes to, build by default.
# Steps:
#   1. Run config build-dir, with --json.
#   2. Check it succeeds with the value build, from default.
#   3. Set build-dir to a folder build-a, make the overlay with the ADXL345 and build it.
#   4. Check overlay.dtbo is in build-a.
# bats test_tags=req:SET-11, gap, id:L0279
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

# --- SET-10-LNX: deploy target -------------------------------------------------------------

# Description: deploy-ip, deploy-user and deploy-password are settings of the Deploy category,
# not required and unset by default.
# Steps:
#   1. For each of the three, run config <key>, with --json.
#   2. Check each is in Deploy, with no value, source unset, not required.
# bats test_tags=req:SET-10-LNX, id:L0280
@test "deploy-ip, deploy-user and deploy-password are deploy settings, unset by default" {
	local key
	for key in deploy-ip deploy-user deploy-password; do
		[ "$(field "$key" '"\(.category) \(.value) \(.source) \(.required)"')" = "Deploy null unset false" ] ||
			fail "$key: $(field "$key" '"\(.category) \(.value) \(.source) \(.required)"')"
	done
}

# Description: deploy copies the built overlay to the device the deploy settings name, and
# reboots it, logging in with their user and password.
# Steps:
#   1. Put a logging stand-in for sshpass on PATH.
#   2. Make the overlay with the ADXL345 and build it.
#   3. Set deploy-ip 192.0.2.1, deploy-user pi and deploy-password secret.
#   4. Run deploy, with --json, and check .ok is true and .host is 192.0.2.1.
#   5. Check the log has an scp of overlay.dtbo to pi@192.0.2.1:/boot/overlays/ and an ssh
#      sudo reboot, both with the password secret.
# bats test_tags=req:SET-10-LNX, id:L0281
@test "deploy reaches the device the deploy settings name, with their login" {
	stub sshpass "$BATS_TEST_TMPDIR/sshpass.log"
	with_accel
	aa build >/dev/null
	aa config deploy-ip 192.0.2.1
	aa config deploy-user pi
	aa config deploy-password secret
	run_json deploy
	assert_json '.ok' true
	assert_json '.host' 192.0.2.1
	run cat "$BATS_TEST_TMPDIR/sshpass.log"
	assert_line --regexp "^SSHPASS=secret .*scp .*$PROJECT/overlay.dtbo\"? pi@192\.0\.2\.1:/boot/overlays/$"
	assert_line --regexp "^SSHPASS=secret .*ssh .*pi@192\.0\.2\.1 sudo reboot$"
}

# Description: deploy with deploy settings unset names the missing ones, and only those, and how
# to set them.
# Steps:
#   1. Make the overlay with the ADXL345 and build it.
#   2. Set deploy-ip 192.0.2.1 only.
#   3. Run deploy.
#   4. Check the message names deploy-user and deploy-password as missing, but not deploy-ip.
#   5. Check it says how to set each with config.
# bats test_tags=req:SET-10-LNX, req:GEN-13, id:L0282
@test "deploy with the deploy settings unset names them" {
	with_accel
	aa build >/dev/null
	aa config deploy-ip 192.0.2.1
	run aa deploy
	refute_output --partial "Missing config field deploy-ip"
	assert_output --partial "Missing config field deploy-user"
	assert_output --partial "Missing config field deploy-password"
	assert_output --partial "analog-attach config deploy-user"
	assert_output --partial "analog-attach config deploy-password"
}
