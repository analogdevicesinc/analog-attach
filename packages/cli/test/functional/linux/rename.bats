# rename where the backend is linux: a node the overlay adds, its unit address and reg.

# bats file_tags=eco:linux

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

# bats test_tags=req:RENAME-01
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

# bats test_tags=req:RENAME-01
@test "rename in human mode says what it renamed where" {
	run aa rename adxl345 accel
	assert_success
	assert_output "Renamed adxl345 to accel in $WORKFILE"
}

# bats test_tags=req:RENAME-01
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

# Gap: the name isn't checked: `foo/bar` and `a b` are written, and the overlay no longer
# parses (spec rename.md N-1).
# bats test_tags=req:RENAME-01, gap
@test "rename refuses a name that is not a valid node name" {
	snapshot
	run_json rename adxl345 foo/bar
	assert_success
	assert_json '.ok' false
	run_json rename adxl345 'a b'
	assert_json '.ok' false
	assert_unchanged
}

# bats test_tags=req:RENAME-01
@test "rename refuses a node that does not exist" {
	snapshot
	run_json rename nosuch foo
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: nosuch"
	assert_unchanged
}

# bats test_tags=req:RENAME-01
@test "rename refuses a node of the base" {
	snapshot
	run_json rename spi0 myspi
	assert_success
	assert_json '.ok' false
	assert_json '.message' "spi0 is part of the base device tree ($LINUX_BASE), not this overlay; rename only applies to overlay-added nodes"
	assert_unchanged
}

# bats test_tags=req:RENAME-02
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

# bats test_tags=req:RENAME-02
@test "rename keeps the node's properties and children" {
	run aa rename ad7124_8 adc
	assert_success
	run_json read ad7124_8/channel@1 diff-channels
	assert_json '.value | join(" ")' "2 3"
	run_json read ad7124_8 refin1-supply
	assert_json '.value' "&vref"
}

# bats test_tags=req:RENAME-03
@test "a new name without @ keeps the unit address" {
	run_json rename ad7124_8 adc
	assert_success
	assert_json '.message' "Renamed ad7124_8 to adc"
	run grep -c 'ad7124_8: adc@2 {' "$WORKFILE"
	assert_output 1
	run_json read ad7124_8 reg
	assert_json '.value' 2
}

# bats test_tags=req:RENAME-03
@test "a new name with @ changes the unit address and sets reg to match" {
	run_json rename ad7124_8 adc@3
	assert_success
	assert_json '.message' "Renamed ad7124_8 to adc@3; reg first cell set to 3"
	run grep -c 'ad7124_8: adc@3 {' "$WORKFILE"
	assert_output 1
	run_json read ad7124_8 reg
	assert_json '.value' 3
}

# bats test_tags=req:RENAME-03
@test "in human mode rename notes the new reg" {
	run --separate-stderr aa rename ad7124_8 adc@3
	assert_success
	assert_line --index 0 "reg first cell set to 3"
	assert_line --index 1 "Renamed ad7124_8 to adc@3 in $WORKFILE"
}

# bats test_tags=req:RENAME-03
@test "a channel's unit address is decimal, as its parent's binding names it" {
	run aa rename ad7124_8/channel@0 channel@10
	assert_success
	assert_line "reg first cell set to 10"
	run_json read ad7124_8/channel@10 reg
	assert_json '.value' 10
}

# bats test_tags=req:RENAME-03
@test "rename warns when the new address clashes with a sibling" {
	run --separate-stderr aa --json rename ad7124_8 adc@0
	assert_success
	assert_json '.severity' warn
	[[ "$stderr" == *"warning: chip select 0 is already used by spidev@0"* ]] ||
		fail "no clash warning: $stderr"
}
