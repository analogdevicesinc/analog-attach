# enable / disable where the backend is linux: a node's status, in the overlay.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
	with_overlay
}

# bats test_tags=req:ENABLE-01
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

# bats test_tags=req:ENABLE-01
@test "enable in human mode says what it enabled where" {
	run aa enable spi1
	assert_success
	assert_output "Enabled spi1 in $WORKFILE"
}

# bats test_tags=req:ENABLE-01
@test "disable switches off a base node by its label and path" {
	run_json disable spi0/spidev@0
	assert_success
	assert_json '.message' "Disabled spi0/spidev@0"
	run aa read spi0/spidev@0 status
	assert_output 'status = "disabled";'
	run grep -c 'target = <&spidev0>;' "$WORKFILE"
	assert_output 1
}

# bats test_tags=req:ENABLE-01
@test "a base node with no label gets a fragment by its path" {
	run_json disable /memory@0
	assert_success
	assert_json '.ok' true
	run grep -c 'target-path = "/memory@0";' "$WORKFILE"
	assert_output 1
}

# bats test_tags=req:ENABLE-01
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

# bats test_tags=req:ENABLE-01
@test "enable and disable never change the base device tree" {
	local before
	before=$(sha1sum "$LINUX_BASE")
	aa enable spi1 >/dev/null
	aa disable spi0/spidev@0 >/dev/null
	[ "$(sha1sum "$LINUX_BASE")" = "$before" ] || fail "the base changed"
}

# bats test_tags=req:ENABLE-01
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

# bats test_tags=req:ENABLE-01
@test "enable and disable need a path" {
	run aa enable
	assert_failure 2
	assert_output "Missing: path"
	run aa disable
	assert_failure 2
	assert_output "Missing: path"
}
