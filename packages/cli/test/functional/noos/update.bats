# update where the backend is noos: set, refuse, show, suggest.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, with a
# workfile holding the eval-testpart board (testpart, testpart_cfg, testpart_ip, eval_testpart,
# testpart_spi_dev, testpart_cs_gpio), wired and valid.
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# Description: update sets a property to the value given, and read then shows it as set by the
# user.
# Steps:
#   1. Run update testpart_spi_dev max_speed_hz 2000000, with --json.
#   2. Check it succeeds and the message says the property was set to 2000000.
#   3. Check the workfile stores 2000000.
#   4. Check read testpart_spi_dev max_speed_hz, with --json, gives 2000000 from the user.
# bats test_tags=req:UPDATE-01, id:N0249
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

# Description: update takes the value of an array given as two arguments.
# Steps:
#   1. Add test_array_holder --name holder.
#   2. Run update holder modes TEST_SPI_MODE_0 TEST_SPI_MODE_3.
#   3. Check it succeeds and the workfile stores both modes, in order.
# bats test_tags=req:UPDATE-01, id:N0250
@test "update takes a value spread over two arguments" {
	aa add test_array_holder --name holder >/dev/null
	run aa update holder modes TEST_SPI_MODE_0 TEST_SPI_MODE_3
	assert_success
	[ "$(stored '.symbols.holder.modes')" = '["TEST_SPI_MODE_0","TEST_SPI_MODE_3"]' ]
}

# Description: update takes an array as one comma-separated argument, and refuses three value
# arguments.
# Steps:
#   1. Add test_array_holder --name holder.
#   2. Run update holder modes TEST_SPI_MODE_0,TEST_SPI_MODE_3 and check both are stored.
#   3. Snapshot the workfile.
#   4. Run update holder modes with three separate values.
#   5. Check it fails with a usage error (exit 2), saying there are too many values.
#   6. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-01-CAPI, id:N0251
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

# Description: update refuses a value that is not a number for a number property.
# Steps:
#   1. Snapshot the workfile.
#   2. Run update testpart_spi_dev max_speed_hz banana.
#   3. Check it is refused (exit 0), saying banana is not a number.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0252
@test "update refuses a value that is not a number for a number" {
	snapshot
	run aa update testpart_spi_dev max_speed_hz banana
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'banana' is not a number"
	assert_unchanged
}

# Description: update refuses a value that is not one of an enum's options.
# Steps:
#   1. Snapshot the workfile.
#   2. Run update testpart_ip comm_type BOGUS.
#   3. Check it is refused (exit 0), naming the three options.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0253
@test "update refuses a value that is not one of an enum's options" {
	snapshot
	run aa update testpart_ip comm_type BOGUS
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'BOGUS' is not one of: TESTPART_SPI, TESTPART_I2C, TESTPART_NONE"
	assert_unchanged
}

# Description: update refuses a union member the union does not have.
# Steps:
#   1. Snapshot the workfile.
#   2. Run update testpart_ip comm_init foo,bar.
#   3. Check it is refused (exit 0), saying foo is no member and naming spi_dev and i2c_dev.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0254
@test "update refuses a union member the union does not have" {
	snapshot
	run aa update testpart_ip comm_init foo,bar
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'foo' is not a member of 'comm_init'. Available: spi_dev, i2c_dev"
	assert_unchanged
}

# Description: update refuses an array with more elements than its size.
# Steps:
#   1. Add test_array_holder --name holder.
#   2. Snapshot the workfile.
#   3. Run update holder modes with four elements.
#   4. Check it is refused (exit 0), saying modes holds at most 3 elements.
#   5. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0255
@test "update refuses an array longer than its size" {
	aa add test_array_holder --name holder >/dev/null
	snapshot
	run aa update holder modes TEST_SPI_MODE_0,TEST_SPI_MODE_0,TEST_SPI_MODE_0,TEST_SPI_MODE_0
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "'modes' holds at most 3 elements, got 4"
	assert_unchanged
}

# Description: update refuses a property the node's schema does not define, and names the ones
# it has.
# Steps:
#   1. Snapshot the workfile.
#   2. Run update testpart_ip nosuch 1, with --json.
#   3. Check it is refused (.ok false), saying the property does not exist, can't be added as
#      the schema fixes the properties, and naming the ones available.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0256
@test "update refuses a property the definition does not have" {
	snapshot
	run_json update testpart_ip nosuch 1
	assert_json '.ok' false
	assert_json '.message' "'testpart_ip' has no property 'nosuch', and one cannot be added: its properties are fixed by its schema (testpart_init_param). Available: comm_type, comm_init, dev_ready"
	assert_unchanged
}

# Description: update refuses a number above the property's maximum.
# Steps:
#   1. Snapshot the workfile.
#   2. Run update testpart_spi_dev max_speed_hz 20000000, with --json.
#   3. Check it is refused (exit 0, .ok false), the message giving the maximum, 10000000.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0257
@test "update refuses a number above the maximum" {
	snapshot
	run_json update testpart_spi_dev max_speed_hz 20000000
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("10000000")' true
	assert_unchanged
}

# Description: update refuses an array with an element that is not one of its enum's options.
# Steps:
#   1. Add test_array_holder --name holder.
#   2. Snapshot the workfile.
#   3. Run update holder modes BAD,TEST_SPI_MODE_0, with --json.
#   4. Check it is refused (exit 0, .ok false), the message naming BAD.
#   5. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:N0258
@test "update refuses an array element that is not one of its enum's options" {
	aa add test_array_holder --name holder >/dev/null
	snapshot
	run_json update holder modes BAD,TEST_SPI_MODE_0
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("'"'"'BAD'"'"'")' true
	assert_unchanged
}

# Description: update with no value shows the property as read does, and changes nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Run read testpart_ip comm_type, then update testpart_ip comm_type.
#   3. Check update succeeds with the same output as read.
#   4. Do the same with --json, and check the outputs are the same.
#   5. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-03, id:N0259
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

# Description: update --suggest lists the values a property can take, and sets nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Run update testpart_ip comm_type --suggest, with --json.
#   3. Check it succeeds and gives the three enum options.
#   4. Run update testpart_ip comm_init --suggest.
#   5. Check it succeeds and prints the members spi_dev and i2c_dev, one per line.
#   6. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-04, id:N0260
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

# Description: update --quiet with no value prints the value alone.
# Steps:
#   1. Run update --quiet testpart_spi_dev max_speed_hz.
#   2. Check it succeeds and prints only 1000000.
# bats test_tags=req:UPDATE-05, id:N0261
@test "update --quiet without a value prints only the value" {
	run aa update --quiet testpart_spi_dev max_speed_hz
	assert_success
	assert_output 1000000
}

# Description: update takes a union value as two arguments, member and value, or as one
# argument, member,value.
# Steps:
#   1. Run update testpart_ip comm_init spi_dev testpart_spi_dev.
#   2. Check the workfile stores spi_dev = testpart_spi_dev, and read, with --json, shows it set
#      by the user.
#   3. Run update testpart_ip comm_init spi_dev,testpart_spi_dev.
#   4. Check it succeeds, reports the value set, and the workfile stores the same.
# bats test_tags=req:UPDATE-06, id:N0262
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

# Description: update takes a union member with no value, and the workfile stays valid.
# Steps:
#   1. Run update testpart_ip comm_init i2c_dev.
#   2. Check it succeeds and the workfile stores i2c_dev with no value.
#   3. Check read testpart_ip comm_init, with --json, gives i2c_dev.
#   4. Run validate and check it succeeds.
# bats test_tags=req:UPDATE-06, id:N0263
@test "update takes a union member alone, with no value yet" {
	run aa update testpart_ip comm_init i2c_dev
	assert_success
	[ "$(stored '.symbols.testpart_ip.comm_init')" = '{"i2c_dev":null}' ]
	run_json read testpart_ip comm_init
	assert_json '.value[0]' i2c_dev
	run aa validate
	assert_success
}

# Description: update takes an array as a comma-separated list, kept in its order.
# Steps:
#   1. Add test_array_holder --name holder.
#   2. Run update holder modes TEST_SPI_MODE_3,TEST_SPI_MODE_0.
#   3. Check it succeeds and the workfile stores the two modes in that order.
# bats test_tags=req:UPDATE-06, id:N0264
@test "update takes an array as a comma-separated list" {
	aa add test_array_holder --name holder >/dev/null
	run aa update holder modes TEST_SPI_MODE_3,TEST_SPI_MODE_0
	assert_success
	[ "$(stored '.symbols.holder.modes')" = '["TEST_SPI_MODE_3","TEST_SPI_MODE_0"]' ]
}

# Description: update takes a reference as the name of another node.
# Steps:
#   1. Add test_gpio_pin --name pin2.
#   2. Run update testpart_spi_dev cs_gpio pin2.
#   3. Check it succeeds and the workfile stores pin2.
#   4. Check read testpart_spi_dev cs_gpio, with --json, gives pin2.
# bats test_tags=req:UPDATE-06, id:N0265
@test "update takes a reference as the name of another device" {
	aa add test_gpio_pin --name pin2 >/dev/null
	run aa update testpart_spi_dev cs_gpio pin2
	assert_success
	[ "$(stored '.symbols.testpart_spi_dev.cs_gpio')" = '"pin2"' ]
	run_json read testpart_spi_dev cs_gpio
	assert_json '.value' pin2
}

# Description: update finds a property whose name starts with $ when it is given without the $.
# Steps:
#   1. Run update testpart init_param testpart_cfg, with --json.
#   2. Check it succeeds and the message says testpart.$init_param was set.
#   3. Check read testpart '$init_param', with --json, gives testpart_cfg, set by the user.
# bats test_tags=req:UPDATE-06, id:N0266
@test "update finds a \$ property given without its \$" {
	run_json update testpart init_param testpart_cfg
	assert_success
	assert_json '.message' 'Set testpart.$init_param = testpart_cfg'
	run_json read testpart '$init_param'
	assert_json '.value' testpart_cfg
	assert_json '.source' user
}

# Description: after a change, update fills in again what then has only one choice, reports it,
# and removes what the change left unused.
# Steps:
#   1. Run update testpart_ip comm_type TESTPART_I2C.
#   2. Check it succeeds and reports a new testpart_i2c_dev node for comm_init.i2c_dev, and its
#      address set to its default, 0x1D.
#   3. Check the workfile stores comm_init as i2c_dev = testpart_i2c_dev, with address 29.
#   4. Check testpart_spi_dev is gone from the workfile.
# bats test_tags=req:UPDATE-10, id:N0267
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

# Description: setting a reference fills in the value that follows from it.
# Steps:
#   1. Delete testpart_spi_dev cs_gpio, and check cs_gpio_num is gone too.
#   2. Run update testpart_spi_dev cs_gpio testpart_cs_gpio.
#   3. Check it succeeds and reports cs_gpio_num set to 1, its only value.
#   4. Check the workfile stores cs_gpio_num 1.
# bats test_tags=req:UPDATE-10, id:N0268
@test "update of a reference fills the value that follows from it" {
	aa delete testpart_spi_dev cs_gpio >/dev/null
	[ "$(stored '.symbols.testpart_spi_dev | has("cs_gpio_num")')" = false ]
	run aa update testpart_spi_dev cs_gpio testpart_cs_gpio
	assert_success
	assert_line --regexp '^  = testpart_spi_dev.cs_gpio_num +1 \(only value\)$'
	[ "$(stored '.symbols.testpart_spi_dev.cs_gpio_num')" = 1 ]
}
