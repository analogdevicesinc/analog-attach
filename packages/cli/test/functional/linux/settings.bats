# The settings of linux (SET-*): what each one does.

# bats file_tags=eco:linux

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

# bats test_tags=req:SET-01
@test "the backend setting selects the ecosystem and is stored with the project" {
	run_json config backend
	assert_json '.configs[0].value' linux
	assert_json '.configs[0].source' local
	assert_json '.configs[0].type.options | join(",")' "linux,noos"
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = linux ]
	run aa --help
	assert_output --partial "Backend: linux"
}

# bats test_tags=req:SET-01
@test "two projects on one machine can target different ecosystems" {
	mkdir -p "$BATS_TEST_TMPDIR/second"
	cd "$BATS_TEST_TMPDIR/second"
	aa config backend noos
	run_json config backend
	assert_json '.configs[0].value' noos
	cd "$PROJECT"
	run_json config backend
	assert_json '.configs[0].value' linux
}

# Gap: config backend --global is taken, and written to the user settings.
# bats test_tags=req:SET-01, gap
@test "the backend can't be a user setting" {
	run aa config backend noos --global
	assert_output --partial "backend belongs to the project and can't be in the global settings"
	[ ! -e "$HOME/.config/analog-attach/config.json" ] || [ "$(jq -r '.backend // "none"' "$HOME/.config/analog-attach/config.json")" = none ]
}

# bats test_tags=req:SET-01
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

# bats test_tags=req:SET-03
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

# bats test_tags=req:SET-03
@test "linux names the Linux tree the bindings come from" {
	with_overlay
	run aa list devices adi,adxl345
	assert_success
	assert_output --partial "binding: $LINUX_TREE/Documentation/devicetree/bindings/iio/accel/adi,adxl345.yaml"
	run aa config linux "$BATS_TEST_TMPDIR"
	assert_output --partial "(not a Linux source tree)"
}

# bats test_tags=req:SET-03
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

# bats test_tags=req:SET-04
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

# bats test_tags=req:SET-04
@test "overlay-syntax label writes the overlay as label references" {
	aa config overlay-syntax label
	with_accel
	run cat "$WORKFILE"
	assert_output --partial "&i2c_arm {"
	assert_output --partial "adxl345: adi,adxl345@0 {"
	refute_output --partial "fragment@"
	refute_output --partial "__overlay__"
}

# bats test_tags=req:SET-04
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

# bats test_tags=req:SET-04
@test "a preprocess-command whose tool is missing is named" {
	with_overlay
	aa config preprocess-command "nosuchcpp {input} {output}"
	run aa read spi0
	assert_output --partial "preprocess-command: nosuchcpp not found on PATH"
}

# --- SET-08: interview ---------------------------------------------------------------------

# Gap: linux has no interview setting (`Unknown config field: interview`, exit 2); add always
# asks on a terminal.
# bats test_tags=req:SET-08, gap
@test "interview is on by default and asks, on a terminal, for what is left after add" {
	[ "$(field interview '"\(.value) \(.source)"')" = "true default" ]
	with_overlay
	tty_run "interrupt-parent [a]:" $'\x03' -- add adi,adxl345 --parent i2c1
	assert_output --partial "[1/2] interrupt-parent"
}

# Gap: linux has no interview setting; `config interview false` exits 2.
# bats test_tags=req:SET-08, gap
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
# bats test_tags=req:SET-09, gap
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
# bats test_tags=req:SET-09, gap
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
# bats test_tags=req:SET-11, gap
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

# bats test_tags=req:SET-10-LNX
@test "deploy-ip, deploy-user and deploy-password are deploy settings, unset by default" {
	local key
	for key in deploy-ip deploy-user deploy-password; do
		[ "$(field "$key" '"\(.category) \(.value) \(.source) \(.required)"')" = "Deploy null unset false" ] ||
			fail "$key: $(field "$key" '"\(.category) \(.value) \(.source) \(.required)"')"
	done
}

# bats test_tags=req:SET-10-LNX
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

# bats test_tags=req:SET-10-LNX, req:GEN-13
@test "deploy with the deploy settings unset names them" {
	with_accel
	aa build >/dev/null
	aa config deploy-ip 192.0.2.1
	run aa deploy
	refute_output --partial "Missing config field deploy-ip"
	assert_output --partial "Missing config field deploy-user"
	assert_output --partial "Missing config field deploy-password"
}
