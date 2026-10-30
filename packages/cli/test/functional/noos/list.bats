# list where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# bats test_tags=req:LIST-01
@test "list devices lists the eval boards, drivers and schemas, each with its key" {
	aa init >/dev/null
	run_json list devices
	assert_success
	assert_json '.ok' true
	assert_json '.devices | length' 26
	assert_json '.message' '26 schemas available'
	assert_json '[.devices[] | select(.key == "eval-testpart" or .key == "testpart" or .key == "test_gpio_pin")] | length' 3
	assert_json 'all(.devices[]; (.key | type) == "string" and (.tag | type) == "string")' true
}

# bats test_tags=req:LIST-01
@test "every kind of key list devices gives is one add takes" {
	aa init >/dev/null
	run_json list devices
	local keys
	keys=$(jq -r '[.devices | group_by(.tag)[] | .[0].key] | .[]' <<<"$output")
	[ -n "$keys" ]
	local key
	for key in $keys; do
		run_json add "$key"
		assert_json '.ok' true
		assert_json '.key' "$key"
	done
}

# bats test_tags=req:LIST-01
@test "list devices before init points to init" {
	run_json list devices
	assert_json '.ok' false
	assert_json '.message' "No workfile at '$PROJECT/workfile.json'. Create one with 'analog-attach init', or point the 'workfile' setting elsewhere."
}

# bats test_tags=req:LIST-01
@test "list devices in human mode ends with how to add one" {
	aa init >/dev/null
	run aa list devices
	assert_success
	assert_line '    eval-testpart'
	assert_line '    test_gpio_pin'
	assert_line 'Use: analog-attach add <key> [--name <node name>]'
}

# bats test_tags=req:LIST-02
@test "list devices with a filter keeps the keys that contain it" {
	aa init >/dev/null
	run_json list devices gpio
	assert_success
	assert_json '[.devices[].key] | join(",")' 'test_gpio_pin,test_gpio_port,test_gpio_port_config,bsp_other_gpio1_cfg'
	assert_json '.message' '4 schemas available'
}

# bats test_tags=req:LIST-02
@test "list devices with a filter that matches nothing is no refusal" {
	aa init >/dev/null
	run_json list devices zzznothing
	assert_success
	assert_json '.ok' true
	assert_json '.devices | length' 0
}

# bats test_tags=req:LIST-04-CAPI
@test "list devices groups eval boards, then drivers, then each module's types" {
	aa init >/dev/null
	run_json list devices
	assert_json '.devices[0].tag + ":" + .devices[0].key' 'eval boards:eval-testpart'
	assert_json '.devices[1].tag + ":" + .devices[1].key' 'drivers:testpart'
	# the tags in the order given, each appearing as one block
	assert_json '[.devices[].tag] | reduce .[] as $t ([]; if .[-1] == $t then . else . + [$t] end) | join(",")' \
		'eval boards,drivers,capi-test,platform-test,testpart,otherboard'
	assert_json '[.devices[] | select(.tag == "testpart") | .key] | join(",")' 'testpart_iio_init_param,testpart_init_param,testpart_ops'
}

# bats test_tags=req:LIST-04-CAPI
@test "list devices in human mode labels each group" {
	aa init >/dev/null
	run aa list devices
	assert_line '  eval boards (the part on it, wired: add by name):'
	assert_line '  drivers (a bare part, wired by hand: add by name):'
	assert_line '  capi-test:'
	assert_line '  otherboard:'
}

# bats test_tags=req:LIST-05, req:LIST-05-CAPI
@test "list context lists the chips, each with the boards that carry it" {
	run_json list context
	assert_success
	assert_json '.ok' true
	assert_json '.message' '3 boards on 3 chips'
	assert_json '[.platforms[].name] | join(",")' 'boardless,othersoc,testsoc'
	assert_json '.platforms[] | select(.name == "othersoc") | .boards | join(",")' 'otherboard,twobusboard'
	assert_json '.platforms[] | select(.name == "testsoc") | .boards | join(",")' 'testboard'
	assert_json '.platforms[] | select(.name == "boardless") | .boards | length' 0
	assert_json '[.boards[] | .name + "@" + .platform] | join(",")' 'testboard@testsoc,otherboard@othersoc,twobusboard@othersoc'
}

# bats test_tags=req:LIST-05-CAPI
@test "every target list context names is one the target setting takes" {
	run_json list context
	local names name
	names=$(jq -r '(.boards[].name), (.platforms[].name)' <<<"$output")
	for name in $names; do
		run aa config target "$name"
		assert_success
		rm -f "$PROJECT/workfile.json"
		run_json init
		assert_json '.ok' true
	done
}

# bats test_tags=req:LIST-05
@test "list context needs no workfile" {
	run aa list context
	assert_success
	assert_line '  othersoc (testvendor)'
	assert_line '      otherboard'
	assert_line "      no board: target the chip with 'analog-attach config target boardless'"
	[ ! -e "$PROJECT/workfile.json" ]
}

# bats test_tags=req:LIST-06
@test "list context says how to select a target" {
	run aa list context
	assert_success
	assert_line '3 boards on 3 chips.'
	assert_line 'Use: analog-attach config target <board>, then analog-attach init'
}

# bats test_tags=req:LIST-07
@test "list property with no node lists the workfile's devices" {
	with_sensor
	run_json list property
	assert_success
	assert_json '.names | join(",")' 'testpart,testpart_cfg,testpart_ip,eval_testpart,testpart_spi_dev,testpart_cs_gpio'
	assert_json '.suggestions[] | select(.value == "testpart_spi_dev") | .display_string' 'test_spi_device'
}

# bats test_tags=req:LIST-07
@test "list property of a node gives each property with its type, required and set" {
	with_sensor
	run_json list property testpart_spi_dev
	assert_success
	assert_json '.suggestions[] | select(.value == "controller") | .display_string' 'include (required, set)'
	assert_json '.suggestions[] | select(.value == "mode") | .display_string' 'enum (set)'
	assert_json '.suggestions[] | select(.value == "native_cs") | .display_string' 'number'
	assert_json '.names | index("max_speed_hz") != null' true
}

# bats test_tags=req:LIST-07
@test "list property shows a required property that is not set" {
	aa init >/dev/null
	aa add test_gpio_pin --name pin >/dev/null
	run_json list property pin
	assert_success
	assert_json '.suggestions[] | select(.value == "number") | .display_string' 'number (required)'
}

# bats test_tags=req:LIST-07
@test "list property in human mode writes name, type and marks in columns" {
	with_sensor
	run aa list property testpart_spi_dev
	assert_success
	assert_line --regexp '^controller +include +required, set$'
	assert_line --regexp '^native_cs +number *$'
}

# bats test_tags=req:LIST-08
@test "list value gives the options of an enum" {
	with_sensor
	run_json list value testpart_spi_dev mode
	assert_success
	assert_json '[.suggestions[].value] | join(",")' 'TEST_SPI_MODE_0'
}

# bats test_tags=req:LIST-08
@test "list value gives the nodes a reference can take and the schema it can create" {
	with_sensor
	run_json list value testpart_spi_dev cs_gpio
	assert_success
	assert_json '.suggestions[0].value' 'testpart_cs_gpio'
	assert_json '.suggestions[] | select(.value == "test_gpio_pin") | .display_string' 'test_gpio_pin (can create)'
}

# bats test_tags=req:LIST-08
@test "list value in human mode lists what can be created apart" {
	with_sensor
	run aa list value testpart_spi_dev cs_gpio
	assert_success
	assert_line 'testpart_cs_gpio'
	assert_line 'Can create:'
	assert_line '  test_gpio_pin'
}

# bats test_tags=req:LIST-08
@test "list value refuses a property the node does not have" {
	with_sensor
	run_json list value testpart_spi_dev nosuch
	assert_json '.ok' false
	assert_json '.message' "'testpart_spi_dev' has no property 'nosuch'"
}

# bats test_tags=req:LIST-08-CAPI
@test "list value of a union with no member lists its members" {
	with_sensor
	run_json list value testpart_ip comm_init
	assert_success
	assert_json '[.suggestions[].value] | join(",")' 'spi_dev,i2c_dev'
}

# bats test_tags=req:LIST-08-CAPI
@test "list value of a union member lists that member's values" {
	with_sensor
	run_json list value testpart_ip comm_init spi_dev
	assert_success
	assert_json '.suggestions[0].value' 'testpart_spi_dev'
	assert_json '.suggestions[] | select(.value == "test_spi_device") | .display_string' 'test_spi_device (can create)'
	run_json list value testpart_ip comm_init i2c_dev
	assert_success
	assert_json '[.suggestions[].value] | join(",")' 'test_i2c_device'
}

# bats test_tags=req:LIST-11
@test "an unknown list kind is refused, naming the kinds" {
	aa init >/dev/null
	run aa list nosuch
	assert_failure
	assert_output --partial 'nosuch'
	assert_output --partial 'devices'
	assert_output --partial 'context'
	assert_output --partial 'property'
	assert_output --partial 'value'
}
