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
# bats test_tags=req:ENABLE-01, id:L0115
@test "a base node with no label gets a fragment by its path" {
	run_json disable /memory@0
	assert_success
	assert_json '.ok' true
	run grep -c 'target-path = "/memory@0";' "$WORKFILE"
	assert_output 1
}

# Description: enable and disable switch a node the overlay adds, replacing its one status.
# Steps:
#   1. Add adi,adxl345 under i2c1.
#   2. Disable adxl345, with --json; check it succeeds and says it disabled adxl345.
#   3. Read its status, with --json; check it is disabled.
#   4. Enable adxl345, with --json; check it says it enabled it, and its status is okay.
#   5. Check the workfile has only one status property.
# bats test_tags=req:ENABLE-01, id:L0116
@test "enable and disable switch a node of the overlay" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1 || fail "add failed"
	run_json disable adxl345
	assert_success
	assert_json '.message' "Disabled adxl345"
	run_json read adxl345 status
	assert_json '.value' disabled
	run_json enable adxl345
	assert_json '.message' "Enabled adxl345"
	run_json read adxl345 status
	assert_json '.value' okay
	# One status, replaced, not a second one.
	run grep -c 'status = ' "$WORKFILE"
	assert_output 1
}

# Description: enable and disable never change the base devicetree file.
# Steps:
#   1. Take a checksum of the base devicetree.
#   2. Enable spi1 and disable spi0/spidev@0.
#   3. Check the base's checksum is the same.
# bats test_tags=req:ENABLE-01, id:L0117
@test "enable and disable never change the base device tree" {
	local before
	before=$(sha1sum "$LINUX_BASE")
	aa enable spi1 >/dev/null
	aa disable spi0/spidev@0 >/dev/null
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
