# validate where the backend is noos: the workfile checked against its schemas.

# bats file_tags=eco:noos

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

# bats test_tags=req:VALIDATE-01
@test "validate finds no problem in a valid workfile" {
	with_sensor
	run_json validate
	assert_success
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
	run aa validate
	assert_output --partial "Workfile is valid"
}

# bats test_tags=req:VALIDATE-01
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

# bats test_tags=req:VALIDATE-01
@test "validate checks every node of the workfile, not only the first with a problem" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.mode = "BOGUS"'
	edit_workfile testpart_cs_gpio 'del(.symbols.testpart_cs_gpio.number)'
	run_json validate
	assert_json '[.errors[].path | join(".")] | sort | join(",")' testpart_cs_gpio.number,testpart_spi_dev.mode
}

# bats test_tags=req:VALIDATE-02
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

# bats test_tags=req:VALIDATE-02
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

# bats test_tags=req:VALIDATE-03-CAPI
@test "validate reports a required value left empty" {
	with_sensor
	edit_workfile testpart_cs_gpio 'del(.symbols.testpart_cs_gpio.number)'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_cs_gpio.number
	assert_json '.errors[0].message' "Required property has no value"
}

# bats test_tags=req:VALIDATE-03-CAPI
@test "validate reports a value the definition doesn't allow" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.mode = "BOGUS"'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.mode
	assert_json '.errors[0].message | test("BOGUS") and test("TEST_SPI_MODE_0")' true
}

# bats test_tags=req:VALIDATE-03-CAPI
@test "validate reports a number out of the definition's range" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.max_speed_hz = 99999999'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.max_speed_hz
	assert_json '.errors[0].message | test("maximum")' true
}

# bats test_tags=req:VALIDATE-03-CAPI
@test "validate reports a reference to a device the workfile doesn't have" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.cs_gpio = "nosuchnode"'
	run_json validate
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.cs_gpio
	assert_json '.errors[0].message | test("nosuchnode")' true
}

# bats test_tags=req:VALIDATE-03-CAPI
@test "validate reports a reference to a device of the wrong type" {
	with_sensor
	edit_workfile testpart_spi_dev '.symbols.testpart_spi_dev.cs_gpio = "testpart_cfg"'
	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].path | join(".")' testpart_spi_dev.cs_gpio
	assert_json '.errors[0].message | test("test_gpio_pin")' true
}
