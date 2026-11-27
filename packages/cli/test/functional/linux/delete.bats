# delete where the backend is linux: a property, a node the overlay adds, everything.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, and an overlay workfile
# with an AD7124-8 (label ad7124_8) on spi0 with channel@0 (diff-channels, bipolar), and an
# ADXL345 (label adxl345) on i2c_arm, each in its own fragment.
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
							bipolar;
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

# Description: delete with a path and a property removes that property, and leaves the node and its
# other properties.
# Steps:
#   1. Delete bipolar from ad7124_8/channel@0, with --json.
#   2. Check it succeeds (.ok true) and the message says what it removed from where.
#   3. Check bipolar is gone from the workfile.
#   4. Read diff-channels of the channel, with --json, and check it is still 0 1.
# bats test_tags=req:DELETE-01, req:DELETE-01-LNX, id:L0084
@test "delete <path> <property> removes the property from the node" {
	run_json delete ad7124_8/channel@0 bipolar
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Removed bipolar from ad7124_8/channel@0"
	run grep -n bipolar "$WORKFILE"
	assert_failure
	# The node and its other properties stay.
	run_json read ad7124_8/channel@0 diff-channels
	assert_json '.value | join(" ")' "0 1"
}

# Description: in human mode, delete of a property says what it removed, from which node and
# which workfile.
# Steps:
#   1. Delete bipolar from ad7124_8/channel@0.
#   2. Check it succeeds and the output names the property, the node and the workfile.
# bats test_tags=req:DELETE-01, id:L0085
@test "delete <path> <property> in human mode says what it removed from where" {
	run aa delete ad7124_8/channel@0 bipolar
	assert_success
	assert_output "Removed bipolar from ad7124_8/channel@0 in $WORKFILE"
}

# Description: deleting a property the node does not set is refused and leaves the workfile as it
# was.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete spi-max-frequency from ad7124_8, with --json.
#   3. Check it is refused (exit 0, .ok false), the message says the property is not found there.
#   4. Check the workfile is unchanged.
# bats test_tags=req:DELETE-01, id:L0086
@test "delete of a property the node doesn't set is refused" {
	snapshot
	run_json delete ad7124_8 spi-max-frequency
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: spi-max-frequency on ad7124_8"
	assert_unchanged
}

# Description: delete with a path removes a node the overlay adds, and the fragment it leaves
# empty.
# Steps:
#   1. Delete adxl345, with --json.
#   2. Check it succeeds (.ok true) and the message says adxl345 was deleted.
#   3. Check adxl345 is gone from the workfile.
#   4. Check only one fragment is left.
# bats test_tags=req:DELETE-02, id:L0087
@test "delete <path> removes a node the overlay adds" {
	run_json delete adxl345
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Deleted adxl345"
	run grep -n adxl345 "$WORKFILE"
	assert_failure
	# Its fragment, now empty, goes too.
	run grep -c 'fragment@' "$WORKFILE"
	assert_output 1
}

# Description: in human mode, delete of a node says what it deleted and from which workfile.
# Steps:
#   1. Delete adxl345.
#   2. Check it succeeds and the output names the node and the workfile.
# bats test_tags=req:DELETE-02, id:L0088
@test "delete <path> in human mode says what it deleted from where" {
	run aa delete adxl345
	assert_success
	assert_output "Deleted adxl345 from $WORKFILE"
}

# Description: delete of a node with children, without --force, only previews what would go
# and changes nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete ad7124_8, with --json.
#   3. Check it is a warning with the count of nodes and properties, and lists the node and
#      its channel.
#   4. Check the workfile is unchanged.
#   5. Delete ad7124_8 in human mode; check it prints the same count and the two node paths.
#   6. Check the workfile is still unchanged.
# bats test_tags=req:DELETE-02, id:L0089
@test "delete <path> of a node with children shows what would go and removes nothing" {
	snapshot
	run_json delete ad7124_8
	assert_success
	assert_json '.severity' warn
	assert_json '.message' "Would delete 2 node(s) and 7 property(ies)"
	assert_json '.node_count' 2
	assert_json '.paths | map(join("/")) | join(" ")' "adi,ad7124-8@2 adi,ad7124-8@2/channel@0"
	assert_unchanged
	run aa delete ad7124_8
	assert_success
	assert_line --index 0 "Would delete 2 node(s) and 7 property(ies)"
	assert_line --index 1 "  adi,ad7124-8@2"
	assert_line --index 2 "  adi,ad7124-8@2/channel@0"
	assert_unchanged
}

# Description: delete --force removes a node together with its children.
# Steps:
#   1. Delete ad7124_8 --force, with --json.
#   2. Check it succeeds and the message says ad7124_8 was deleted.
#   3. Check neither the ad7124 node nor channel@0 is left in the workfile.
# bats test_tags=req:DELETE-02, id:L0090
@test "delete <path> --force removes a node with its children" {
	run_json delete ad7124_8 --force
	assert_success
	assert_json '.message' "Deleted ad7124_8"
	run grep -nE 'ad7124|channel@0' "$WORKFILE"
	assert_failure
}

# Description: delete of a node another node references previews the change and removes nothing;
# with --force it removes the node.
# Steps:
#   1. Add a regulator-fixed named and labelled vref, and set refin1-supply of ad7124_8 to vref.
#   2. Snapshot the workfile.
#   3. Delete vref, with --json; check it is a warning whose paths include refin1-supply.
#   4. Check the workfile is unchanged.
#   5. Delete vref --force, with --json; check it succeeds (.ok true) and the vref node is gone.
# bats test_tags=req:DELETE-02, id:L0091
@test "delete <path> of a referenced node shows what would change and removes nothing" {
	aa add regulator-fixed --name vref --label vref >/dev/null 2>&1 || fail "add regulator-fixed failed"
	aa update ad7124_8 refin1-supply vref >/dev/null 2>&1 || fail "update refin1-supply failed"
	snapshot
	run_json delete vref
	assert_success
	assert_json '.severity' warn
	assert_json '.paths | map(join("/")) | any(test("refin1-supply"))' true
	assert_unchanged
	run_json delete vref --force
	assert_success
	assert_json '.ok' true
	run grep -nE '^\s*vref: ' "$WORKFILE"
	assert_failure
}

# Description: delete with no arguments, without --force, previews removing all overlay content
# and changes nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Run delete with no arguments, with --json.
#   3. Check it is a warning with the counts of nodes and properties and lists the three nodes.
#   4. Check the workfile is unchanged.
#   5. Run delete in human mode; check it prints the count and lists adxl345.
#   6. Check the workfile is still unchanged.
# bats test_tags=req:DELETE-03, id:L0092
@test "delete with no arguments shows what would be removed and removes nothing" {
	snapshot
	run_json delete
	assert_success
	assert_json '.severity' warn
	assert_json '.message' "Would delete 3 node(s) and 9 property(ies)"
	assert_json '.node_count' 3
	assert_json '.property_count' 9
	assert_json '.paths | map(join("/")) | join(" ")' \
		"adi,ad7124-8@2 adi,ad7124-8@2/channel@0 adi,adxl345@0"
	assert_unchanged
	run aa delete
	assert_success
	assert_line --index 0 "Would delete 3 node(s) and 9 property(ies)"
	assert_line "  adi,adxl345@0"
	assert_unchanged
}

# Description: delete --force with no arguments removes all overlay content and keeps the overlay
# header and an empty root.
# Steps:
#   1. Run delete --force.
#   2. Check it succeeds and says it deleted all overlay content from the workfile.
#   3. Check the workfile holds only the /dts-v1/; and /plugin/; header and an empty root node.
# bats test_tags=req:DELETE-03, id:L0093
@test "delete --force with no arguments removes everything and keeps the header" {
	run aa delete --force
	assert_success
	assert_output "Deleted all overlay content from $WORKFILE"
	run cat "$WORKFILE"
	assert_output $'/dts-v1/;\n/plugin/;\n/ {\n};'
}

# Description: deleting the root node is refused.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete /, with --json.
#   3. Check it is refused (exit 0, .ok false) with a message that the root can't be deleted.
#   4. Check the workfile is unchanged.
# bats test_tags=req:DELETE-03, id:L0094
@test "delete of the root node is refused" {
	snapshot
	run_json delete /
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Cannot delete the root node"
	assert_unchanged
}

# Description: deleting a base node the overlay targets is refused, saying the node belongs to the
# base devicetree.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete spi0, with --json.
#   3. Check it is refused (exit 0, .ok false); the message names the base file and says delete
#      only removes overlay-added nodes.
#   4. Check the workfile is unchanged.
# bats test_tags=req:DELETE-04, id:L0095
@test "a base node the overlay targets is refused as part of the base" {
	snapshot
	run_json delete spi0
	assert_success
	assert_json '.ok' false
	assert_json '.message' "spi0 is part of the base device tree ($LINUX_BASE), not this overlay; delete only removes overlay-added nodes"
	assert_unchanged
}

# Description: deleting a base node the overlay does not touch is reported as not found.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete spidev0, with --json.
#   3. Check it is refused (exit 0, .ok false) and the message says spidev0 is not found.
#   4. Check the workfile is unchanged.
# bats test_tags=req:DELETE-04, id:L0096
@test "a base node the overlay doesn't touch is not found" {
	snapshot
	run_json delete spidev0
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: spidev0"
	assert_unchanged
}

# Description: deleting a property that only the base sets on a node is reported as not found.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete cs-gpios from spi0, with --json.
#   3. Check it is refused (exit 0, .ok false) and the message says cs-gpios is not found on spi0.
#   4. Check the workfile is unchanged.
# bats test_tags=req:DELETE-04, id:L0097
@test "a property only the base sets can't be deleted" {
	snapshot
	run_json delete spi0 cs-gpios
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: cs-gpios on spi0"
	assert_unchanged
}

# Description: deleting a property the overlay sets on a base node brings back the base's value.
# Steps:
#   1. Enable spi0.
#   2. Read status of spi0, with --json; check its source is the overlay.
#   3. Delete status from spi0, with --json; check it succeeds (.ok true).
#   4. Read status again; check its source is the base and its value disabled.
# bats test_tags=req:DELETE-04, id:L0098
@test "deleting what the overlay sets on a base node brings back the base's value" {
	aa enable spi0 >/dev/null
	run_json read spi0 status
	assert_json '.source' overlay
	run_json delete spi0 status
	assert_success
	assert_json '.ok' true
	run_json read spi0 status
	assert_json '.source' base
	assert_json '.value' disabled
}

# Description: no delete, refused or forced, changes the base devicetree file.
# Steps:
#   1. Take a checksum of the base devicetree.
#   2. Delete spi0, spi0 cs-gpios, ad7124_8 --force, then everything with --force.
#   3. Check the base's checksum is the same.
# bats test_tags=req:DELETE-04, id:L0099
@test "no delete ever changes the base device tree" {
	local before
	before=$(sha1sum "$LINUX_BASE")
	aa delete spi0 >/dev/null
	aa delete spi0 cs-gpios >/dev/null
	aa delete ad7124_8 --force >/dev/null
	aa delete --force >/dev/null
	[ "$(sha1sum "$LINUX_BASE")" = "$before" ] || fail "the base changed"
}

# Description: delete of a node with --force leaves the same workfile in human and JSON mode.
# Steps:
#   1. Save the starting workfile.
#   2. Delete ad7124_8 --force in human mode, and save the result.
#   3. Restore the starting workfile and delete ad7124_8 --force with --json.
#   4. Check it succeeds (.ok true) and the workfile matches the human-mode result.
# bats test_tags=req:DELETE-05, id:L0100
@test "delete <path> --force does the same with and without --json" {
	cp "$WORKFILE" "$BATS_TEST_TMPDIR/start"
	aa delete ad7124_8 --force >/dev/null
	cp "$WORKFILE" "$BATS_TEST_TMPDIR/text"
	cp "$BATS_TEST_TMPDIR/start" "$WORKFILE"
	run_json delete ad7124_8 --force
	assert_success
	assert_json '.ok' true
	cmp -s "$BATS_TEST_TMPDIR/text" "$WORKFILE" ||
		fail "text and JSON differ: $(diff "$BATS_TEST_TMPDIR/text" "$WORKFILE")"
}

# Description: delete --force with no arguments leaves the same workfile in human and JSON mode.
# Steps:
#   1. Save the starting workfile.
#   2. Run delete --force in human mode, and save the result.
#   3. Restore the starting workfile and run delete --force with --json.
#   4. Check it succeeds, says it deleted all overlay content, and the workfile matches the
#      human-mode result.
# bats test_tags=req:DELETE-05, id:L0101
@test "delete --force with no arguments does the same with and without --json" {
	cp "$WORKFILE" "$BATS_TEST_TMPDIR/start"
	aa delete --force >/dev/null
	cp "$WORKFILE" "$BATS_TEST_TMPDIR/text"
	cp "$BATS_TEST_TMPDIR/start" "$WORKFILE"
	run_json delete --force
	assert_success
	assert_json '.message' "Deleted all overlay content"
	cmp -s "$BATS_TEST_TMPDIR/text" "$WORKFILE" ||
		fail "text and JSON differ: $(diff "$BATS_TEST_TMPDIR/text" "$WORKFILE")"
}
