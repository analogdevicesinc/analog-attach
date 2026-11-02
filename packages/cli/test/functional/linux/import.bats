# import where the backend is linux: a workfile from an overlay of the Linux tree, or any
# overlay file.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, workfile overlay.dtso
# set but not created yet.
setup() {
	load ../helpers
	new_project linux
}

OVERLAYS=arch/arm/boot/dts/overlays

# `setting <key>`: the value of a linux setting in the project's file.
setting() {
	jq -r --arg key "$1" '.linux[$key]' "$PROJECT/.analog-attach/config.json"
}

# `odd_overlay`: mine.dtso in the project, an overlay for another board, with a fragment whose
# target the base doesn't have and a reference to a node nobody has.
odd_overlay() {
	cat >"$PROJECT/mine.dtso" <<-'EOF'
		/dts-v1/;
		/plugin/;
		/ {
			compatible = "ti,am335x-bone";
			fragment@0 {
				target = <&spi0>;
				__overlay__ {
					status = "okay";
					dac@1 {
						compatible = "adi,ad5592r";
						reg = <1>;
						vref-supply = <&vref>;
					};
				};
			};
			fragment@1 {
				target = <&nothere>;
				__overlay__ {
					status = "okay";
				};
			};
		};
	EOF
}

# Description: import of an overlay of the Linux tree, by its short name, starts a new workfile
# from it and reports where it came from.
# Steps:
#   1. Import rpi-adxl345, with --json.
#   2. Check it succeeds (.ok true), with the new workfile rpi-adxl345.dtso in the project, the
#      tree's rpi-adxl345-overlay.dts as the source, and a message naming both.
#   3. Read compatible of spi0/adxl345@0, with --json; check it is adi,adxl345.
# bats test_tags=req:IMPORT-01, req:IMPORT-02, id:L0160
@test "import of an overlay of the Linux tree, by name, starts a new workfile from it" {
	run_json import rpi-adxl345
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$PROJECT/rpi-adxl345.dtso"
	assert_json '.source' "$LINUX_TREE/$OVERLAYS/rpi-adxl345-overlay.dts"
	assert_json '.message' "Imported $OVERLAYS/rpi-adxl345-overlay.dts into $PROJECT/rpi-adxl345.dtso"
	run_json read spi0/adxl345@0 compatible
	assert_json '.value' adi,adxl345
}

# Description: in human mode, import says which overlay it imported into which file.
# Steps:
#   1. Import rpi-adxl345.
#   2. Check it succeeds and the first line names the tree's overlay and the new workfile.
# bats test_tags=req:IMPORT-01, id:L0161
@test "import in human mode says what it imported where" {
	run aa import rpi-adxl345
	assert_success
	assert_line --index 0 "Imported $OVERLAYS/rpi-adxl345-overlay.dts into $PROJECT/rpi-adxl345.dtso"
}

# Description: import finds an overlay of the tree by its file name and by its path in the tree.
# Steps:
#   1. Import rpi-adxl345-overlay.dts, with --json; check the new workfile is rpi-adxl345.dtso.
#   2. Import the overlay by its path under arch/arm/boot/dts/overlays, with --json; check the
#      source is that file of the tree.
# bats test_tags=req:IMPORT-02, id:L0162
@test "import finds an overlay of the tree by its file name and by its path" {
	run_json import rpi-adxl345-overlay.dts
	assert_json '.path' "$PROJECT/rpi-adxl345.dtso"
	run_json import "$OVERLAYS/rpi-adxl345-overlay.dts"
	assert_json '.source' "$LINUX_TREE/$OVERLAYS/rpi-adxl345-overlay.dts"
}

# Description: import refuses a name that is no overlay of the tree and no file, pointing to list
# overlay.
# Steps:
#   1. Import rpi-nosuchpart, with --json.
#   2. Check it is refused (exit 0, .ok false) and the message names the tree and points to list
#      overlay.
#   3. Check no workfile was created.
# bats test_tags=req:IMPORT-02, id:L0163
@test "import refuses an overlay name the tree doesn't have, pointing to list overlay" {
	run_json import rpi-nosuchpart
	assert_success
	assert_json '.ok' false
	assert_json '.message' "No overlay named rpi-nosuchpart in $LINUX_TREE (list overlay <compatible> finds them), and no such file"
	[ ! -e "$WORKFILE" ]
}

# Description: import takes any overlay file by its path, even one for another board.
# Steps:
#   1. Write mine.dtso, an overlay for another board, in the project.
#   2. Import mine.dtso, with --json.
#   3. Check it succeeds (.ok true), the source is mine.dtso and the new workfile mine-1.dtso.
# bats test_tags=req:IMPORT-02, id:L0164
@test "import takes any overlay file, by its path" {
	odd_overlay
	run_json import mine.dtso
	assert_success
	assert_json '.ok' true
	assert_json '.source' "$PROJECT/mine.dtso"
	assert_json '.path' "$PROJECT/mine-1.dtso"
}

# Description: import keeps the overlay's compatible, fragments and properties as they are
# written.
# Steps:
#   1. Import rpi-adxl345, with --json; check it succeeds (.ok true).
#   2. Check the new workfile has the overlay's compatible list, the fragments targeting spi0
#      and spidev0, interrupt-parent and spi-cpha.
# bats test_tags=req:IMPORT-02, id:L0165
@test "import keeps the overlay's fragments as written" {
	run_json import rpi-adxl345
	assert_json '.ok' true
	run cat "$PROJECT/rpi-adxl345.dtso"
	assert_output --partial 'compatible = "brcm,bcm2835", "brcm,bcm2708", "brcm,bcm2709";'
	assert_output --partial $'fragment@0 {\n\t\ttarget = <&spi0>;'
	assert_output --partial $'fragment@1 {\n\t\ttarget = <&spidev0>;'
	assert_output --partial 'interrupt-parent = <&gpio>;'
	assert_output --partial 'spi-cpha;'
}

# Description: import drops the RPi overlay parameters (__overrides__) and says so.
# Steps:
#   1. Check the tree's rpi-ad5592r overlay has __overrides__.
#   2. Import rpi-ad5592r.
#   3. Check it succeeds and says it dropped __overrides__.
#   4. Check the new workfile has no __overrides__.
# bats test_tags=req:IMPORT-02, id:L0166
@test "import drops the RPi overlay parameters and says so" {
	grep -q __overrides__ "$LINUX_TREE/$OVERLAYS/rpi-ad5592r-overlay.dts" || fail "the fixture overlay has no __overrides__"
	run aa import rpi-ad5592r
	assert_success
	assert_output --partial "Dropped __overrides__ (the overlay's parameters)"
	run grep -c __overrides__ "$PROJECT/rpi-ad5592r.dtso"
	assert_output 0
}

# Description: import warns about a fragment target and a reference the base does not have, and
# imports the overlay anyway.
# Steps:
#   1. Write mine.dtso, with a fragment targeting nothere and a vref-supply to a missing vref.
#   2. Import mine.dtso.
#   3. Check it succeeds and says it imported mine.dtso into mine-1.dtso.
#   4. Check standard error warns about the fragment and its target, and about the reference
#      and the node holding it.
#   5. Check mine-1.dtso exists.
# bats test_tags=req:IMPORT-03, id:L0167
@test "import warns about a target and a reference the base doesn't have, and imports anyway" {
	odd_overlay
	run --separate-stderr aa import mine.dtso
	assert_success
	assert_output --partial "Imported $PROJECT/mine.dtso into $PROJECT/mine-1.dtso"
	lines=("${stderr_lines[@]}")
	assert_line "warning: 1 fragment targets a node the base doesn't have:"
	assert_line "  fragment@1  target nothere"
	assert_line "warning: 1 reference points to a node neither the base nor the overlay has:"
	assert_line "  spi0/dac@1  vref-supply → &vref"
	[ -f "$PROJECT/mine-1.dtso" ]
}

# Description: with --json, import lists the targets and references that do not resolve, with a
# warn severity.
# Steps:
#   1. Write mine.dtso, with an unresolved target and reference.
#   2. Import mine.dtso, with --json.
#   3. Check it succeeds (.ok true) with severity warn.
#   4. Check the unresolved targets list fragment@1 and nothere, and the unresolved references
#      vref-supply and &vref.
# bats test_tags=req:IMPORT-03, id:L0168
@test "import lists what doesn't resolve in JSON, with a warn severity" {
	odd_overlay
	run_json import mine.dtso
	assert_json '.ok' true
	assert_json '.severity' warn
	assert_json '.unresolved_targets | tojson' '[{"fragment":"fragment@1","property":"target","target":"nothere"}]'
	assert_json '.unresolved | map(.property + " " + .reference) | join(",")' 'vref-supply &vref'
}

# Description: import says whether the overlay fits the board of the base, and warns when it is
# for another board.
# Steps:
#   1. Import rpi-adxl345, with --json; check the fit is compatible, by family, severity info.
#   2. Write mine.dtso, for ti,am335x-bone, and import it, with --json; check the fit is
#      incompatible and the reason gives both compatibles.
#   3. Import mine.dtso in human mode; check standard error warns the overlay is for another
#      board and gives the base's compatibles.
# bats test_tags=req:IMPORT-03, id:L0169
@test "import says whether the overlay fits the board" {
	run_json import rpi-adxl345
	assert_json '.fit' compatible
	assert_json '.reason' 'family: brcm,bcm2835 → raspberrypi'
	assert_json '.severity' info
	odd_overlay
	run_json import mine.dtso
	assert_json '.fit' incompatible
	assert_json '.reason' 'overlay: ti,am335x-bone; base: raspberrypi,4-model-b, brcm,bcm2711'
	run --separate-stderr aa import mine.dtso
	lines=("${stderr_lines[@]}")
	assert_line "warning: this overlay is for another board: ti,am335x-bone"
	assert_line "  (base: raspberrypi,4-model-b, brcm,bcm2711)"
}

# Description: the imported workfile is named after the overlay and becomes the configured
# workfile.
# Steps:
#   1. Import rpi-adxl345, with --json; check the new workfile is rpi-adxl345.dtso.
#   2. Check the workfile setting is that file.
#   3. Run read --quiet; check it shows adxl345@0.
# bats test_tags=req:IMPORT-04, id:L0170
@test "the imported workfile is named after the overlay and becomes the configured one" {
	run_json import rpi-adxl345
	assert_json '.path' "$PROJECT/rpi-adxl345.dtso"
	[ "$(setting workfile)" = "$PROJECT/rpi-adxl345.dtso" ]
	run aa read --quiet
	assert_output --partial 'adxl345@0'
}

# Description: import leaves the previous workfile as it was and says how to switch back to it.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Snapshot the workfile.
#   3. Import rpi-adxl345, with --json; check it reports the replaced workfile, and that file is
#      unchanged.
#   4. Import rpi-adxl345 again, in human mode; check it says the new configured workfile, the
#      one before, that it was kept, and the config workfile command to switch back.
# bats test_tags=req:IMPORT-04, id:L0171
@test "import keeps the previous workfile and says how to switch back" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	snapshot
	run_json import rpi-adxl345
	assert_json '.replaced' "$WORKFILE"
	assert_unchanged
	run aa import rpi-adxl345
	assert_line "The configured workfile is now $PROJECT/rpi-adxl345-1.dtso (was $PROJECT/rpi-adxl345.dtso, kept; switch back with: config workfile $PROJECT/rpi-adxl345.dtso)"
}

# Description: import never overwrites a file: a taken name gets a number.
# Steps:
#   1. Write rpi-adxl345.dtso in the project.
#   2. Import rpi-adxl345, with --json; check the new workfile is rpi-adxl345-1.dtso.
#   3. Import it again, with --json; check the new workfile is rpi-adxl345-2.dtso.
#   4. Check rpi-adxl345.dtso still holds what was written.
# bats test_tags=req:IMPORT-01, id:L0172
@test "import never overwrites a file: a name that is taken gets a number" {
	echo 'mine' >"$PROJECT/rpi-adxl345.dtso"
	run_json import rpi-adxl345
	assert_json '.path' "$PROJECT/rpi-adxl345-1.dtso"
	run_json import rpi-adxl345
	assert_json '.path' "$PROJECT/rpi-adxl345-2.dtso"
	run cat "$PROJECT/rpi-adxl345.dtso"
	assert_output mine
}

# Description: import refuses a file that does not parse, and writes nothing.
# Steps:
#   1. Write broken.dtso, an unterminated overlay.
#   2. Import broken.dtso, with --json.
#   3. Check it is refused (exit 0, .ok false) and the message says the file does not parse.
#   4. Check no broken-1.dtso was written and the workfile setting is unchanged.
# bats test_tags=req:IMPORT-02, id:L0173
@test "import refuses a file that doesn't parse, writing nothing" {
	printf '/dts-v1/;\n/plugin/;\n/ { fragment@0 {\n' >"$PROJECT/broken.dtso"
	run_json import broken.dtso
	assert_success
	assert_json '.ok' false
	assert_json '.message | startswith("'"$PROJECT/broken.dtso"' does not parse after preprocessing: ")' true
	[ ! -e "$PROJECT/broken-1.dtso" ]
	[ "$(setting workfile)" = "$WORKFILE" ]
}
