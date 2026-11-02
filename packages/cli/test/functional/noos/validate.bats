# validate where the backend is noos: the workfile checked against its schemas.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet. Most tests
# then add the eval-testpart board (with_sensor) and break it by editing the workfile.
setup() {
	load ../helpers
	new_project noos
}

# `edit_workfile <node> <jq filter>`: change the workfile behind the CLI's back, for values
# `update` refuses. The node's `$auto` list is emptied, so its values count as the user's.
edit_workfile() {
	local node=$1 filter=$2 edited
	edited=$(jq --arg node "$node" "$filter | .symbols[\$node][\"\$auto\"] = []" "$PROJECT/workfile.json") ||
		fail "edit_workfile: jq failed"
	printf '%s\n' "$edited" >"$PROJECT/workfile.json"
}

# `with_raw_required`: the sensor of with_sensor, its init param given a required raw value
# with no default (`calib`), left empty: a warning. A copy of the fixture's driver collection.
with_raw_required() {
	local drivers="$BATS_TEST_TMPDIR/driver-collection"
	cp -r "$NOOS_FIXTURES/driver-collection" "$drivers"
	printf 'calib:\n  type: raw\n  required: true\n  description: "Calibration"\n' \
		>>"$drivers/drivers/sensor/testpart/analog-attach/testpart_init_param.yaml"
	local config="$PROJECT/.analog-attach/config.json" edited
	edited=$(jq --arg drivers "$drivers" '.noos["module-paths"][1] = $drivers' "$config")
	printf '%s\n' "$edited" >"$config"
	with_sensor
}

# Description: a valid workfile has no errors and no warnings, and validate says it is valid.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Validate, with --json.
#   3. Check it succeeds with no errors and no warnings.
#   4. Validate without --json, and check it says the workfile is valid.
# bats test_tags=req:VALIDATE-01, id:N0269
@test "validate finds no problem in a valid workfile" {
	with_sensor
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
	run aa validate
	assert_output --partial "Workfile is valid"
}

# Description: each problem is reported with the node and property it concerns, and a message.
# Steps:
#   1. Create the workfile with init, and add the testpart chip alone.
#   2. Validate, with --json, and check it succeeds.
#   3. Check the errors all concern testpart_spi_dev: controller, cs_gpio and native_cs, each with a
#      message.
#   4. Validate without --json, and check it names testpart_spi_dev, the controller with no value
#      and the cs_gpio choice.
# bats test_tags=req:VALIDATE-01, id:N0270
@test "validate reports each problem with the device and the property it concerns" {
	aa init
	aa add testpart
	run_json validate
	assert_success
	# The chip select and the controller are left unset on the SPI device.
	assert_json '[.errors[].path[0]] | unique | join(",")' testpart_spi_dev
	assert_json '[.errors[].path[1]] | sort | join(",")' controller,cs_gpio,native_cs
	assert_json '[.errors[].message | length > 0] | all' true
	run aa validate
	assert_line "  testpart_spi_dev"
	assert_line --partial "controller: Required property has no value"
	assert_line --partial "cs_gpio: needs one of"
}

# Description: validate reports the problems of every node, not only the first one found.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Edit the workfile: set testpart_spi_dev.mode to BOGUS and remove testpart_cs_gpio.number.
#   3. Validate, with --json.
#   4. Check the errors are testpart_cs_gpio.number and testpart_spi_dev.mode.
# bats test_tags=req:VALIDATE-01, id:N0271
@test "validate checks every node of the workfile, not only the first with a problem" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.mode = "BOGUS"'
	edit_workfile testpart_cs_gpio 'del(.symbols.testpart_cs_gpio.number)'
	run_json validate
	assert_json '[.errors[].path | join(".")] | sort | join(",")' testpart_cs_gpio.number,testpart_spi_dev.mode
}

# Description: a required raw value left empty is a warning, not an error, and the summary says
# there are warnings and no errors.
# Steps:
#   1. Add a required raw property calib, with no default, to testpart's init param, and create
#      the eval-testpart workfile.
#   2. Validate, with --json, and check it succeeds with no errors and one warning on
#      testpart_ip.calib.
#   3. Validate without --json, and check it says the workfile has warnings, 0 errors and 1
#      warning, and not that it has errors.
# bats test_tags=req:VALIDATE-02, id:N0272
@test "a required raw value left empty is a warning, and the result says there are no errors" {
	with_raw_required
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 1
	assert_json '.warnings[0].path | join(".")' testpart_ip.calib
	run aa validate
	assert_line --partial "Workfile has warnings"
	assert_line --partial "0 errors, 1 warning"
	refute_output --partial "Workfile has errors"
}

# Description: errors and warnings are reported apart, and with any error the summary says the
# workfile has errors.
# Steps:
#   1. Add the required raw property calib, as in N0272, and create the eval-testpart workfile.
#   2. Edit the workfile: set testpart_spi_dev.mode to BOGUS.
#   3. Validate, with --json, and check the error is testpart_spi_dev.mode and the warning
#      testpart_ip.calib.
#   4. Validate without --json, and check it says the workfile has errors, 1 error and 1 warning.
# bats test_tags=req:VALIDATE-02, id:N0273
@test "errors and warnings are kept apart, and the result says there are errors" {
	with_raw_required
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.mode = "BOGUS"'
	run_json validate
	assert_json '[.errors[].path | join(".")] | join(",")' testpart_spi_dev.mode
	assert_json '[.warnings[].path | join(".")] | join(",")' testpart_ip.calib
	run aa validate
	assert_line --partial "Workfile has errors"
	assert_line --partial "1 error, 1 warning"
}

# Description: a required value left empty is reported as an error.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Edit the workfile: remove testpart_cs_gpio.number.
#   3. Validate, with --json.
#   4. Check there is one error, on testpart_cs_gpio.number, saying the required property has no
#      value.
# bats test_tags=req:VALIDATE-03-CAPI, id:N0274
@test "validate reports a required value left empty" {
	with_sensor
	edit_workfile testpart_cs_gpio 'del(.symbols.testpart_cs_gpio.number)'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_cs_gpio.number
	assert_json '.errors[0].message' "Required property has no value"
}

# Description: a value outside the definition's allowed values is reported as an error.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Edit the workfile: set testpart_spi_dev.mode to BOGUS.
#   3. Validate, with --json.
#   4. Check there is one error, on testpart_spi_dev.mode, naming BOGUS and an allowed value
#      (TEST_SPI_MODE_0).
# bats test_tags=req:VALIDATE-03-CAPI, id:N0275
@test "validate reports a value the definition doesn't allow" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.mode = "BOGUS"'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.mode
	assert_json '.errors[0].message | test("BOGUS") and test("TEST_SPI_MODE_0")' true
}

# Description: a number above the definition's maximum is reported as an error.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Edit the workfile: set testpart_spi_dev.max_speed_hz to 99999999.
#   3. Validate, with --json.
#   4. Check there is one error, on testpart_spi_dev.max_speed_hz, mentioning the maximum.
# bats test_tags=req:VALIDATE-03-CAPI, id:N0276
@test "validate reports a number out of the definition's range" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.max_speed_hz = 99999999'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.max_speed_hz
	assert_json '.errors[0].message | test("maximum")' true
}

# Description: a reference to a node the workfile doesn't have is reported as an error.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Edit the workfile: set testpart_spi_dev.cs_gpio to nosuchnode.
#   3. Validate, with --json.
#   4. Check the first error is on testpart_spi_dev.cs_gpio and names nosuchnode.
# bats test_tags=req:VALIDATE-03-CAPI, id:N0277
@test "validate reports a reference to a device the workfile doesn't have" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.cs_gpio = "nosuchnode"'
	run_json validate
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.cs_gpio
	assert_json '.errors[0].message | test("nosuchnode")' true
}

# Description: a reference to a node of the wrong schema is reported as an error.
# Steps:
#   1. Create a workfile with the eval-testpart board (with_sensor).
#   2. Edit the workfile: point testpart_spi_dev.cs_gpio at testpart_cfg.
#   3. Validate, with --json.
#   4. Check there is one error, on testpart_spi_dev.cs_gpio, naming the expected schema
#      test_gpio_pin.
# bats test_tags=req:VALIDATE-03-CAPI, id:N0278
@test "validate reports a reference to a device of the wrong type" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.cs_gpio = "testpart_cfg"'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.cs_gpio
	assert_json '.errors[0].message | test("test_gpio_pin")' true
}
