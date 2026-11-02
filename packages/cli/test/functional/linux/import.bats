# import where the backend is linux: a workfile from an overlay of the Linux tree, or any
# overlay file.

# bats file_tags=eco:linux

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

# bats test_tags=req:IMPORT-01, req:IMPORT-02
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

# bats test_tags=req:IMPORT-01
@test "import in human mode says what it imported where" {
	run aa import rpi-adxl345
	assert_success
	assert_line --index 0 "Imported $OVERLAYS/rpi-adxl345-overlay.dts into $PROJECT/rpi-adxl345.dtso"
}

# bats test_tags=req:IMPORT-02
@test "import finds an overlay of the tree by its file name and by its path" {
	run_json import rpi-adxl345-overlay.dts
	assert_json '.path' "$PROJECT/rpi-adxl345.dtso"
	run_json import "$OVERLAYS/rpi-adxl345-overlay.dts"
	assert_json '.source' "$LINUX_TREE/$OVERLAYS/rpi-adxl345-overlay.dts"
}

# bats test_tags=req:IMPORT-02
@test "import refuses an overlay name the tree doesn't have, pointing to list overlay" {
	run_json import rpi-nosuchpart
	assert_success
	assert_json '.ok' false
	assert_json '.message' "No overlay named rpi-nosuchpart in $LINUX_TREE (list overlay <compatible> finds them), and no such file"
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:IMPORT-02
@test "import takes any overlay file, by its path" {
	odd_overlay
	run_json import mine.dtso
	assert_success
	assert_json '.ok' true
	assert_json '.source' "$PROJECT/mine.dtso"
	assert_json '.path' "$PROJECT/mine-1.dtso"
}

# bats test_tags=req:IMPORT-02
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

# bats test_tags=req:IMPORT-02
@test "import drops the RPi overlay parameters and says so" {
	grep -q __overrides__ "$LINUX_TREE/$OVERLAYS/rpi-ad5592r-overlay.dts" || fail "the fixture overlay has no __overrides__"
	run aa import rpi-ad5592r
	assert_success
	assert_output --partial "Dropped __overrides__ (the overlay's parameters)"
	run grep -c __overrides__ "$PROJECT/rpi-ad5592r.dtso"
	assert_output 0
}

# bats test_tags=req:IMPORT-03
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

# bats test_tags=req:IMPORT-03
@test "import lists what doesn't resolve in JSON, with a warn severity" {
	odd_overlay
	run_json import mine.dtso
	assert_json '.ok' true
	assert_json '.severity' warn
	assert_json '.unresolved_targets | tojson' '[{"fragment":"fragment@1","property":"target","target":"nothere"}]'
	assert_json '.unresolved | map(.property + " " + .reference) | join(",")' 'vref-supply &vref'
}

# bats test_tags=req:IMPORT-03
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

# bats test_tags=req:IMPORT-04
@test "the imported workfile is named after the overlay and becomes the configured one" {
	run_json import rpi-adxl345
	assert_json '.path' "$PROJECT/rpi-adxl345.dtso"
	[ "$(setting workfile)" = "$PROJECT/rpi-adxl345.dtso" ]
	run aa read --quiet
	assert_output --partial 'adxl345@0'
}

# bats test_tags=req:IMPORT-04
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

# bats test_tags=req:IMPORT-01
@test "import never overwrites a file: a name that is taken gets a number" {
	echo 'mine' >"$PROJECT/rpi-adxl345.dtso"
	run_json import rpi-adxl345
	assert_json '.path' "$PROJECT/rpi-adxl345-1.dtso"
	run_json import rpi-adxl345
	assert_json '.path' "$PROJECT/rpi-adxl345-2.dtso"
	run cat "$PROJECT/rpi-adxl345.dtso"
	assert_output mine
}

# bats test_tags=req:IMPORT-02
@test "import refuses a file that doesn't parse, writing nothing" {
	printf '/dts-v1/;\n/plugin/;\n/ { fragment@0 {\n' >"$PROJECT/broken.dtso"
	run_json import broken.dtso
	assert_success
	assert_json '.ok' false
	assert_json '.message | startswith("'"$PROJECT/broken.dtso"' does not parse after preprocessing: ")' true
	[ ! -e "$PROJECT/broken-1.dtso" ]
	[ "$(setting workfile)" = "$WORKFILE" ]
}
