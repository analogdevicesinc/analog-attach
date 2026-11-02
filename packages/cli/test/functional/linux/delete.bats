# delete where the backend is linux: a property, a node the overlay adds, everything.

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

# bats test_tags=req:DELETE-01, req:DELETE-01-LNX
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

# bats test_tags=req:DELETE-01
@test "delete <path> <property> in human mode says what it removed from where" {
	run aa delete ad7124_8/channel@0 bipolar
	assert_success
	assert_output "Removed bipolar from ad7124_8/channel@0 in $WORKFILE"
}

# bats test_tags=req:DELETE-01
@test "delete of a property the node doesn't set is refused" {
	snapshot
	run_json delete ad7124_8 spi-max-frequency
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: spi-max-frequency on ad7124_8"
	assert_unchanged
}

# bats test_tags=req:DELETE-02
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

# bats test_tags=req:DELETE-02
@test "delete <path> in human mode says what it deleted from where" {
	run aa delete adxl345
	assert_success
	assert_output "Deleted adxl345 from $WORKFILE"
}

# bats test_tags=req:DELETE-02
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

# bats test_tags=req:DELETE-02
@test "delete <path> --force removes a node with its children" {
	run_json delete ad7124_8 --force
	assert_success
	assert_json '.message' "Deleted ad7124_8"
	run grep -nE 'ad7124|channel@0' "$WORKFILE"
	assert_failure
}

# Gap: a node another node references is deleted at once, with no preview, and the reference
# is left dangling (refin1-supply = <&vref> with no vref).
# bats test_tags=req:DELETE-02, gap
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
	run grep -n 'refin1-supply' "$WORKFILE"
	assert_failure
}

# bats test_tags=req:DELETE-03
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

# bats test_tags=req:DELETE-03
@test "delete --force with no arguments removes everything and keeps the header" {
	run aa delete --force
	assert_success
	assert_output "Deleted all overlay content from $WORKFILE"
	run cat "$WORKFILE"
	assert_output $'/dts-v1/;\n/plugin/;\n/ {\n};'
}

# bats test_tags=req:DELETE-03
@test "delete of the root node is refused" {
	snapshot
	run_json delete /
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Cannot delete the root node"
	assert_unchanged
}

# bats test_tags=req:DELETE-04
@test "a base node the overlay targets is refused as part of the base" {
	snapshot
	run_json delete spi0
	assert_success
	assert_json '.ok' false
	assert_json '.message' "spi0 is part of the base device tree ($LINUX_BASE), not this overlay; delete only removes overlay-added nodes"
	assert_unchanged
}

# bats test_tags=req:DELETE-04
@test "a base node the overlay doesn't touch is not found" {
	snapshot
	run_json delete spidev0
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: spidev0"
	assert_unchanged
}

# bats test_tags=req:DELETE-04
@test "a property only the base sets can't be deleted" {
	snapshot
	run_json delete spi0 cs-gpios
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: cs-gpios on spi0"
	assert_unchanged
}

# bats test_tags=req:DELETE-04
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

# bats test_tags=req:DELETE-04
@test "no delete ever changes the base device tree" {
	local before
	before=$(sha1sum "$LINUX_BASE")
	aa delete spi0 >/dev/null
	aa delete spi0 cs-gpios >/dev/null
	aa delete ad7124_8 --force >/dev/null
	aa delete --force >/dev/null
	[ "$(sha1sum "$LINUX_BASE")" = "$before" ] || fail "the base changed"
}

# bats test_tags=req:DELETE-05
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

# bats test_tags=req:DELETE-05
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
