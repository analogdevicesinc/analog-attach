# move where the backend is linux: a node the overlay adds, to another parent.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
	with_devices
}

# `with_devices`: an overlay as add and update leave it: an AD7124-8 on spi0 with a channel,
# and an ADXL345 on i2c1.
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
						channel@0 {
							reg = <0>;
							diff-channels = <0 1>;
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
		};
	DTS
}

# bats test_tags=req:MOVE-01
@test "move puts a node under a base node the overlay doesn't target yet" {
	run_json move ad7124_8 spi1
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Moved ad7124_8 to spi1"
	# A fragment for spi1 holds it now, and spi0's, left empty, is gone.
	run grep -c 'target = <&spi1>;' "$WORKFILE"
	assert_output 1
	run grep -c 'target = <&spi0>;' "$WORKFILE"
	assert_output 0
	run_json read spi1/adi,ad7124-8@2 reg
	assert_json '.value' 2
}

# bats test_tags=req:MOVE-01
@test "move in human mode says what it moved where" {
	run aa move ad7124_8 spi1
	assert_success
	assert_output "Moved ad7124_8 to spi1 in $WORKFILE"
}

# bats test_tags=req:MOVE-01
@test "move keeps the node's label, properties and children" {
	aa move ad7124_8 spi1 >/dev/null
	run_json read ad7124_8/channel@0 diff-channels
	assert_success
	assert_json '.value | join(" ")' "0 1"
	run_json read ad7124_8
	assert_json '.alias | join(" ")' ad7124_8
	run_json read spi1
	assert_json '[.children[].key] | index("adi,ad7124-8@2") != null' true
}

# bats test_tags=req:MOVE-01
@test "move puts a node under another node of the overlay" {
	aa move ad7124_8 spi1 >/dev/null
	run_json move adxl345 ad7124_8
	assert_success
	assert_json '.ok' true
	run_json read ad7124_8/adi,adxl345@0 compatible
	assert_success
}

# bats test_tags=req:MOVE-01
@test "move refuses a node of the base" {
	snapshot
	run_json move spi0 spi1
	assert_success
	assert_json '.ok' false
	assert_json '.message' "spi0 is part of the base device tree ($LINUX_BASE), not this overlay; move only applies to overlay-added nodes"
	assert_unchanged
}

# bats test_tags=req:MOVE-01
@test "move refuses a node or a parent that does not exist" {
	snapshot
	run_json move nosuch spi1
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: nosuch"
	run_json move ad7124_8 nosuch
	assert_json '.ok' false
	assert_json '.message' "Parent node nosuch not found"
	assert_unchanged
}

# bats test_tags=req:MOVE-01
@test "move refuses to put a node into itself" {
	snapshot
	run_json move ad7124_8 ad7124_8/channel@0
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Cannot move ad7124_8 into itself or one of its descendants"
	assert_unchanged
}

# bats test_tags=req:MOVE-01
@test "move needs both the node and the parent" {
	run aa move ad7124_8
	assert_failure 2
	assert_output --partial "Expected argument for destination"
}

# Gap: the parent isn't checked against the binding: an SPI ADC is moved onto an I2C bus, or
# under /memory@0, without a word (spec move.md M-1).
# bats test_tags=req:MOVE-02, gap
@test "move under a parent the binding doesn't allow is refused, naming the valid parents" {
	snapshot
	run_json move ad7124_8 i2c1
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("spi")' true
	assert_unchanged
	run_json move ad7124_8 /memory@0
	assert_json '.ok' false
	assert_unchanged
}
