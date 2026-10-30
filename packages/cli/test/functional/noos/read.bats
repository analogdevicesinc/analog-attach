# read where the backend is noos: the workfile, a node, a property.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# bats test_tags=req:READ-01
@test "read with no arguments shows the whole workfile" {
	run_json read
	assert_success
	assert_json '.kind' node
	assert_json '.key' workfile
	assert_json '[.properties[] | "\(.key)=\(.value)"] | join(" ")' "platform=othersoc board=otherboard"
	assert_json '[.children[].key] | join(" ")' \
		"testpart testpart_cfg testpart_ip eval_testpart testpart_spi_dev testpart_cs_gpio"
	# A stored node comes with its properties.
	assert_json '.children[] | select(.key == "testpart_cs_gpio") | .properties[] | select(.key == "number") | .value' 4
}

# bats test_tags=req:READ-01
@test "read with no arguments lists every node in text" {
	run aa read
	assert_success
	assert_line "Platform: othersoc"
	assert_line "Board:    otherboard"
	local node
	for node in testpart testpart_cfg testpart_ip eval_testpart testpart_spi_dev testpart_cs_gpio; do
		assert_line --regexp "^  $node +"
	done
}

# bats test_tags=req:READ-02
@test "read <node> shows the node with its properties" {
	run_json read testpart_spi_dev
	assert_success
	assert_json '.kind' node
	assert_json '.key' testpart_spi_dev
	assert_json '[.properties[].key] | join(" ")' \
		'$compatible controller max_speed_hz mode native_cs cs_gpio cs_gpio_num'
	assert_json '.properties[] | select(.key == "$compatible") | .value' test_spi_device
	assert_json '.properties[] | select(.key == "max_speed_hz") | .value' 1000000
	assert_json '.properties[] | select(.key == "native_cs") | .value' null
}

# bats test_tags=req:READ-02
@test "read <node> shows a required property the node still lacks" {
	aa delete testpart_spi_dev max_speed_hz >/dev/null
	run aa read testpart_spi_dev
	assert_success
	# `* ` marks a required property, `-` that it has no value.
	assert_line --regexp '^\* max_speed_hz +number +- '
	assert_line --partial "* = required"
}

# bats test_tags=req:READ-03
@test "read <node> <property> gives value, purpose, type, default, bounds and who set it" {
	run_json read testpart_spi_dev max_speed_hz
	assert_success
	assert_json '.kind' property
	assert_json '.key' max_speed_hz
	assert_json '.value' 1000000
	assert_json '.description' "Maximum transfer speed the device supports"
	assert_json '.type.kind' number
	assert_json '.definition' number
	assert_json '.required' true
	assert_json '.constraints.default' 1000000
	assert_json '.constraints.maximum' 10000000
	assert_json '.source' bootstrap
}

# bats test_tags=req:READ-03
@test "read <node> <property> gives the allowed values of an enum" {
	run_json read testpart_ip comm_type
	assert_success
	assert_json '.type.kind' enum
	assert_json '[.type.options[].value] | join(" ")' "TESTPART_SPI TESTPART_I2C TESTPART_NONE"
	assert_json '.constraints.default' TESTPART_SPI
}

# bats test_tags=req:READ-03
@test "read <node> <property> says when the user set the value" {
	aa update testpart_spi_dev max_speed_hz 2000000 >/dev/null
	run_json read testpart_spi_dev max_speed_hz
	assert_json '.value' 2000000
	assert_json '.source' user
	run aa read testpart_spi_dev max_speed_hz
	assert_success
	assert_line --regexp '^  Set by: +you$'
	assert_line --regexp '^  Description: +Maximum transfer speed the device supports$'
	assert_line --regexp '^  Default: +1000000$'
	assert_line --regexp '^  Type: +number$'
}

# bats test_tags=req:READ-03
@test "read <node> <property> says when the system set the value" {
	run aa read testpart_spi_dev max_speed_hz
	assert_success
	assert_line --regexp '^  Set by: +bootstrap '
}

# bats test_tags=req:READ-04
@test "read <node> <property> gives the suggested values and what can be created" {
	run_json read testpart init_param
	assert_success
	assert_json '.key' '$init_param'
	assert_json '[.suggestions.values[].value] | join(" ")' testpart_cfg
	assert_json '[.suggestions.can_create[].value] | join(" ")' test_sensor_config
	run aa read testpart init_param
	assert_success
	assert_line "  Suggestions:"
	assert_line --regexp '^ +• testpart_cfg$'
	assert_line "  Can create:"
	assert_line --regexp '^ +\+ test_sensor_config$'
}

# bats test_tags=req:READ-04
@test "read <node> <property> gives empty suggestions when there are none" {
	run_json read testpart_spi_dev native_cs
	assert_success
	assert_json '.suggestions.values | length' 0
	assert_json '.suggestions.can_create | length' 0
}

# bats test_tags=req:READ-05
@test "read --quiet <node> <property> prints the value alone" {
	run aa read --quiet testpart_spi_dev max_speed_hz
	assert_success
	assert_output 1000000
	run aa read --quiet testpart_spi_dev native_cs
	assert_success
	assert_output ""
}

# bats test_tags=req:READ-05
@test "read --quiet <node> prints property and value per line, no descriptions" {
	run aa read --quiet testpart_spi_dev
	assert_success
	assert_output "controller bsp_test_spi_cfg_handle
max_speed_hz 1000000
mode TEST_SPI_MODE_0
native_cs
cs_gpio testpart_cs_gpio
cs_gpio_num 1"
}

# bats test_tags=req:READ-05
@test "read --quiet with no node prints the node names" {
	run aa read --quiet
	assert_success
	assert_output "testpart
testpart_cfg
testpart_ip
eval_testpart
testpart_spi_dev
testpart_cs_gpio"
}

# bats test_tags=req:READ-05
@test "read --quiet leaves out suggestions" {
	run aa read --quiet testpart init_param
	assert_success
	assert_output testpart_cfg
}

# bats test_tags=req:READ-07
@test "read --json says a stored node is internal and lists its other names" {
	run_json read testpart_spi_dev
	assert_success
	assert_json '.origin' internal
	assert_json '.alias | type' array
	assert_json '.alias | length' 0
	run_json read
	assert_json '[.children[] | .origin] | unique | join(" ")' internal
	assert_json '[.children[] | (.alias | type)] | unique | join(" ")' array
}

# bats test_tags=req:READ-07
@test "read --json says a node from the target is external" {
	run_json read testpart_ops
	assert_success
	assert_json '.origin' external
	assert_json '.alias | type' array
	assert_json '.properties[] | select(.key == "$provides") | .value' test_sensor_ops
}
