# rename where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, and a
# workfile with the eval-testpart board added (with_sensor), wired and valid.
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# Description: rename gives a node a new name, keeping its schema and values.
# Steps:
#   1. Rename testpart_spi_dev to my_spi, with --json.
#   2. Check it succeeds, saying it renamed the node.
#   3. Check the workfile has no testpart_spi_dev, and my_spi has the test_spi_device schema.
#   4. Read my_spi max_speed_hz, with --json, and check it is still 1000000.
# bats test_tags=req:RENAME-01, id:N0205
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

# Description: rename refuses a new name that isn't a valid C identifier, changing nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename testpart_spi_dev to 1bad, with --json, and check it is refused as not a valid C name.
#   3. Rename testpart_spi_dev to my-spi, with --json, and check it is refused the same way.
#   4. Check the workfile didn't change.
# bats test_tags=req:RENAME-01, id:N0206
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

# Description: rename refuses a new name already taken, by a node of the workfile or of the
# target, changing nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename testpart_spi_dev to testpart_ip, with --json, and check it is refused as existing.
#   3. Rename testpart_spi_dev to testpart_ops (a node of the target), with --json, and check it
#      is refused as existing.
#   4. Check the workfile didn't change.
# bats test_tags=req:RENAME-01, id:N0207
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

# Description: rename refuses a node that doesn't exist, changing nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Rename nosuch to foo, with --json.
#   3. Check it is refused (.ok false), saying nosuch is not found.
#   4. Check the workfile didn't change.
# bats test_tags=req:RENAME-01, id:N0208
@test "rename refuses a device that does not exist" {
	snapshot
	run_json rename nosuch foo
	assert_json '.ok' false
	assert_json '.message' "Symbol 'nosuch' not found"
	assert_unchanged
}

# Description: rename updates every reference to the renamed node, and the workfile stays valid.
# Steps:
#   1. Rename testpart_spi_dev to my_spi, and check testpart_ip.comm_init now names my_spi.
#   2. Rename testpart_cs_gpio to cs_pin, and check my_spi.cs_gpio now names cs_pin.
#   3. Rename testpart_cfg to cfg, and check testpart's init param now names cfg.
#   4. Check the workfile no longer mentions any of the old names.
#   5. Validate, with --json, and check it succeeds with no errors.
# bats test_tags=req:RENAME-02, id:N0209
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
