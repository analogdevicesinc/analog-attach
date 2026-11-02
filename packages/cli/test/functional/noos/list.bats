# list where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet.
setup() {
	load ../helpers
	new_project noos
}

# Description: list devices lists every schema the project can add (eval boards, drivers and
# schemas), each with a key and a group tag.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices, with --json.
#   3. Check it succeeds and lists 26 schemas, with a message giving that count.
#   4. Check the list holds eval-testpart, testpart and test_gpio_pin.
#   5. Check every entry has a key and a tag, both strings.
# bats test_tags=req:LIST-01, id:N0166
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

# Description: one key of each group list devices gives is accepted by add.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices, with --json, and take the first key of each tag.
#   3. Check there is at least one key.
#   4. For each key, run add <key>, with --json, and check it is accepted and reports that key.
# bats test_tags=req:LIST-01, id:N0167
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

# Description: list devices refuses to run without a workfile, and says how to create one.
# Steps:
#   1. Run list devices, with --json, before any init.
#   2. Check it is refused (.ok false).
#   3. Check the message says there is no workfile and points to init or the workfile setting.
# bats test_tags=req:LIST-01, id:N0168
@test "list devices before init points to init" {
	run_json list devices
	assert_json '.ok' false
	assert_json '.message' "No workfile at '$PROJECT/workfile.json'. Create one with 'analog-attach init', or point the 'workfile' setting elsewhere."
}

# Description: list devices in human mode lists the keys and ends with the add command to use.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices.
#   3. Check it succeeds and lists eval-testpart and test_gpio_pin.
#   4. Check it shows how to use add <key> [--name <node name>].
# bats test_tags=req:LIST-01, id:N0169
@test "list devices in human mode ends with how to add one" {
	aa init >/dev/null
	run aa list devices
	assert_success
	assert_line '    eval-testpart'
	assert_line '    test_gpio_pin'
	assert_line 'Use: analog-attach add <key> [--name <node name>]'
}

# Description: list devices with a filter keeps only the keys that contain the filter text.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices gpio, with --json.
#   3. Check it succeeds and lists the four keys containing gpio, in order.
#   4. Check the message counts 4 schemas.
# bats test_tags=req:LIST-02, id:N0170
@test "list devices with a filter keeps the keys that contain it" {
	aa init >/dev/null
	run_json list devices gpio
	assert_success
	assert_json '[.devices[].key] | join(",")' 'test_gpio_pin,test_gpio_port,test_gpio_port_config,bsp_other_gpio1_cfg'
	assert_json '.message' '4 schemas available'
}

# Description: a filter that matches no key gives an empty list, not a refusal.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices zzznothing, with --json.
#   3. Check it succeeds (.ok true) with no devices.
# bats test_tags=req:LIST-02, id:N0171
@test "list devices with a filter that matches nothing is no refusal" {
	aa init >/dev/null
	run_json list devices zzznothing
	assert_success
	assert_json '.ok' true
	assert_json '.devices | length' 0
}

# Description: list devices gives eval boards first, then drivers, then the types of each module,
# each group in one block.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices, with --json.
#   3. Check the first entry is eval-testpart (eval boards) and the second testpart (drivers).
#   4. Check the tags come in blocks: eval boards, drivers, capi-test, platform-test, testpart,
#      otherboard.
#   5. Check the testpart group holds its three types.
# bats test_tags=req:LIST-04-CAPI, id:N0172
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

# Description: list devices in human mode writes a heading for each group.
# Steps:
#   1. Create the workfile with init.
#   2. Run list devices.
#   3. Check it shows the eval boards and drivers headings, with how each is added, and the
#      capi-test and otherboard headings.
# bats test_tags=req:LIST-04-CAPI, id:N0173
@test "list devices in human mode labels each group" {
	aa init >/dev/null
	run aa list devices
	assert_line '  eval boards (the part on it, wired: add by name):'
	assert_line '  drivers (a bare part, wired by hand: add by name):'
	assert_line '  capi-test:'
	assert_line '  otherboard:'
}

# Description: list context lists the chips, each with the boards that carry it, and the boards
# with their chip.
# Steps:
#   1. Run list context, with --json.
#   2. Check it succeeds, with a message counting 3 boards on 3 chips.
#   3. Check the chips are boardless, othersoc and testsoc.
#   4. Check othersoc carries otherboard and twobusboard, testsoc carries testboard, and
#      boardless no board.
#   5. Check each board names its chip.
# bats test_tags=req:LIST-05, req:LIST-05-CAPI, id:N0174
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

# Description: every board and chip list context names is accepted as the target, and init
# works with it.
# Steps:
#   1. Run list context, with --json, and take the names of the boards and chips.
#   2. For each name, run config target <name> and check it succeeds.
#   3. Remove the workfile, run init with --json, and check it is accepted.
# bats test_tags=req:LIST-05-CAPI, id:N0175
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

# Description: list context runs without a workfile, and does not create one.
# Steps:
#   1. Run list context, before any init.
#   2. Check it succeeds and shows othersoc with its vendor and otherboard under it.
#   3. Check it says how to target a chip with no board (config target boardless).
#   4. Check there is still no workfile.
# bats test_tags=req:LIST-05, id:N0176
@test "list context needs no workfile" {
	run aa list context
	assert_success
	assert_line '  othersoc (testvendor)'
	assert_line '      otherboard'
	assert_line "      no board: target the chip with 'analog-attach config target boardless'"
	[ ! -e "$PROJECT/workfile.json" ]
}

# Description: list context in human mode ends with how to select a target.
# Steps:
#   1. Run list context.
#   2. Check it succeeds and counts 3 boards on 3 chips.
#   3. Check it shows the use of config target <board>, then init.
# bats test_tags=req:LIST-06, id:N0177
@test "list context says how to select a target" {
	run aa list context
	assert_success
	assert_line '3 boards on 3 chips.'
	assert_line 'Use: analog-attach config target <board>, then analog-attach init'
}

# Description: list property with no node lists the devices of the workfile, each with its schema.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list property, with --json.
#   3. Check it succeeds and names the six nodes of the board, in order.
#   4. Check testpart_spi_dev is shown with its schema, test_spi_device.
# bats test_tags=req:LIST-07, id:N0178
@test "list property with no node lists the workfile's devices" {
	with_sensor
	run_json list property
	assert_success
	assert_json '.names | join(",")' 'testpart,testpart_cfg,testpart_ip,eval_testpart,testpart_spi_dev,testpart_cs_gpio'
	assert_json '.suggestions[] | select(.value == "testpart_spi_dev") | .display_string' 'test_spi_device'
}

# Description: list property of a node gives each property with its type, and whether it is
# required and set.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list property testpart_spi_dev, with --json.
#   3. Check it succeeds and shows controller as include, required and set, mode as a set enum,
#      and native_cs as a number.
#   4. Check max_speed_hz is among the names.
# bats test_tags=req:LIST-07, id:N0179
@test "list property of a node gives each property with its type, required and set" {
	with_sensor
	run_json list property testpart_spi_dev
	assert_success
	assert_json '.suggestions[] | select(.value == "controller") | .display_string' 'include (required, set)'
	assert_json '.suggestions[] | select(.value == "mode") | .display_string' 'enum (set)'
	assert_json '.suggestions[] | select(.value == "native_cs") | .display_string' 'number'
	assert_json '.names | index("max_speed_hz") != null' true
}

# Description: list property marks a required property that has no value as required, not set.
# Steps:
#   1. Create the workfile with init.
#   2. Add test_gpio_pin --name pin.
#   3. Run list property pin, with --json.
#   4. Check it succeeds and shows number as required, without set.
# bats test_tags=req:LIST-07, id:N0180
@test "list property shows a required property that is not set" {
	aa init >/dev/null
	aa add test_gpio_pin --name pin >/dev/null
	run_json list property pin
	assert_success
	assert_json '.suggestions[] | select(.value == "number") | .display_string' 'number (required)'
}

# Description: list property in human mode writes each property's name, type and marks in columns.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list property testpart_spi_dev.
#   3. Check it succeeds, with a line for controller (include, required, set) and one for
#      native_cs (number, no marks).
# bats test_tags=req:LIST-07, id:N0181
@test "list property in human mode writes name, type and marks in columns" {
	with_sensor
	run aa list property testpart_spi_dev
	assert_success
	assert_line --regexp '^controller +include +required, set$'
	assert_line --regexp '^native_cs +number *$'
}

# Description: list value of an enum property gives the enum's options.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list value testpart_spi_dev mode, with --json.
#   3. Check it succeeds and gives TEST_SPI_MODE_0.
# bats test_tags=req:LIST-08, id:N0182
@test "list value gives the options of an enum" {
	with_sensor
	run_json list value testpart_spi_dev mode
	assert_success
	assert_json '[.suggestions[].value] | join(",")' 'TEST_SPI_MODE_0'
}

# Description: list value of a reference gives the nodes it can point to, and the schema it can
# create.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list value testpart_spi_dev cs_gpio, with --json.
#   3. Check it succeeds and the first value is the node testpart_cs_gpio.
#   4. Check test_gpio_pin is offered as one it can create.
# bats test_tags=req:LIST-08, id:N0183
@test "list value gives the nodes a reference can take and the schema it can create" {
	with_sensor
	run_json list value testpart_spi_dev cs_gpio
	assert_success
	assert_json '.suggestions[0].value' 'testpart_cs_gpio'
	assert_json '.suggestions[] | select(.value == "test_gpio_pin") | .display_string' 'test_gpio_pin (can create)'
}

# Description: list value in human mode lists the schemas that can be created under their own
# heading.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list value testpart_spi_dev cs_gpio.
#   3. Check it succeeds and lists testpart_cs_gpio, then test_gpio_pin under a Can create heading.
# bats test_tags=req:LIST-08, id:N0184
@test "list value in human mode lists what can be created apart" {
	with_sensor
	run aa list value testpart_spi_dev cs_gpio
	assert_success
	assert_line 'testpart_cs_gpio'
	assert_line 'Can create:'
	assert_line '  test_gpio_pin'
}

# Description: list value refuses a property the node does not have.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list value testpart_spi_dev nosuch, with --json.
#   3. Check it is refused (.ok false) with a message saying the node has no such property.
# bats test_tags=req:LIST-08, id:N0185
@test "list value refuses a property the node does not have" {
	with_sensor
	run_json list value testpart_spi_dev nosuch
	assert_json '.ok' false
	assert_json '.message' "'testpart_spi_dev' has no property 'nosuch'"
}

# Description: list value of a union property, with no member given, lists the union's members.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list value testpart_ip comm_init, with --json.
#   3. Check it succeeds and lists spi_dev and i2c_dev.
# bats test_tags=req:LIST-08-CAPI, id:N0186
@test "list value of a union with no member lists its members" {
	with_sensor
	run_json list value testpart_ip comm_init
	assert_success
	assert_json '[.suggestions[].value] | join(",")' 'spi_dev,i2c_dev'
}

# Description: list value of a union property with a member given lists the values of that member.
# Steps:
#   1. Create a workfile with the eval-testpart board added.
#   2. Run list value testpart_ip comm_init spi_dev, with --json.
#   3. Check it succeeds, the first value is testpart_spi_dev, and test_spi_device is offered
#      as one it can create.
#   4. Run list value testpart_ip comm_init i2c_dev, with --json.
#   5. Check it succeeds and gives test_i2c_device only.
# bats test_tags=req:LIST-08-CAPI, id:N0187
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

# Description: list refuses an unknown kind, and names the kinds it takes.
# Steps:
#   1. Create the workfile with init.
#   2. Run list nosuch.
#   3. Check it fails (non-zero exit).
#   4. Check the output names nosuch and the kinds devices, context, property and value.
# bats test_tags=req:LIST-11, id:N0188
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
