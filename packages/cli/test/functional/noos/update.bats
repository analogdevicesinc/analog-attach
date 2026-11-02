# update where the backend is noos: set, refuse, show, suggest.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# bats test_tags=req:UPDATE-01
@test "update sets a property to the value given" {
	run_json update testpart_spi_dev max_speed_hz 2000000
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Set testpart_spi_dev.max_speed_hz = 2000000"
	[ "$(stored '.symbols.testpart_spi_dev.max_speed_hz')" = 2000000 ]
	run_json read testpart_spi_dev max_speed_hz
	assert_json '.value' 2000000
	assert_json '.source' user
}

# bats test_tags=req:UPDATE-01
@test "update takes a value spread over two arguments" {
	aa add test_array_holder --name holder >/dev/null
	run aa update holder modes TEST_SPI_MODE_0 TEST_SPI_MODE_3
	assert_success
	[ "$(stored '.symbols.holder.modes')" = '["TEST_SPI_MODE_0","TEST_SPI_MODE_3"]' ]
}

# bats test_tags=req:UPDATE-01-CAPI
@test "update takes one value argument, or two for a union; more are refused" {
	aa add test_array_holder --name holder >/dev/null
	aa update holder modes TEST_SPI_MODE_0,TEST_SPI_MODE_3 >/dev/null
	[ "$(stored '.symbols.holder.modes')" = '["TEST_SPI_MODE_0","TEST_SPI_MODE_3"]' ]
	snapshot
	run aa update holder modes TEST_SPI_MODE_0 TEST_SPI_MODE_3 TEST_SPI_MODE_0
	assert_failure 2
	assert_output --partial "Too many values for holder.modes"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses a value that is not a number for a number" {
	snapshot
	run aa update testpart_spi_dev max_speed_hz banana
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'banana' is not a number"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses a value that is not one of an enum's options" {
	snapshot
	run aa update testpart_ip comm_type BOGUS
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'BOGUS' is not one of: TESTPART_SPI, TESTPART_I2C, TESTPART_NONE"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses a union member the union does not have" {
	snapshot
	run aa update testpart_ip comm_init foo,bar
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'foo' is not a member of 'comm_init'. Available: spi_dev, i2c_dev"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses an array longer than its size" {
	aa add test_array_holder --name holder >/dev/null
	snapshot
	run aa update holder modes TEST_SPI_MODE_0,TEST_SPI_MODE_0,TEST_SPI_MODE_0,TEST_SPI_MODE_0
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'modes' holds at most 3 elements, got 4"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses a property the definition does not have" {
	snapshot
	run_json update testpart_ip nosuch 1
	assert_json '.ok' false
	assert_json '.message' "'testpart_ip' has no property 'nosuch', and one cannot be added: its properties are fixed by its schema (testpart_init_param). Available: comm_type, comm_init, dev_ready"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses a number above the maximum" {
	snapshot
	run_json update testpart_spi_dev max_speed_hz 20000000
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("10000000")' true
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses an array element that is not one of its enum's options" {
	aa add test_array_holder --name holder >/dev/null
	snapshot
	run_json update holder modes BAD,TEST_SPI_MODE_0
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("'"'"'BAD'"'"'")' true
	assert_unchanged
}

# bats test_tags=req:UPDATE-03
@test "update without a value shows the property as read does" {
	snapshot
	run aa read testpart_ip comm_type
	local read_text=$output
	run aa update testpart_ip comm_type
	assert_success
	assert_output "$read_text"
	run_json read testpart_ip comm_type
	local read_json=$output
	run_json update testpart_ip comm_type
	assert_success
	assert_output "$read_json"
	assert_unchanged
}

# bats test_tags=req:UPDATE-04
@test "update --suggest lists the values instead of setting the property" {
	snapshot
	run_json update testpart_ip comm_type --suggest
	assert_success
	assert_json '[.suggestions[].value] | join(" ")' "TESTPART_SPI TESTPART_I2C TESTPART_NONE"
	run aa update testpart_ip comm_init --suggest
	assert_success
	assert_output "spi_dev
i2c_dev"
	assert_unchanged
}

# bats test_tags=req:UPDATE-05
@test "update --quiet without a value prints only the value" {
	run aa update --quiet testpart_spi_dev max_speed_hz
	assert_success
	assert_output 1000000
}

# bats test_tags=req:UPDATE-06
@test "update takes a union as member,value or as two arguments" {
	aa update testpart_ip comm_init spi_dev testpart_spi_dev >/dev/null
	[ "$(stored '.symbols.testpart_ip.comm_init')" = '{"spi_dev":"testpart_spi_dev"}' ]
	run_json read testpart_ip comm_init
	assert_json '.source' user
	assert_json '.value | join(",")' spi_dev,testpart_spi_dev
	run aa update testpart_ip comm_init spi_dev,testpart_spi_dev
	assert_success
	assert_output --partial "Set testpart_ip.comm_init = spi_dev = testpart_spi_dev"
	[ "$(stored '.symbols.testpart_ip.comm_init')" = '{"spi_dev":"testpart_spi_dev"}' ]
}

# bats test_tags=req:UPDATE-06
@test "update takes a union member alone, with no value yet" {
	run aa update testpart_ip comm_init i2c_dev
	assert_success
	[ "$(stored '.symbols.testpart_ip.comm_init')" = '{"i2c_dev":null}' ]
	run_json read testpart_ip comm_init
	assert_json '.value[0]' i2c_dev
	run aa validate
	assert_success
}

# bats test_tags=req:UPDATE-06
@test "update takes an array as a comma-separated list" {
	aa add test_array_holder --name holder >/dev/null
	run aa update holder modes TEST_SPI_MODE_3,TEST_SPI_MODE_0
	assert_success
	[ "$(stored '.symbols.holder.modes')" = '["TEST_SPI_MODE_3","TEST_SPI_MODE_0"]' ]
}

# bats test_tags=req:UPDATE-06
@test "update takes a reference as the name of another device" {
	aa add test_gpio_pin --name pin2 >/dev/null
	run aa update testpart_spi_dev cs_gpio pin2
	assert_success
	[ "$(stored '.symbols.testpart_spi_dev.cs_gpio')" = '"pin2"' ]
	run_json read testpart_spi_dev cs_gpio
	assert_json '.value' pin2
}

# bats test_tags=req:UPDATE-06
@test "update finds a \$ property given without its \$" {
	run_json update testpart init_param testpart_cfg
	assert_success
	assert_json '.message' 'Set testpart.$init_param = testpart_cfg'
	run_json read testpart '$init_param'
	assert_json '.value' testpart_cfg
	assert_json '.source' user
}

# bats test_tags=req:UPDATE-10
@test "update fills again what the change leaves no choice for, and reports it" {
	run aa update testpart_ip comm_type TESTPART_I2C
	assert_success
	assert_line --regexp '^  \+ testpart_i2c_dev +\(test_i2c_device\) for testpart_ip.comm_init.i2c_dev$'
	assert_line --regexp '^  = testpart_i2c_dev.address +0x1D \(default\)$'
	[ "$(stored '.symbols.testpart_ip.comm_init')" = '{"i2c_dev":"testpart_i2c_dev"}' ]
	[ "$(stored '.symbols.testpart_i2c_dev.address')" = 29 ]
	# What the change left unused is gone.
	[ "$(stored '.symbols | has("testpart_spi_dev")')" = false ]
}

# bats test_tags=req:UPDATE-10
@test "update of a reference fills the value that follows from it" {
	aa delete testpart_spi_dev cs_gpio >/dev/null
	[ "$(stored '.symbols.testpart_spi_dev | has("cs_gpio_num")')" = false ]
	run aa update testpart_spi_dev cs_gpio testpart_cs_gpio
	assert_success
	assert_line --regexp '^  = testpart_spi_dev.cs_gpio_num +1 \(only value\)$'
	[ "$(stored '.symbols.testpart_spi_dev.cs_gpio_num')" = 1 ]
}
