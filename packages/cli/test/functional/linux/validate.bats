# validate where the backend is linux: the overlay, with the base, checked by dt-validate against
# the bindings, and the addresses its nodes claim.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
	with_overlay
}

# `complete_adxl <add arguments>...`: adds an ADXL345 (label adxl345) with its interrupt on the
# gpio controller, so that dt-validate finds nothing wrong with it.
complete_adxl() {
	aa add adi,adxl345 "$@" >/dev/null 2>&1 || fail "add adi,adxl345 failed"
	aa update adxl345 interrupt-parent gpio >/dev/null || fail "update interrupt-parent failed"
	aa update adxl345 interrupts 25 IRQ_TYPE_EDGE_RISING >/dev/null || fail "update interrupts failed"
}

# `bad_channel`: an AD7124-8 on spi1 (node adi,ad7124-8@0), complete but for channel@0's
# adi,reference-select, 2, which the binding doesn't allow (0, 1 or 3).
bad_channel() {
	aa add adi,ad7124-8 --parent spi1 >/dev/null 2>&1 || fail "add adi,ad7124-8 failed"
	aa update ad7124_8 interrupt-parent gpio >/dev/null
	aa update ad7124_8 interrupts 26 IRQ_TYPE_EDGE_FALLING >/dev/null
	aa update ad7124_8 channel@0 >/dev/null 2>&1
	aa update ad7124_8/channel@0 diff-channels 0 1 >/dev/null
	aa update ad7124_8/channel@0 adi,reference-select 2 >/dev/null
}

# bats test_tags=req:VALIDATE-01
@test "validate finds no problem in a valid overlay" {
	complete_adxl --parent i2c1
	aa update adxl345 reg 0x53 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
	run aa validate
	assert_success
	assert_output "No errors!"
}

# bats test_tags=req:VALIDATE-01
@test "validate reports a problem with the device and the property it concerns" {
	bad_channel
	run_json validate
	assert_success
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | index("adi,ad7124-8@0") != null' true
	assert_json '.errors[0].path[-2:] | join("/")' channel@0/adi,reference-select
	assert_json '.errors[0].message | contains("2 is not one of [0, 1, 3]")' true
	run aa validate
	assert_line "spi1/adi,ad7124-8@0:"
	assert_line "  error: channel@0/adi,reference-select: 2 is not one of [0, 1, 3]"
}

# bats test_tags=req:VALIDATE-01
@test "validate reports a required property a device lacks" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '.errors[0].path[-1]' adi,adxl345@0
	assert_json '.errors[0].message | contains("'"'"'interrupts'"'"' is a required property")' true
	run aa validate
	assert_line "i2c_arm/adi,adxl345@0:"
	assert_output --partial "'interrupts' is a required property"
}

# bats test_tags=req:VALIDATE-01
@test "validate checks every node of the overlay, not only the first with a problem" {
	bad_channel
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '[.errors[].path | map(select(contains("@"))) | .[0]] | sort | join(" ")' \
		"adi,ad7124-8@0 adi,adxl345@0"
	run aa validate
	assert_line "spi1/adi,ad7124-8@0:"
	assert_line "i2c_arm/adi,adxl345@0:"
}

# bats test_tags=req:VALIDATE-01
@test "validate changes nothing in the overlay" {
	bad_channel
	snapshot
	run aa validate
	assert_success
	assert_unchanged
}

# bats test_tags=req:VALIDATE-02
@test "a warning alone leaves the result without errors" {
	# Chip select 2 of spi0, which has cs-gpios for 0 and 1 only: a warning.
	complete_adxl --parent spi0
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 1
	run aa validate
	assert_line "  warning: reg: chip select 2 has no cs-gpios entry: spi@7e204000 has chip selects 0-1"
	assert_line "No errors! (1 warning(s))"
}

# bats test_tags=req:VALIDATE-02
@test "errors and warnings are kept apart, errors first" {
	# No interrupts (an error), on chip select 2 of spi0 (a warning).
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '.errors | length' 1
	assert_json '.warnings | length' 1
	assert_json '.warnings[0].path[-1]' reg
	run aa validate
	refute_output --partial "No errors!"
	local error_line warning_line
	error_line=$(grep -n '^  error:' <<<"$output" | head -1 | cut -d: -f1)
	warning_line=$(grep -n '^  warning:' <<<"$output" | head -1 | cut -d: -f1)
	[ "$error_line" -lt "$warning_line" ] || fail "the error comes after the warning: $output"
}

# Gap: with errors there is no summary line (open issue V-8): the output ends with the last
# diagnostic.
# bats test_tags=req:VALIDATE-02, gap
@test "with errors, the result ends saying how many there are" {
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	run aa validate
	assert_success
	[[ "${lines[-1]}" =~ ^[^\ ].*[0-9]+\ error ]] || fail "no summary: ${lines[-1]}"
}

# bats test_tags=req:VALIDATE-03-LNX
@test "validate decodes the overlay's references with the base's cells" {
	# gpio of the base has #interrupt-cells = <2>: two cells are right, three too many.
	complete_adxl --parent i2c1
	run_json validate
	assert_json '.errors | length' 0
	aa update adxl345 interrupts 25 1 7 >/dev/null 2>&1
	run_json validate
	assert_json '.errors[0].path[-1]' interrupts
	assert_json '.errors[0].message | contains("is too long")' true
}

# Gap: only the nodes the overlay adds are checked (open issue V-9): a property it sets on a
# base node (status on spi0) isn't, and the run says `No errors!`.
# bats test_tags=req:VALIDATE-03-LNX, gap
@test "validate checks what the overlay sets on a base node" {
	aa update spi0 status bogus >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '.errors | length > 0' true
	assert_json '[.errors[].path[-1]] | index("status") != null' true
}

# bats test_tags=req:VALIDATE-03-LNX
@test "validate reports a chip select a base node already uses, and how to free it" {
	complete_adxl --parent spi0 --name adi,adxl345@0
	run_json validate
	assert_success
	assert_json '.warnings[0].path[-1]' reg
	assert_json '.warnings[0].message' \
		"chip select 0 is already used by spidev@0; If adi,adxl345@0 replaces it: disable /soc/spi@7e204000/spidev@0"
	run aa validate
	assert_line "spi0/adi,adxl345@0:"
	assert_line "  warning: reg: chip select 0 is already used by spidev@0"
	assert_line "    note: If adi,adxl345@0 replaces it: disable /soc/spi@7e204000/spidev@0"
}

# bats test_tags=req:VALIDATE-03-LNX
@test "a base node the overlay disables no longer clashes" {
	complete_adxl --parent spi0 --name adi,adxl345@0
	aa disable spidev0 >/dev/null
	run_json validate
	assert_success
	assert_json '.warnings | length' 0
	assert_json '.errors | length' 0
}

# bats test_tags=req:VALIDATE-03-LNX
@test "validate reports two nodes of the overlay at one I2C address" {
	complete_adxl --parent i2c1
	aa update adxl345 reg 0x53 >/dev/null 2>&1
	aa add adi,adxl346 --parent i2c1 >/dev/null 2>&1
	aa update adxl346 reg 0x53 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '[.warnings[].message] | join("\n")' "address 0x53 is already used by adi,adxl345@53"
	run aa validate
	assert_line "  warning: reg: address 0x53 is already used by adi,adxl345@53"
	# Both are the overlay's: no hint to disable either.
	refute_output --partial "disable"
}

# bats test_tags=req:VALIDATE-03-LNX
@test "validate reports a chip select with no cs-gpios entry" {
	complete_adxl --parent spi0
	run_json validate
	assert_success
	assert_json '.warnings[0].message' \
		"chip select 2 has no cs-gpios entry: spi@7e204000 has chip selects 0-1; Use one of those, or add a GPIO for it to cs-gpios of /soc/spi@7e204000"
}

# bats test_tags=req:VALIDATE-03-LNX
@test "validate leaves out the base's own nodes" {
	# The base alone: nothing of it is reported, whatever its bindings say.
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
}
