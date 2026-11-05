# move where the backend is linux: a node the overlay adds, to another parent.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, and an overlay workfile
# with an AD7124-8 (label ad7124_8, node adi,ad7124-8@2) on spi0 with channel@0, and an ADXL345
# (label adxl345) on i2c_arm, each in its own fragment.
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

# Description: move puts a node under a base node the overlay does not target yet, in a new
# fragment, and drops the fragment it leaves empty.
# Steps:
#   1. Move ad7124_8 to spi1, with --json.
#   2. Check it succeeds (.ok true) and the message says what moved where.
#   3. Check the workfile has one fragment targeting spi1 and none targeting spi0.
#   4. Read reg of spi1/adi,ad7124-8@2, with --json; check it is 2.
# bats test_tags=req:MOVE-01, id:L0221
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

# Description: in human mode, move says which node it moved, to which parent, in which workfile.
# Steps:
#   1. Move ad7124_8 to spi1.
#   2. Check it succeeds and the output names the node, the parent and the workfile.
# bats test_tags=req:MOVE-01, id:L0222
@test "move in human mode says what it moved where" {
	run aa move ad7124_8 spi1
	assert_success
	assert_output "Moved ad7124_8 to spi1 in $WORKFILE"
}

# Description: move keeps the node's label, properties and children.
# Steps:
#   1. Move ad7124_8 to spi1.
#   2. Read diff-channels of ad7124_8/channel@0, with --json; check it succeeds and is 0 1.
#   3. Read ad7124_8, with --json; check its alias is ad7124_8.
#   4. Read spi1, with --json; check adi,ad7124-8@2 is among its children.
# bats test_tags=req:MOVE-01, id:L0223
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

# Description: move can put a node under another node the overlay adds. The node is a channel,
# which has no compatible, so no binding limits its parent (MOVE-02).
# Steps:
#   1. Move ad7124_8/channel@0 to adxl345, with --json; check it succeeds (.ok true).
#   2. Read reg of adxl345/channel@0, with --json; check it is 0.
#   3. Read ad7124_8, with --json; check it has no channel@0 any more.
# bats test_tags=req:MOVE-01, id:L0224
@test "move puts a node under another node of the overlay" {
	run_json move ad7124_8/channel@0 adxl345
	assert_success
	assert_json '.ok' true
	run_json read adxl345/channel@0 reg
	assert_json '.value | if type == "array" then join(" ") else . end' 0
	run_json read ad7124_8
	assert_json '[.children[]?.key] | index("channel@0")' null
}

# Description: move refuses a node of the base devicetree.
# Steps:
#   1. Snapshot the workfile.
#   2. Move spi0 to spi1, with --json.
#   3. Check it is refused (exit 0, .ok false); the message names the base file and says move only
#      applies to overlay-added nodes.
#   4. Check the workfile is unchanged.
# bats test_tags=req:MOVE-01, id:L0225
@test "move refuses a node of the base" {
	snapshot
	run_json move spi0 spi1
	assert_success
	assert_json '.ok' false
	assert_json '.message' "spi0 is part of the base device tree ($LINUX_BASE), not this overlay; move only applies to overlay-added nodes"
	assert_unchanged
}

# Description: move refuses a node or a parent that does not exist.
# Steps:
#   1. Snapshot the workfile.
#   2. Move nosuch to spi1, with --json; check it is refused (exit 0, .ok false), nosuch not found.
#   3. Move ad7124_8 to nosuch, with --json; check it is refused, the parent not found.
#   4. Check the workfile is unchanged.
# bats test_tags=req:MOVE-01, id:L0226
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

# Description: move refuses to put a node under itself or one of its descendants.
# Steps:
#   1. Snapshot the workfile.
#   2. Move ad7124_8 to ad7124_8/channel@0, with --json.
#   3. Check it is refused (exit 0, .ok false) and the message says it can't move into itself.
#   4. Check the workfile is unchanged.
# bats test_tags=req:MOVE-01, id:L0227
@test "move refuses to put a node into itself" {
	snapshot
	run_json move ad7124_8 ad7124_8/channel@0
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Cannot move ad7124_8 into itself or one of its descendants"
	assert_unchanged
}

# Description: move needs both the node and the new parent.
# Steps:
#   1. Run move ad7124_8, with no destination.
#   2. Check it fails with a usage error (exit 2) that says the destination is expected.
# bats test_tags=req:MOVE-01, id:L0228
@test "move needs both the node and the parent" {
	run aa move ad7124_8
	assert_failure 2
	assert_output --partial "Expected argument for destination"
}

# Description: move under a parent the node's binding does not allow is refused, and the message
# names the valid kind of parent.
# Steps:
#   1. Snapshot the workfile.
#   2. Move ad7124_8, an SPI device on spi0, to i2c1, with --json; check it is refused (exit 0,
#      .ok false) and the message names spi1 among the valid parents (neither the node's bus
#      nor the destination).
#   3. Check the workfile is unchanged.
#   4. Move ad7124_8 to /memory@0, with --json; check it is refused and the workfile unchanged.
# bats test_tags=req:MOVE-02, id:L0229
@test "move under a parent the binding doesn't allow is refused, naming the valid parents" {
	snapshot
	run_json move ad7124_8 i2c1
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("goes under .*\\bspi1\\b")' true
	assert_unchanged
	run_json move ad7124_8 /memory@0
	assert_json '.ok' false
	assert_unchanged
}
