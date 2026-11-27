# enable / disable where the backend is linux: a node's status, in the overlay.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, and an empty overlay
# created with init.
setup() {
	load ../helpers
	new_project linux
	with_overlay
}

# Description: enable switches on a base node by setting its status in a fragment that targets
# it.
# Steps:
#   1. Read status of spi1, with --json; check it is disabled.
#   2. Enable spi1, with --json; check it succeeds (.ok true) and says it enabled spi1.
#   3. Read status of spi1 again; check it is okay and comes from the overlay.
#   4. Check the workfile has one fragment targeting spi1.
# bats test_tags=req:ENABLE-01, id:L0112
@test "enable switches on a base node, in a fragment for it" {
	run_json read spi1 status
	assert_json '.value' disabled
	run_json enable spi1
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Enabled spi1"
	run_json read spi1 status
	assert_json '.value' okay
	assert_json '.source' overlay
	run grep -c 'target = <&spi1>;' "$WORKFILE"
	assert_output 1
}

# Description: in human mode, enable says which node it enabled and in which workfile.
# Steps:
#   1. Enable spi1.
#   2. Check it succeeds and the output names spi1 and the workfile.
# bats test_tags=req:ENABLE-01, id:L0113
@test "enable in human mode says what it enabled where" {
	run aa enable spi1
	assert_success
	assert_output "Enabled spi1 in $WORKFILE"
}

# Description: disable switches off a base node given by a label and a path under it, in a
# fragment targeting the node's own label.
# Steps:
#   1. Disable spi0/spidev@0, with --json; check it succeeds and says what it disabled.
#   2. Read status of spi0/spidev@0; check it is disabled.
#   3. Check the workfile has one fragment targeting spidev0.
# bats test_tags=req:ENABLE-01, id:L0114
@test "disable switches off a base node by its label and path" {
	run_json disable spi0/spidev@0
	assert_success
	assert_json '.message' "Disabled spi0/spidev@0"
	run aa read spi0/spidev@0 status
	assert_output 'status = "disabled";'
	run grep -c 'target = <&spidev0>;' "$WORKFILE"
	assert_output 1
}

# Description: a base node with no label gets a fragment that targets it by its path.
# Steps:
#   1. Disable /memory@0, with --json; check it succeeds (.ok true).
#   2. Check the workfile has one fragment with target-path /memory@0.
#   3. Read status of /memory@0, with --json; check it is disabled and comes from the overlay.
# bats test_tags=req:ENABLE-01, id:L0115
@test "a base node with no label gets a fragment by its path" {
	run_json disable /memory@0
	assert_success
	assert_json '.ok' true
	run grep -c 'target-path = "/memory@0";' "$WORKFILE"
	assert_output 1
	run_json read /memory@0 status
	assert_json '.value' disabled
	assert_json '.source' overlay
}

# Description: disable switches off a node the overlay adds by writing its status, and enable
# switches it on again by removing it, as the overlay adds it enabled.
# Steps:
#   1. Add adi,adxl345 under i2c1.
#   2. Disable adxl345, with --json; check it succeeds and says it disabled adxl345.
#   3. Read its status, with --json; check it is disabled.
#   4. Enable adxl345, with --json; check it says it enabled it and removed the status, as the
#      overlay adds it.
#   5. Check the workfile has no status property, and still has adxl345 with its compatible.
# bats test_tags=req:ENABLE-01, req:ENABLE-03, id:L0116
@test "enable and disable switch a node of the overlay" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1 || fail "add failed"
	run_json disable adxl345
	assert_success
	assert_json '.message' "Disabled adxl345"
	run_json read adxl345 status
	assert_json '.value' disabled
	run_json enable adxl345
	assert_json '.message' "Enabled adxl345 (as the overlay adds it: status removed)"
	run grep -c 'status = ' "$WORKFILE"
	assert_output 0
	run_json read adxl345 compatible
	assert_json '.value' adi,adxl345
}

# Description: disable of a node the base already disables writes nothing, and says why.
# Steps:
#   1. Snapshot the workfile.
#   2. Disable spi0, which the base disables, with --json; check it succeeds and says it is as in
#      the base, with nothing to change.
#   3. Disable spi0 in human mode; check the line names the workfile.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ENABLE-03, id:L0450
@test "disable of a node the base disables writes nothing" {
	snapshot
	run_json disable spi0
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Disabled spi0 (as in the base: nothing to change)"
	run aa disable spi0
	assert_success
	assert_output "Disabled spi0 (as in the base: nothing to change in $WORKFILE)"
	assert_unchanged
}

# Description: disable of a node the base disables removes the overlay's status, and with it the
# block that held only that, so the base's status applies again.
# Steps:
#   1. Enable spi0; check the workfile has a fragment for it.
#   2. Disable spi0; check it says it is as in the base and removed the status from the workfile.
#   3. Check the workfile has no fragment for spi0 and no status.
#   4. Read status of spi0, with --json; check it is disabled and comes from the base.
# bats test_tags=req:ENABLE-03, id:L0451
@test "disable as in the base removes the overlay's status and its empty block" {
	aa enable spi0 >/dev/null || fail "enable spi0 failed"
	grep -q 'target = <&spi0>;' "$WORKFILE" || fail "no fragment for spi0"
	run aa disable spi0
	assert_success
	assert_output "Disabled spi0 (as in the base: status removed from $WORKFILE)"
	run grep -c -e '&spi0' -e 'status = ' "$WORKFILE"
	assert_output 0
	run_json read spi0 status
	assert_json '.value' disabled
	assert_json '.source' base
}

# Description: removing the overlay's status keeps the rest of the node's block.
# Steps:
#   1. Add adi,adxl345 under spi0, and enable spi0.
#   2. Disable spi0, with --json; check it says it removed the status as in the base.
#   3. Check the workfile still has its fragment for spi0, with the device in it, and no status.
# bats test_tags=req:ENABLE-03, id:L0452
@test "removing the status keeps the rest of the block" {
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1 || fail "add failed"
	aa enable spi0 >/dev/null || fail "enable spi0 failed"
	run_json disable spi0
	assert_success
	assert_json '.message' "Disabled spi0 (as in the base: status removed)"
	run grep -c 'target = <&spi0>;' "$WORKFILE"
	assert_output 1
	run grep -c 'status = ' "$WORKFILE"
	assert_output 0
	run_json read adxl345 compatible
	assert_json '.value' adi,adxl345
}

# Description: a base node with no status is enabled, so enable after disable removes the
# overlay's status instead of writing okay.
# Steps:
#   1. Disable spi0/spidev@0, which has no status in the base; check the workfile has a status.
#   2. Enable spi0/spidev@0, with --json; check it says it removed the status as in the base.
#   3. Check the workfile has no fragment for spidev0 and no status.
# bats test_tags=req:ENABLE-03, id:L0453
@test "enable of a node with no status in the base removes the overlay's" {
	aa disable spi0/spidev@0 >/dev/null || fail "disable failed"
	grep -q 'status = "disabled";' "$WORKFILE" || fail "no status written"
	run_json enable spi0/spidev@0
	assert_success
	assert_json '.message' "Enabled spi0/spidev@0 (as in the base: status removed)"
	run grep -c -e '&spidev0' -e 'status = ' "$WORKFILE"
	assert_output 0
}

# Description: enable and disable never change the base devicetree file.
# Steps:
#   1. Take a checksum of the base devicetree.
#   2. Enable spi1 and disable spi0/spidev@0, with --json; check both succeed (.ok true) and the
#      workfile has a fragment for each.
#   3. Check the base's checksum is the same.
# bats test_tags=req:ENABLE-01, id:L0117
@test "enable and disable never change the base device tree" {
	local before
	before=$(sha1sum "$LINUX_BASE")
	run_json enable spi1
	assert_json '.ok' true
	run_json disable spi0/spidev@0
	assert_json '.ok' true
	grep -q 'target = <&spi1>;' "$WORKFILE" || fail "no fragment for spi1"
	grep -q 'target = <&spidev0>;' "$WORKFILE" || fail "no fragment for spidev0"
	[ "$(sha1sum "$LINUX_BASE")" = "$before" ] || fail "the base changed"
}

# Description: enable and disable of a node neither the base nor the overlay has are refused.
# Steps:
#   1. Snapshot the workfile.
#   2. Enable nosuch, with --json; check it is refused (exit 0, .ok false), nosuch not found.
#   3. Disable nosuch; check it is refused (exit 0) and the output names the base and the
#      workfile it looked in.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ENABLE-01, id:L0118
@test "enable of a node neither tree has is refused" {
	snapshot
	run_json enable nosuch
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: nosuch"
	run aa disable nosuch
	assert_success
	assert_output "Couldn't find node nosuch in $LINUX_BASE or $WORKFILE"
	assert_unchanged
}

# Description: enable and disable need a path.
# Steps:
#   1. Run enable with no arguments; check it fails with a usage error (exit 2) saying the path
#      is missing.
#   2. Run disable with no arguments; check the same.
# bats test_tags=req:ENABLE-01, id:L0119
@test "enable and disable need a path" {
	run aa enable
	assert_failure 2
	assert_output "Missing: path"
	run aa disable
	assert_failure 2
	assert_output "Missing: path"
}
