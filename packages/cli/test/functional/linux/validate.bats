# validate where the backend is linux: the overlay, with the base, checked by dt-validate against
# the bindings, and the addresses its nodes claim.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, and an empty overlay
# created with init.
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

# Description: validate of a valid overlay reports no errors and no warnings.
# Steps:
#   1. Add a complete ADXL345 under i2c1 and set its reg to 0x53.
#   2. Run validate, with --json; check it succeeds with no errors and no warnings.
#   3. Run validate in human mode; check it succeeds and prints only No errors!.
# bats test_tags=req:VALIDATE-01, id:L0335
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

# Description: validate reports a binding problem with the device's node and the property it
# concerns.
# Steps:
#   1. Add an AD7124-8 on spi1 whose channel@0 has an adi,reference-select of 2, which the
#      binding does not allow.
#   2. Run validate, with --json; check it succeeds with one error, whose path holds the device
#      node and ends in channel@0/adi,reference-select, and whose message lists the allowed values.
#   3. Run validate in human mode; check it prints the device under spi1 and the error line.
# bats test_tags=req:VALIDATE-01, id:L0336
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

# Description: validate reports a required property a device lacks.
# Steps:
#   1. Add adi,adxl345 under i2c1, without interrupts.
#   2. Run validate, with --json; check it succeeds and the first error is on adi,adxl345@0 and
#      says interrupts is a required property.
#   3. Run validate in human mode; check it prints the device under i2c_arm and the same message.
# bats test_tags=req:VALIDATE-01, id:L0337
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

# Description: validate reports the problems of every node of the overlay, not only the first.
# Steps:
#   1. Add the AD7124-8 with the bad channel on spi1, and an incomplete ADXL345 under i2c1.
#   2. Run validate, with --json; check it succeeds and the errors concern both devices.
#   3. Run validate in human mode; check it prints a heading for each device.
# bats test_tags=req:VALIDATE-01, id:L0338
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

# Description: validate does not change the overlay.
# Steps:
#   1. Add the AD7124-8 with the bad channel on spi1.
#   2. Snapshot the workfile.
#   3. Run validate; check it succeeds and the workfile is unchanged.
# bats test_tags=req:VALIDATE-01, id:L0339
@test "validate changes nothing in the overlay" {
	bad_channel
	snapshot
	run aa validate
	assert_success
	assert_unchanged
}

# Description: a warning alone leaves the result without errors, and the summary counts the
# warning.
# Steps:
#   1. Add a complete ADXL345 under spi0, which lands on chip select 2 with no cs-gpios entry.
#   2. Run validate, with --json; check it succeeds with no errors and one warning.
#   3. Run validate in human mode; check it prints the chip select warning and No errors! with
#      1 warning.
# bats test_tags=req:VALIDATE-02, id:L0340
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

# Description: validate keeps errors and warnings apart, and prints the errors first.
# Steps:
#   1. Add adi,adxl345 under spi0, without interrupts (an error) and on chip select 2 (a warning).
#   2. Run validate, with --json; check it succeeds with one error and one warning, the warning
#      on reg.
#   3. Run validate in human mode; check it does not say No errors!.
#   4. Check the first error line comes before the first warning line.
# bats test_tags=req:VALIDATE-02, id:L0341
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

# Description: with errors, validate ends its output with a line saying how many errors there
# are.
# Steps:
#   1. Add adi,adxl345 under spi0, without interrupts.
#   2. Run validate in human mode; check it succeeds.
#   3. Check the last line is an unindented summary with a count of errors.
# bats test_tags=req:VALIDATE-02, id:L0342
@test "with errors, the result ends saying how many there are" {
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	run aa validate
	assert_success
	[[ "${lines[-1]}" =~ ^([^\ ].*\ )?[0-9]+\ error ]] || fail "no summary: ${lines[-1]}"
}

# Description: validate decodes the overlay's references with the cells of the base's nodes:
# interrupts on the base's gpio take two cells.
# Steps:
#   1. Add a complete ADXL345 under i2c1, with two interrupt cells.
#   2. Run validate, with --json; check there are no errors.
#   3. Update interrupts of adxl345 to three cells.
#   4. Run validate, with --json; check the first error is on interrupts and says it is too long.
# bats test_tags=req:VALIDATE-03-LNX, id:L0343
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

# Description: validate --full checks the overlay merged with the base device tree, so a property
# the overlay sets on a base node is checked against that node's binding.
# Steps:
#   1. Update status of spi0 to bogus.
#   2. Run validate --full, with --json; check it succeeds and reports at least one error on
#      status.
# bats test_tags=req:VALIDATE-03-LNX, id:L0344
@test "validate --full checks what the overlay sets on a base node" {
	aa update spi0 status bogus >/dev/null 2>&1
	run_json validate --full
	assert_success
	assert_json '.errors | length > 0' true
	assert_json '[.errors[].path[-1]] | index("status") != null' true
}

# Description: validate warns about a chip select a base node already uses, and says how to free
# it.
# Steps:
#   1. Add a complete ADXL345 under spi0 named adi,adxl345@0, on chip select 0, which spidev@0
#      of the base uses.
#   2. Run validate, with --json; check it succeeds and the first warning is on reg, naming
#      spidev@0 and the base node to disable.
#   3. Run validate in human mode; check it prints the device, the warning and the note.
# bats test_tags=req:VALIDATE-03-LNX, id:L0345
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

# Description: a base node the overlay disables no longer clashes on its chip select.
# Steps:
#   1. Add a complete ADXL345 under spi0 named adi,adxl345@0.
#   2. Disable spidev0.
#   3. Run validate, with --json; check it succeeds with no warnings and no errors.
# bats test_tags=req:VALIDATE-03-LNX, id:L0346
@test "a base node the overlay disables no longer clashes" {
	complete_adxl --parent spi0 --name adi,adxl345@0
	aa disable spidev0 >/dev/null
	run_json validate
	assert_success
	assert_json '.warnings | length' 0
	assert_json '.errors | length' 0
}

# Description: validate warns about two overlay nodes at the same I2C address, without a hint to
# disable either.
# Steps:
#   1. Add a complete ADXL345 under i2c1 with reg 0x53.
#   2. Add an ADXL346 under i2c1 and set its reg to 0x53 too.
#   3. Run validate, with --json; check it succeeds and the only warning says 0x53 is already
#      used by adi,adxl345@53.
#   4. Run validate in human mode; check it prints the warning and no hint to disable.
# bats test_tags=req:VALIDATE-03-LNX, id:L0347
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

# Description: validate warns about a chip select with no cs-gpios entry, and says how to fix it.
# Steps:
#   1. Add a complete ADXL345 under spi0, which lands on chip select 2.
#   2. Run validate, with --json; check it succeeds and the first warning gives the chip selects
#      the controller has, and says to use one of them or add a GPIO to its cs-gpios.
# bats test_tags=req:VALIDATE-03-LNX, id:L0348
@test "validate reports a chip select with no cs-gpios entry" {
	complete_adxl --parent spi0
	run_json validate
	assert_success
	assert_json '.warnings[0].message' \
		"chip select 2 has no cs-gpios entry: spi@7e204000 has chip selects 0-1; Use one of those, or add a GPIO for it to cs-gpios of /soc/spi@7e204000"
}

# Description: validate does not report problems in the base's own nodes.
# Steps:
#   1. Run validate on the empty overlay, with --json.
#   2. Check it succeeds with no errors and no warnings.
# bats test_tags=req:VALIDATE-03-LNX, id:L0349
@test "validate leaves out the base's own nodes" {
	# The base alone: nothing of it is reported, whatever its bindings say.
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
}

# Description: validate --full leaves out the base's own findings too, and says how many there
# are.
# Steps:
#   1. Run validate --full on the empty overlay, with --json; check it succeeds with no errors
#      and no warnings, and a base_findings count above 0.
#   2. Run it in human mode; check it says No errors!, then that count of findings in the base
#      devicetree.
# bats test_tags=req:VALIDATE-03-LNX, id:L0359
@test "validate --full counts the base's own findings without listing them" {
	run_json validate --full
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
	assert_json '.base_findings > 0' true
	local count
	count=$(jq '.base_findings' <<<"$output")
	run aa validate --full
	assert_success
	assert_line --index 0 'No errors!'
	assert_line --index 1 "$count more finding(s) in the base devicetree"
}
