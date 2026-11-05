# rename where the backend is linux: a node the overlay adds, its unit address and reg.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, and an overlay workfile
# with an AD7124-8 (label ad7124_8, node adi,ad7124-8@2) on spi0 with channel@0 and channel@1
# and refin1-supply = <&vref>, an ADXL345 (label adxl345) on i2c_arm, and a regulator-fixed
# (label vref) at the root.
setup() {
	load ../helpers
	new_project linux
	with_devices
}

# `with_devices`: an overlay as add and update leave it: an AD7124-8 on spi0 with a channel
# and its reference regulator vref, and an ADXL345 on i2c1.
with_devices() {
	cat >"$WORKFILE" <<-'DTS'
		/dts-v1/;
		/plugin/;
		/ {
			fragment@0 {
				target = <&spi0>;
				__overlay__ {
					ad7124_8: adi,ad7124-8@2 {
						compatible = "adi,ad7124-8";
						reg = <2>;
						#address-cells = <1>;
						#size-cells = <0>;
						refin1-supply = <&vref>;
						channel@0 {
							reg = <0>;
							diff-channels = <0 1>;
						};
						channel@1 {
							reg = <1>;
							diff-channels = <2 3>;
						};
					};
				};
			};
			fragment@1 {
				target = <&i2c_arm>;
				__overlay__ {
					adxl345: adi,adxl345@0 {
						compatible = "adi,adxl345";
						reg = <0>;
					};
				};
			};
			fragment@2 {
				target-path = "/";
				__overlay__ {
					vref: regulator-fixed {
						compatible = "regulator-fixed";
						regulator-name = "vref";
					};
				};
			};
		};
	DTS
}

# Description: rename gives a node a new name and keeps its unit address and label.
# Steps:
#   1. Rename adxl345 to accel, with --json.
#   2. Check it succeeds (.ok true) and the message says what was renamed to what.
#   3. Check the workfile has the node as adxl345: accel@0.
#   4. Read compatible of i2c1/accel@0, with --json; check it is adi,adxl345.
# bats test_tags=req:RENAME-01, id:L0251
@test "rename gives a node a new name" {
	run_json rename adxl345 accel
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Renamed adxl345 to accel"
	run grep -c 'adxl345: accel@0 {' "$WORKFILE"
	assert_output 1
	run_json read i2c1/accel@0 compatible
	assert_json '.value | if type == "array" then join(" ") else . end' "adi,adxl345"
}

# Description: in human mode, rename says what it renamed and in which workfile.
# Steps:
#   1. Rename adxl345 to accel.
#   2. Check it succeeds and the output names the old name, the new name and the workfile.
# bats test_tags=req:RENAME-01, id:L0252
@test "rename in human mode says what it renamed where" {
	run aa rename adxl345 accel
	assert_success
	assert_output "Renamed adxl345 to accel in $WORKFILE"
}

# Description: rename refuses a name a sibling already has, whether the sibling is the overlay's
# or the base's.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename ad7124_8/channel@0 to channel@1, with --json; check it is refused (exit 0,
#      .ok false) and the message says channel@1 already exists there.
#   3. Rename ad7124_8 to spidev@0, a base node under spi0, with --json; check it is refused
#      the same way.
#   4. Check the workfile is unchanged.
# bats test_tags=req:RENAME-01, id:L0253
@test "rename refuses a name a sibling has, in the overlay or the base" {
	snapshot
	run_json rename ad7124_8/channel@0 channel@1
	assert_success
	assert_json '.ok' false
	assert_json '.message' "channel@1 already exists under the same parent"
	# spidev@0 is the base's, under spi0.
	run_json rename ad7124_8 spidev@0
	assert_json '.ok' false
	assert_json '.message' "spidev@0 already exists under the same parent"
	assert_unchanged
}

# Description: rename refuses a name that is not a valid node name.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename adxl345 to foo/bar, with --json; check it is refused (exit 0, .ok false).
#   3. Rename adxl345 to 'a b', with --json; check it is refused (.ok false).
#   4. Check the workfile is unchanged.
# bats test_tags=req:RENAME-01, id:L0254
@test "rename refuses a name that is not a valid node name" {
	snapshot
	run_json rename adxl345 foo/bar
	assert_success
	assert_json '.ok' false
	run_json rename adxl345 'a b'
	assert_json '.ok' false
	assert_unchanged
}

# Description: rename refuses a node that does not exist.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename nosuch to foo, with --json.
#   3. Check it is refused (exit 0, .ok false) and the message says nosuch is not found.
#   4. Check the workfile is unchanged.
# bats test_tags=req:RENAME-01, id:L0255
@test "rename refuses a node that does not exist" {
	snapshot
	run_json rename nosuch foo
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: nosuch"
	assert_unchanged
}

# Description: rename refuses a node of the base devicetree.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename spi0 to myspi, with --json.
#   3. Check it is refused (exit 0, .ok false); the message names the base file and says rename
#      only applies to overlay-added nodes.
#   4. Check the workfile is unchanged.
# bats test_tags=req:RENAME-01, id:L0256
@test "rename refuses a node of the base" {
	snapshot
	run_json rename spi0 myspi
	assert_success
	assert_json '.ok' false
	assert_json '.message' "spi0 is part of the base device tree ($LINUX_BASE), not this overlay; rename only applies to overlay-added nodes"
	assert_unchanged
}

# Description: rename keeps the node's label, so references to it still resolve.
# Steps:
#   1. Rename vref to ref-regulator; check it succeeds.
#   2. Check the workfile has vref: ref-regulator and refin1-supply still points to &vref.
#   3. Read regulator-name of vref, with --json; check it is vref.
#   4. Read refin1-supply of ad7124_8, with --json; check it is &vref.
# bats test_tags=req:RENAME-02, id:L0257
@test "rename keeps the node's label, so the references to it still find it" {
	run aa rename vref ref-regulator
	assert_success
	run grep -c 'vref: ref-regulator {' "$WORKFILE"
	assert_output 1
	run grep -c 'refin1-supply = <&vref>;' "$WORKFILE"
	assert_output 1
	run_json read vref regulator-name
	assert_json '.value' vref
	run_json read ad7124_8 refin1-supply
	assert_json '.value' "&vref"
}

# Description: rename keeps the node's properties and children.
# Steps:
#   1. Rename ad7124_8 to adc; check it succeeds.
#   2. Read diff-channels of ad7124_8/channel@1, with --json; check it is 2 3.
#   3. Read refin1-supply of ad7124_8, with --json; check it is &vref.
# bats test_tags=req:RENAME-02, id:L0258
@test "rename keeps the node's properties and children" {
	run aa rename ad7124_8 adc
	assert_success
	run_json read ad7124_8/channel@1 diff-channels
	assert_json '.value | join(" ")' "2 3"
	run_json read ad7124_8 refin1-supply
	assert_json '.value' "&vref"
}

# Description: a new name without @ keeps the node's unit address and reg.
# Steps:
#   1. Rename ad7124_8 to adc, with --json; check it succeeds and says what it renamed.
#   2. Check the workfile has the node as ad7124_8: adc@2.
#   3. Read reg of ad7124_8, with --json; check it is 2.
# bats test_tags=req:RENAME-03, id:L0259
@test "a new name without @ keeps the unit address" {
	run_json rename ad7124_8 adc
	assert_success
	assert_json '.message' "Renamed ad7124_8 to adc"
	run grep -c 'ad7124_8: adc@2 {' "$WORKFILE"
	assert_output 1
	run_json read ad7124_8 reg
	assert_json '.value' 2
}

# Description: a new name with @ changes the unit address and sets reg to match.
# Steps:
#   1. Rename ad7124_8 to adc@3, with --json.
#   2. Check it succeeds and the message says reg was set to 3.
#   3. Check the workfile has the node as ad7124_8: adc@3.
#   4. Read reg of ad7124_8, with --json; check it is 3.
# bats test_tags=req:RENAME-03, id:L0260
@test "a new name with @ changes the unit address and sets reg to match" {
	run_json rename ad7124_8 adc@3
	assert_success
	assert_json '.message' "Renamed ad7124_8 to adc@3; reg first cell set to 3"
	run grep -c 'ad7124_8: adc@3 {' "$WORKFILE"
	assert_output 1
	run_json read ad7124_8 reg
	assert_json '.value' 3
}

# Description: in human mode, rename to a new unit address notes the new reg before saying what it
# renamed.
# Steps:
#   1. Rename ad7124_8 to adc@3.
#   2. Check it succeeds; the first line says reg was set to 3, the second what was renamed and
#      in which workfile.
# bats test_tags=req:RENAME-03, id:L0261
@test "in human mode rename notes the new reg" {
	run --separate-stderr aa rename ad7124_8 adc@3
	assert_success
	assert_line --index 0 "reg first cell set to 3"
	assert_line --index 1 "Renamed ad7124_8 to adc@3 in $WORKFILE"
}

# Description: a channel's unit address is read as decimal, as its parent's binding names it.
# Steps:
#   1. Rename ad7124_8/channel@0 to channel@10.
#   2. Check it succeeds and says reg was set to 10.
#   3. Read reg of ad7124_8/channel@10, with --json; check it is 10, not 16.
# bats test_tags=req:RENAME-03, id:L0262
@test "a channel's unit address is decimal, as its parent's binding names it" {
	run aa rename ad7124_8/channel@0 channel@10
	assert_success
	assert_line "reg first cell set to 10"
	run_json read ad7124_8/channel@10 reg
	assert_json '.value' 10
}

# Description: rename warns when the new address clashes with a sibling on the bus.
# Steps:
#   1. Rename ad7124_8 to adc@0, with --json, standard error kept apart.
#   2. Check it succeeds with severity warn.
#   3. Check standard error warns that chip select 0 is already used by spidev@0.
# bats test_tags=req:RENAME-03, id:L0263
@test "rename warns when the new address clashes with a sibling" {
	run --separate-stderr aa --json rename ad7124_8 adc@0
	assert_success
	assert_json '.severity' warn
	[[ "$stderr" == *"warning: chip select 0 is already used by spidev@0"* ]] ||
		fail "no clash warning: $stderr"
}
