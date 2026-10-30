# rename where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# bats test_tags=req:RENAME-01
@test "rename gives a device a new name" {
	run_json rename testpart_spi_dev my_spi
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Renamed 'testpart_spi_dev' to 'my_spi'"
	[ "$(stored '.symbols | has("testpart_spi_dev")')" = false ]
	[ "$(stored '.symbols.my_spi["$compatible"]')" = '"test_spi_device"' ]
	run_json read my_spi max_speed_hz
	assert_json '.value' 1000000
}

# bats test_tags=req:RENAME-01
@test "rename refuses a name that is not a valid C name" {
	snapshot
	run_json rename testpart_spi_dev 1bad
	assert_json '.ok' false
	assert_json '.message' "Symbol '1bad' is not a valid C name"
	run_json rename testpart_spi_dev my-spi
	assert_json '.ok' false
	assert_json '.message' "Symbol 'my-spi' is not a valid C name"
	assert_unchanged
}

# bats test_tags=req:RENAME-01
@test "rename refuses a name another device has" {
	snapshot
	run_json rename testpart_spi_dev testpart_ip
	assert_json '.ok' false
	assert_json '.message' "Symbol 'testpart_ip' already exists"
	# A node of the target counts too.
	run_json rename testpart_spi_dev testpart_ops
	assert_json '.ok' false
	assert_json '.message' "Symbol 'testpart_ops' already exists"
	assert_unchanged
}

# bats test_tags=req:RENAME-01
@test "rename refuses a device that does not exist" {
	snapshot
	run_json rename nosuch foo
	assert_json '.ok' false
	assert_json '.message' "Symbol 'nosuch' not found"
	assert_unchanged
}

# bats test_tags=req:RENAME-02
@test "rename updates every reference to the device" {
	aa rename testpart_spi_dev my_spi >/dev/null
	[ "$(stored '.symbols.testpart_ip.comm_init')" = '{"spi_dev":"my_spi"}' ]
	aa rename testpart_cs_gpio cs_pin >/dev/null
	[ "$(stored '.symbols.my_spi.cs_gpio')" = '"cs_pin"' ]
	aa rename testpart_cfg cfg >/dev/null
	[ "$(stored '.symbols.testpart["$init_param"]')" = '"cfg"' ]
	# Nothing names an old name any more, and the workfile is still valid.
	run grep -E '"(testpart_spi_dev|testpart_cs_gpio|testpart_cfg)"' "$PROJECT/workfile.json"
	assert_failure
	run_json validate
	assert_success
	assert_json '.errors | length' 0
}
