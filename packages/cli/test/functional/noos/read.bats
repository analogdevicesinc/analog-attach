# read where the backend is noos: the workfile, a node, a property.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, with a
# workfile holding the eval-testpart board (testpart, testpart_cfg, testpart_ip, eval_testpart,
# testpart_spi_dev, testpart_cs_gpio), wired and valid.
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# Description: read with no arguments gives the whole workfile: its platform and board, and every
# node with its properties.
# Steps:
#   1. Run read, with --json.
#   2. Check it succeeds and gives the workfile node, with platform othersoc and board
#      otherboard.
#   3. Check its children are the six nodes of the board, in order.
#   4. Check testpart_cs_gpio comes with its properties (number 4).
# bats test_tags=req:READ-01, id:N0189
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

# Description: read with no arguments, in text, shows the platform, the board and a line per node.
# Steps:
#   1. Run read.
#   2. Check it succeeds and shows platform othersoc and board otherboard.
#   3. Check there is a line for each of the six nodes.
# bats test_tags=req:READ-01, id:N0190
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

# Description: read of a node gives the node with its properties and their values.
# Steps:
#   1. Run read testpart_spi_dev, with --json.
#   2. Check it succeeds and gives the node testpart_spi_dev, with its seven properties in order.
#   3. Check $compatible is test_spi_device, max_speed_hz 1000000 and native_cs has no value.
# bats test_tags=req:READ-02, id:N0191
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

# Description: read of a node marks a required property that has no value.
# Steps:
#   1. Delete testpart_spi_dev max_speed_hz.
#   2. Run read testpart_spi_dev.
#   3. Check it succeeds and shows max_speed_hz marked required, with no value.
#   4. Check it explains the * mark as required.
# bats test_tags=req:READ-02, id:N0192
@test "read <node> shows a required property the node still lacks" {
	aa delete testpart_spi_dev max_speed_hz >/dev/null
	run aa read testpart_spi_dev
	assert_success
	# `* ` marks a required property, `-` that it has no value.
	assert_line --regexp '^\* max_speed_hz +number +- '
	assert_line --partial "* = required"
}

# Description: read of a property gives its value, description, type, default, bounds, whether
# it is required, and who set it.
# Steps:
#   1. Run read testpart_spi_dev max_speed_hz, with --json.
#   2. Check it succeeds and gives the property max_speed_hz with value 1000000.
#   3. Check the description, the type number, required, the default 1000000 and the maximum
#      10000000.
#   4. Check the value was set by bootstrap.
# bats test_tags=req:READ-03, id:N0193
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

# Description: read of an enum property gives its options and default.
# Steps:
#   1. Run read testpart_ip comm_type, with --json.
#   2. Check it succeeds, with type enum and the three options in order.
#   3. Check the default is TESTPART_SPI.
# bats test_tags=req:READ-03, id:N0194
@test "read <node> <property> gives the allowed values of an enum" {
	run_json read testpart_ip comm_type
	assert_success
	assert_json '.type.kind' enum
	assert_json '[.type.options[].value] | join(" ")' "TESTPART_SPI TESTPART_I2C TESTPART_NONE"
	assert_json '.constraints.default' TESTPART_SPI
}

# Description: read of a property the user set says so, in JSON and in text.
# Steps:
#   1. Run update testpart_spi_dev max_speed_hz 2000000.
#   2. Run read testpart_spi_dev max_speed_hz, with --json, and check value 2000000 from the user.
#   3. Run read testpart_spi_dev max_speed_hz.
#   4. Check it succeeds and shows it set by you, with its description, default and type.
# bats test_tags=req:READ-03, id:N0195
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

# Description: read of a property bootstrap set says so.
# Steps:
#   1. Run read testpart_spi_dev max_speed_hz.
#   2. Check it succeeds and shows it set by bootstrap.
# bats test_tags=req:READ-03, id:N0196
@test "read <node> <property> says when the system set the value" {
	run aa read testpart_spi_dev max_speed_hz
	assert_success
	assert_line --regexp '^  Set by: +bootstrap '
}

# Description: read of a reference property gives the nodes suggested for it and the schemas it
# can create.
# Steps:
#   1. Run read testpart init_param, with --json.
#   2. Check it succeeds and gives $init_param, suggesting testpart_cfg and able to create
#      test_sensor_config.
#   3. Run read testpart init_param.
#   4. Check it succeeds and lists testpart_cfg under Suggestions and test_sensor_config under
#      Can create.
# bats test_tags=req:READ-04, id:N0197
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

# Description: read of a property with nothing to suggest gives empty suggestion lists.
# Steps:
#   1. Run read testpart_spi_dev native_cs, with --json.
#   2. Check it succeeds with no suggested values and nothing to create.
# bats test_tags=req:READ-04, id:N0198
@test "read <node> <property> gives empty suggestions when there are none" {
	run_json read testpart_spi_dev native_cs
	assert_success
	assert_json '.suggestions.values | length' 0
	assert_json '.suggestions.can_create | length' 0
}

# Description: read --quiet of a property prints the value alone, and nothing when it has none.
# Steps:
#   1. Run read --quiet testpart_spi_dev max_speed_hz.
#   2. Check it succeeds and prints only 1000000.
#   3. Run read --quiet testpart_spi_dev native_cs.
#   4. Check it succeeds and prints nothing.
# bats test_tags=req:READ-05, id:N0199
@test "read --quiet <node> <property> prints the value alone" {
	run aa read --quiet testpart_spi_dev max_speed_hz
	assert_success
	assert_output 1000000
	run aa read --quiet testpart_spi_dev native_cs
	assert_success
	assert_output ""
}

# Description: read --quiet of a node prints a line per property, the name and the value, with
# nothing else.
# Steps:
#   1. Run read --quiet testpart_spi_dev.
#   2. Check it succeeds and prints exactly the six properties with their values, native_cs
#      with none.
# bats test_tags=req:READ-05, id:N0200
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

# Description: read --quiet with no node prints the names of the nodes, one per line.
# Steps:
#   1. Run read --quiet.
#   2. Check it succeeds and prints exactly the six node names, in order.
# bats test_tags=req:READ-05, id:N0201
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

# Description: read --quiet of a property with suggestions prints the value alone, not the
# suggestions.
# Steps:
#   1. Run read --quiet testpart init_param.
#   2. Check it succeeds and prints only testpart_cfg.
# bats test_tags=req:READ-05, id:N0202
@test "read --quiet leaves out suggestions" {
	run aa read --quiet testpart init_param
	assert_success
	assert_output testpart_cfg
}

# Description: read --json gives a node of the workfile as internal, with a list of its other
# names.
# Steps:
#   1. Run read testpart_spi_dev, with --json.
#   2. Check it succeeds, with origin internal and an empty alias list.
#   3. Run read, with --json.
#   4. Check every node is internal and each has an alias list.
# bats test_tags=req:READ-07, id:N0203
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

# Description: read --json gives a node of the target, not of the workfile, as external.
# Steps:
#   1. Run read testpart_ops, with --json.
#   2. Check it succeeds, with origin external and an alias list.
#   3. Check its $provides is test_sensor_ops.
# bats test_tags=req:READ-07, id:N0204
@test "read --json says a node from the target is external" {
	run_json read testpart_ops
	assert_success
	assert_json '.origin' external
	assert_json '.alias | type' array
	assert_json '.properties[] | select(.key == "$provides") | .value' test_sensor_ops
}
