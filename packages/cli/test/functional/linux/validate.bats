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
#   1. Add a complete ADXL345 under i2c1, set its reg to 0x53, and enable i2c1.
#   2. Run validate, with --json; check it succeeds with no errors and no warnings.
#   3. Run validate in human mode; check it succeeds and prints only No errors!.
# bats test_tags=req:VALIDATE-01, id:L0335
@test "validate finds no problem in a valid overlay" {
	complete_adxl --parent i2c1
	aa update adxl345 reg 0x53 >/dev/null 2>&1
	aa enable i2c1 >/dev/null || fail "enable i2c1 failed"
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
#   3. Run validate in human mode; check it prints the channel under the device's label and the
#      error line.
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
	assert_line "ad7124_8/channel@0:"
	assert_line "  error: adi,reference-select: 2 is not one of [0, 1, 3]"
}

# Description: validate names the property a binding forbids on the node, which dt-validate's
# finding leaves out (False schema does not allow True).
# Steps:
#   1. Add an AD5592R on spi0 and set its spi-cpol, then change its compatible to adi,ad5593r,
#      whose branch of the binding forbids the spi-cpol the node keeps.
#   2. Run validate, with --json; check an error's path ends in spi-cpol and its message reads
#      spi-cpol: the binding doesn't allow it on this node, with no False schema.
#   3. Run validate in human mode; check it prints the error line for spi-cpol.
# bats test_tags=req:VALIDATE-01, id:L0386
@test "validate names the property a binding forbids on the node" {
	aa add adi,ad5592r --parent spi0 >/dev/null 2>&1 || fail "add adi,ad5592r failed"
	aa update ad5592r spi-cpol >/dev/null || fail "update spi-cpol failed"
	aa update ad5592r compatible adi,ad5593r >/dev/null 2>&1 || fail "update compatible failed"
	run_json validate
	assert_success
	assert_json '[.errors[] | select(.path[-1] == "spi-cpol") | .message | test("spi-cpol: the binding doesn.t allow it on this node")] | tojson' '[true]'
	assert_json '[.errors[] | select(.message | test("False schema"))] | length' 0
	run aa validate
	assert_success
	assert_line "  error: spi-cpol: the binding doesn't allow it on this node"
}

# Description: validate reports a required property a device lacks.
# Steps:
#   1. Add adi,adxl345 under i2c1, without interrupts.
#   2. Run validate, with --json; check it succeeds and the first error is on adi,adxl345@0 and
#      says interrupts is a required property.
#   3. Run validate in human mode; check it prints the device by its label and the same message.
# bats test_tags=req:VALIDATE-01, id:L0337
@test "validate reports a required property a device lacks" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '.errors[0].path[-1]' adi,adxl345@0
	assert_json '.errors[0].message | contains("'"'"'interrupts'"'"' is a required property")' true
	run aa validate
	assert_line "adxl345:"
	assert_output --partial "'interrupts' is a required property"
}

# Description: validate reports the problems of every node of the overlay, not only the first.
# Steps:
#   1. Add the AD7124-8 with the bad channel on spi1, and an incomplete ADXL345 under i2c1.
#   2. Run validate, with --json; check it succeeds and the errors concern both devices.
#   3. Run validate in human mode; check it prints a heading for the channel and for the other
#      device.
# bats test_tags=req:VALIDATE-01, id:L0338
@test "validate checks every node of the overlay, not only the first with a problem" {
	bad_channel
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run_json validate
	assert_success
	assert_json '[.errors[].path[2]] | sort | join(" ")' "adi,ad7124-8@0 adi,adxl345@0"
	run aa validate
	assert_line "ad7124_8/channel@0:"
	assert_line "adxl345:"
}

# Description: validate reports a problem in a channel on the channel of the device that has it,
# when another device on another bus has a channel of the same name.
# Steps:
#   1. Add the AD7124-8 with the bad channel on spi1, and a second AD7124-8 on spi0 with a valid
#      channel@0.
#   2. Run validate, with --json; check it succeeds with one error, whose path is the absolute
#      path of the first device's channel property, and no error on the second device.
#   3. Run validate in human mode; check the error is under the first device's channel.
# bats test_tags=req:VALIDATE-01, id:L0388
@test "validate puts a channel's problem on the device that has the channel" {
	bad_channel
	aa add adi,ad7124-8 --parent spi0 >/dev/null 2>&1 || fail "add the second adi,ad7124-8 failed"
	aa update ad7124_8_1 interrupt-parent gpio >/dev/null
	aa update ad7124_8_1 interrupts 27 IRQ_TYPE_EDGE_FALLING >/dev/null
	aa update ad7124_8_1 channel@0 >/dev/null 2>&1
	aa update ad7124_8_1/channel@0 diff-channels 2 3 >/dev/null
	run_json validate
	assert_success
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join("/")' "soc/spi@7e215080/adi,ad7124-8@0/channel@0/adi,reference-select"
	assert_json '[.errors[].path[] | select(. == "adi,ad7124-8@2")] | length' 0
	run aa validate
	assert_success
	assert_line "ad7124_8/channel@0:"
	assert_line "  error: adi,reference-select: 2 is not one of [0, 1, 3]"
	refute_line "ad7124_8_1/channel@0:"
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
#   1. Add a complete ADXL345 under spi0, which lands on chip select 2 with no cs-gpios entry, and
#      enable spi0.
#   2. Run validate, with --json; check it succeeds with no errors and one warning.
#   3. Run validate in human mode; check it prints the chip select warning and No errors! with
#      1 warning.
# bats test_tags=req:VALIDATE-02, id:L0340
@test "a warning alone leaves the result without errors" {
	# Chip select 2 of spi0, which has cs-gpios for 0 and 1 only: a warning.
	complete_adxl --parent spi0
	aa enable spi0 >/dev/null || fail "enable spi0 failed"
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
#   1. Add adi,adxl345 under spi0, without interrupts (an error) and on chip select 2 (a warning),
#      and enable spi0.
#   2. Run validate, with --json; check it succeeds with one error and one warning, the warning
#      on reg.
#   3. Run validate in human mode; check it does not say No errors!.
#   4. Check the first error line comes before the first warning line.
# bats test_tags=req:VALIDATE-02, id:L0341
@test "errors and warnings are kept apart, errors first" {
	# No interrupts (an error), on chip select 2 of spi0 (a warning).
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	aa enable spi0 >/dev/null || fail "enable spi0 failed"
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
#   3. Run validate in human mode; check it prints the device by its label, the warning and the
#      note.
# bats test_tags=req:VALIDATE-03-LNX, id:L0345
@test "validate reports a chip select a base node already uses, and how to free it" {
	complete_adxl --parent spi0 --name adi,adxl345@0
	run_json validate
	assert_success
	assert_json '.warnings[0].path[-1]' reg
	assert_json '.warnings[0].message' \
		"chip select 0 is already used by spidev@0; If adi,adxl345@0 replaces it: disable /soc/spi@7e204000/spidev@0"
	run aa validate
	assert_line "adxl345:"
	assert_line "  warning: reg: chip select 0 is already used by spidev@0"
	assert_line "    note: If adi,adxl345@0 replaces it: disable /soc/spi@7e204000/spidev@0"
}

# Description: a base node the overlay disables no longer clashes on its chip select.
# Steps:
#   1. Add a complete ADXL345 under spi0 named adi,adxl345@0.
#   2. Disable spidev0 and enable spi0.
#   3. Run validate, with --json; check it succeeds with no warnings and no errors.
# bats test_tags=req:VALIDATE-03-LNX, id:L0346
@test "a base node the overlay disables no longer clashes" {
	complete_adxl --parent spi0 --name adi,adxl345@0
	aa disable spidev0 >/dev/null
	aa enable spi0 >/dev/null || fail "enable spi0 failed"
	run_json validate
	assert_success
	assert_json '.warnings | length' 0
	assert_json '.errors | length' 0
}

# Description: validate warns about two overlay nodes at the same I2C address, without a hint to
# disable either.
# Steps:
#   1. Add a complete ADXL345 under i2c1 with reg 0x53.
#   2. Add an ADXL346 under i2c1 and set its reg to 0x53 too, and enable i2c1.
#   3. Run validate, with --json; check it succeeds and the only warning says 0x53 is already
#      used by adi,adxl345@53.
#   4. Run validate in human mode; check it prints the warning and no hint to disable.
# bats test_tags=req:VALIDATE-03-LNX, id:L0347
@test "validate reports two nodes of the overlay at one I2C address" {
	complete_adxl --parent i2c1
	aa update adxl345 reg 0x53 >/dev/null 2>&1
	aa add adi,adxl346 --parent i2c1 >/dev/null 2>&1
	aa update adxl346 reg 0x53 >/dev/null 2>&1
	aa enable i2c1 >/dev/null || fail "enable i2c1 failed"
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

# Description: validate warns about a negative number the overlay writes where the binding takes
# none (spi-max-frequency, a uint32), which dtc stores wrapped and dt-validate takes, until it is
# fixed.
# Steps:
#   1. Add an AD7124-8 on spi1 and set its spi-max-frequency to -1.
#   2. Run validate, with --json; check it succeeds and its one warning on spi-max-frequency says it
#      is unsigned, got -1 (stored as 4294967295), with error type out-of-range.
#   3. Run validate; check the warning is under the node.
#   4. Set spi-max-frequency to 1000000 and run validate, with --json; check there is no warning on
#      spi-max-frequency.
# bats test_tags=req:VALIDATE-03-LNX, id:L0379
@test "validate warns about a negative number in an unsigned cell until it is fixed" {
	aa add adi,ad7124-8 --parent spi1 >/dev/null 2>&1 || fail "add adi,ad7124-8 failed"
	aa update ad7124_8 spi-max-frequency -1 >/dev/null 2>&1 || fail "update spi-max-frequency failed"
	run_json validate
	assert_success
	assert_json '[.warnings[] | select(.path[-1] == "spi-max-frequency") | .message] | join("\n")' \
		"spi-max-frequency is unsigned, got -1 (stored as 4294967295)"
	assert_json '[.warnings[] | select(.path[-1] == "spi-max-frequency") | .error_type] | join(",")' out-of-range
	run aa validate
	assert_line "  warning: spi-max-frequency: spi-max-frequency is unsigned, got -1 (stored as 4294967295)"
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null 2>&1 || fail "update spi-max-frequency failed"
	run_json validate
	assert_success
	assert_json '[.warnings[] | select(.path[-1] == "spi-max-frequency")] | length' 0
}

# Description: validate warns about a device whose parent is disabled, by the base or by the
# overlay, and says how to enable it, until the parent is enabled.
# Steps:
#   1. Add a complete ADXL345 under i2c1, set its reg to 0x53, then disable i2c1.
#   2. Run validate, with --json; check it succeeds and its one warning, on the device's node with
#      error type unresolved, says i2c@7e804000 is not enabled and Linux won't probe the device, and
#      how to enable it.
#   3. Run validate; check the warning is under the device's label, on the node.
#   4. Enable i2c1 and run validate, with --json; check there is no warning.
#   5. Add an ADXL346 under spi1, which the base disables, and run validate, with --json; check its
#      warning names spi@7e215080.
# bats test_tags=req:VALIDATE-05, id:L0384
@test "validate warns about a device on a disabled parent until the parent is enabled" {
	complete_adxl --parent i2c1
	aa update adxl345 reg 0x53 >/dev/null 2>&1
	aa disable i2c1 >/dev/null || fail "disable i2c1 failed"
	run_json validate
	assert_success
	assert_json '.warnings | length' 1
	assert_json '.warnings[0].path[-1]' adi,adxl345@53
	assert_json '.warnings[0].error_type' unresolved
	assert_json '.warnings[0].message' \
		"parent i2c@7e804000 is not enabled (status \"disabled\"): Linux won't probe adi,adxl345@53; Enable it: enable /soc/i2c@7e804000"
	run aa validate
	assert_line "adxl345:"
	assert_line "  warning: (node): parent i2c@7e804000 is not enabled (status \"disabled\"): Linux won't probe adi,adxl345@53"
	assert_line "    note: Enable it: enable /soc/i2c@7e804000"
	aa enable i2c1 >/dev/null || fail "enable i2c1 failed"
	run_json validate
	assert_success
	assert_json '.warnings | length' 0
	aa add adi,adxl346 --parent spi1 >/dev/null 2>&1 || fail "add adi,adxl346 failed"
	run_json validate
	assert_success
	assert_json '[.warnings[] | select(.error_type == "unresolved") | .message | startswith("parent spi@7e215080 is not enabled")] | all' true
	assert_json '[.warnings[] | select(.error_type == "unresolved")] | length' 1
}

# Description: validate warns about a reference to a label that is in neither the base nor the
# overlay, on the property that holds it, without a hint, until the reference names a node.
# Steps:
#   1. Add the first example of adi,adxl345 under i2c1, whose interrupt-parent is &gpio0, a label
#      neither the base nor the overlay has, and enable i2c1.
#   2. Run validate, with --json; check it succeeds with one warning of error type unresolved,
#      whose path is the absolute path of the device's interrupt-parent, and whose message names
#      &gpio0 and nothing more.
#   3. Run validate; check the warning is under the device's label, on interrupt-parent, with
#      no "Did you mean" note.
#   4. Update interrupt-parent of adxl345 to gpio and run validate, with --json; check there is no
#      unresolved warning left.
# bats test_tags=req:VALIDATE-06, id:L0463
@test "validate warns about a reference to a label nothing has, on its property" {
	aa add adi,adxl345 --template example:1 --parent i2c1 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
	aa enable i2c1 >/dev/null || fail "enable i2c1 failed"
	run_json validate
	assert_success
	assert_json '[.warnings[] | select(.error_type == "unresolved")] | length' 1
	assert_json '.warnings[0].path | join("/")' soc/i2c@7e804000/accelerometer@2a/interrupt-parent
	assert_json '.warnings[0].error_type' unresolved
	assert_json '.warnings[0].message' "&gpio0 names no node: no label gpio0 in the base devicetree or the overlay"
	run aa validate
	assert_line "adxl345:"
	assert_line "  warning: interrupt-parent: &gpio0 names no node: no label gpio0 in the base devicetree or the overlay"
	refute_line --partial "Did you mean"
	aa update adxl345 interrupt-parent gpio >/dev/null || fail "update interrupt-parent failed"
	run_json validate
	assert_success
	assert_json '[.warnings[] | select(.error_type == "unresolved")] | length' 0
}

# Description: validate warns about a fragment whose target is in neither the base nor the
# overlay, in the words import lists it with; --full then checks no full devicetree and says so.
# Steps:
#   1. Write the workfile: fragment@0 on spi0, enabling it, and fragment@1 on spi7, which nothing
#      has, adding a node.
#   2. Run validate, with --json; check it succeeds with a warning without a path, error type
#      unresolved, naming fragment@1 and its target as import lists them, and nothing more.
#   3. Run validate; check its first line is that warning, with no "Did you mean" note.
#   4. Run validate --full, with --json; check it succeeds without base_findings, with the same
#      warning and one saying the full devicetree isn't checked, and why.
#   5. Import the workfile under another name, with --json; check it lists fragment@1, target
#      spi7.
# bats test_tags=req:VALIDATE-06, id:L0464
@test "validate warns about a fragment whose target nothing has, as import lists it" {
	cat >"$WORKFILE" <<'EOF'
/dts-v1/;
/plugin/;
/ {
	fragment@0 {
		target = <&spi0>;
		__overlay__ {
			status = "okay";
		};
	};
	fragment@1 {
		target = <&spi7>;
		__overlay__ {
			#address-cells = <1>;
			#size-cells = <0>;
			spidev@0 {
				compatible = "rohm,dh2228fv";
				reg = <0>;
			};
		};
	};
};
EOF
	run_json validate
	assert_success
	assert_json '[.warnings[] | select(.path == [])] | length' 1
	assert_json '.warnings[] | select(.path == []) | .error_type' unresolved
	assert_json '.warnings[] | select(.path == []) | .message' "fragment@1 targets a node the base doesn't have: target spi7"
	run aa validate
	assert_line --index 0 "warning: fragment@1 targets a node the base doesn't have: target spi7"
	refute_line --partial "Did you mean"
	run_json validate --full
	assert_success
	assert_json 'has("base_findings")' false
	assert_json '[.warnings[] | select(.path == []) | .message] | last' \
		"full devicetree not checked: the target of fragment@1 is in neither the base devicetree nor the overlay"
	assert_json '[.warnings[] | select(.path == []) | .error_type] | unique | join(",")' unresolved
	cp "$WORKFILE" mine.dtso
	run_json import mine.dtso
	assert_json '.unresolved_targets | tojson' '[{"fragment":"fragment@1","property":"target","target":"spi7"}]'
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

# `worker_sockets`: the sockets of the validate workers of this test's runtime directory.
worker_sockets() {
	compgen -G "$XDG_RUNTIME_DIR/analog-attach-$(id -u)/validate-*.sock" || true
}

teardown() {
	[ -z "${GUI_PID:-}" ] || kill "$GUI_PID" 2>/dev/null || true
}

# Description: run as the GUI runs it (ANALOG_ATTACH_VALIDATE_WORKER naming the GUI's process),
# validate starts a long-lived dt-validate, gives its answer, the same as dt-validate's, and the
# worker leaves with the GUI's process.
# Steps:
#   1. Add an AD7124-8 whose channel@0 has a value its binding doesn't allow; run validate
#      --json without the variable.
#   2. Start a stand-in for the GUI's process; with the variable naming it, run validate --json;
#      check the same answer, and that a worker socket appears in the private directory (0700),
#      itself 0600.
#   3. Put a dt-validate that fails first on PATH; run validate --json again; check the same
#      answer: the worker gave it, not dt-validate.
#   4. Stop the stand-in; check the worker leaves and removes its socket.
# bats test_tags=req:VALIDATE-04, id:L0382
@test "validate under the GUI keeps dt-validate running and gives the same answer" {
	export XDG_RUNTIME_DIR="$BATS_TEST_TMPDIR/run"
	mkdir -m 700 "$XDG_RUNTIME_DIR"
	bad_channel
	run_json validate
	assert_success
	local expected=$output
	assert_json '.errors | length' 1

	# fd 3 closed: bats waits for what holds it, and the worker outlives the run.
	sleep 600 3>&- &
	GUI_PID=$!
	ANALOG_ATTACH_VALIDATE_WORKER=$GUI_PID run_json validate 3>&-
	assert_success
	assert_equal "$output" "$expected"
	local tries=0
	until [ -n "$(worker_sockets)" ] || [ $((tries += 1)) -gt 100 ]; do sleep 0.1; done
	local socket
	socket=$(worker_sockets)
	[ -n "$socket" ] || fail "no worker socket in $XDG_RUNTIME_DIR"
	assert_equal "$(stat -c %a "$(dirname "$socket")")" 700
	assert_equal "$(stat -c %a "$socket")" 600

	mkdir "$BATS_TEST_TMPDIR/failing"
	printf '#!/bin/sh\necho "dt-validate ran" >&2\nexit 3\n' >"$BATS_TEST_TMPDIR/failing/dt-validate"
	chmod +x "$BATS_TEST_TMPDIR/failing/dt-validate"
	PATH="$BATS_TEST_TMPDIR/failing:$PATH" ANALOG_ATTACH_VALIDATE_WORKER=$GUI_PID run_json validate 3>&-
	assert_success
	assert_equal "$output" "$expected"

	kill "$GUI_PID"
	tries=0
	until [ -z "$(worker_sockets)" ] || [ $((tries += 1)) -gt 100 ]; do sleep 0.1; done
	[ -z "$(worker_sockets)" ] || fail "the worker didn't leave with the GUI's process"
	! pgrep -f "$socket" >/dev/null || fail "the worker still runs"
}
