# delete where the backend is noos: a property, a node, everything.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# bats test_tags=req:DELETE-01
@test "delete <node> <property> removes the property's value" {
	aa update testpart_spi_dev native_cs 3 >/dev/null
	run_json delete testpart_spi_dev native_cs
	assert_success
	assert_json '.message' "Reset testpart_spi_dev.native_cs"
	run_json read testpart_spi_dev native_cs
	assert_json '.value' null
	[ "$(stored '.symbols.testpart_spi_dev.native_cs // null')" = null ]
}

# bats test_tags=req:DELETE-01, req:DELETE-01-CAPI
@test "delete of a property with no default leaves it unset" {
	aa update testpart_spi_dev native_cs 3 >/dev/null
	run aa delete testpart_spi_dev native_cs
	assert_success
	run_json read testpart_spi_dev native_cs
	assert_json '.constraints.default // "none"' none
	assert_json '.value' null
}

# bats test_tags=req:DELETE-01-CAPI, gap
@test "delete of a property with a default puts the default back" {
	# Gap: max_speed_hz is cleared to null (marked cleared, "you cleared it"), not reset to its default 1000000.
	aa update testpart_spi_dev max_speed_hz 2000000 >/dev/null
	run aa delete testpart_spi_dev max_speed_hz
	assert_success
	run_json read testpart_spi_dev max_speed_hz
	assert_json '.constraints.default' 1000000
	assert_json '.value' 1000000
}

# bats test_tags=req:DELETE-02
@test "delete <node> removes a device nothing references" {
	aa add test_array_holder --name holder >/dev/null
	run_json delete holder
	assert_success
	assert_json '.message' "Deleted 'holder'"
	[ "$(stored '.symbols | has("holder")')" = false ]
}

# bats test_tags=req:DELETE-02
@test "delete <node> of a referenced device shows what would change and removes nothing" {
	snapshot
	run_json delete testpart_spi_dev
	assert_success
	assert_json '.severity' warn
	assert_json '.message' "'testpart_spi_dev' is referenced by 1 property; deleting it would clear that reference. Re-run with --force."
	assert_json '.paths | map(join(".")) | join(" ")' "testpart_spi_dev testpart_ip.comm_init"
	assert_unchanged
	run aa delete testpart_spi_dev
	assert_success
	assert_line "testpart_spi_dev: referenced by"
	assert_line "  testpart_ip.comm_init"
	assert_line "Nothing was changed. Re-run with --force to delete the node and clear those references."
	assert_unchanged
}

# bats test_tags=req:DELETE-02
@test "delete <node> --force removes a referenced device and clears the reference" {
	run_json delete testpart_spi_dev --force
	assert_success
	assert_json '.message' "Deleted 'testpart_spi_dev' and cleared 1 reference to it"
	[ "$(stored '.symbols | has("testpart_spi_dev")')" = false ]
	[ "$(stored '.symbols.testpart_ip.comm_init')" = null ]
}

# bats test_tags=req:DELETE-03
@test "delete with no arguments shows what would be removed and removes nothing" {
	snapshot
	run_json delete
	assert_success
	assert_json '.severity' warn
	assert_json '.message' "Deleting the root removes every node in the workfile (11 nodes). Re-run with --force."
	assert_json '.paths | map(.[0]) | .[:6] | join(" ")' \
		"testpart testpart_cfg testpart_ip eval_testpart testpart_spi_dev testpart_cs_gpio"
	assert_unchanged
	run aa delete
	assert_success
	assert_line "workfile: would delete 11 nodes"
	assert_line "  testpart_spi_dev"
	assert_line "Nothing was changed. Re-run with --force to delete them all."
	assert_unchanged
}

# bats test_tags=req:DELETE-03
@test "delete --force with no arguments removes every device" {
	run aa delete --force
	assert_success
	assert_output "Deleted 11 nodes"
	[ "$(stored '.symbols')" = '{}' ]
	run aa delete
	assert_output "Nothing to delete: the workfile has no nodes"
}

# bats test_tags=req:DELETE-05
@test "delete <node> --force does the same with and without --json" {
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/start.json"
	aa delete testpart_spi_dev --force >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/text.json"
	cp "$BATS_TEST_TMPDIR/start.json" "$PROJECT/workfile.json"
	run_json delete testpart_spi_dev --force
	assert_success
	assert_json '.ok' true
	cmp -s "$BATS_TEST_TMPDIR/text.json" "$PROJECT/workfile.json" ||
		fail "text and JSON differ: $(diff "$BATS_TEST_TMPDIR/text.json" "$PROJECT/workfile.json")"
}

# bats test_tags=req:DELETE-05
@test "delete --force with no arguments does the same with and without --json" {
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/start.json"
	run aa delete --force
	local text_answer=$output
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/text.json"
	cp "$BATS_TEST_TMPDIR/start.json" "$PROJECT/workfile.json"
	run_json delete --force
	assert_success
	assert_json '.message' "$text_answer"
	cmp -s "$BATS_TEST_TMPDIR/text.json" "$PROJECT/workfile.json" ||
		fail "text and JSON differ: $(diff "$BATS_TEST_TMPDIR/text.json" "$PROJECT/workfile.json")"
}

# bats test_tags=req:DELETE-06
@test "delete fills again the values that now leave no choice" {
	# A workfile edited by hand: testpart_spi_dev.mode unset, though it has one value only.
	jq 'del(.symbols.testpart_spi_dev.mode) | .symbols.testpart_spi_dev["$auto"] -= ["mode"]' \
		"$PROJECT/workfile.json" >"$BATS_TEST_TMPDIR/w.json"
	mv "$BATS_TEST_TMPDIR/w.json" "$PROJECT/workfile.json"
	run aa delete testpart_spi_dev native_cs
	assert_success
	assert_line --regexp '^  = testpart_spi_dev.mode +TEST_SPI_MODE_0 \(only value\)$'
	[ "$(stored '.symbols.testpart_spi_dev.mode')" = '"TEST_SPI_MODE_0"' ]
}

# bats test_tags=req:DELETE-06
@test "delete reports what is left to set and drops what no longer applies" {
	run aa delete testpart_cs_gpio --force
	assert_success
	assert_line "Deleted 'testpart_cs_gpio' and cleared 1 reference to it"
	assert_line --regexp '^  - testpart_spi_dev.cs_gpio_num +1 \(no longer applies, removed\)$'
	assert_line "Still yours to set - required, and nothing to fill them from:"
	assert_line --regexp '^  ! testpart_spi_dev.cs_gpio +include '
	[ "$(stored '.symbols.testpart_spi_dev | has("cs_gpio_num")')" = false ]
}
