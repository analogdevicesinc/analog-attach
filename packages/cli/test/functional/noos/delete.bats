# delete where the backend is noos: a property, a node, everything.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, and a
# workfile with the eval-testpart board added (with_sensor): 11 nodes, wired and valid.
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# Description: deleting a property removes its value.
# Steps:
#   1. Set testpart_spi_dev.native_cs to 3 with update.
#   2. Delete testpart_spi_dev native_cs, with --json.
#   3. Check it succeeds and says the property was reset.
#   4. Check read reports no value, and the workfile has no value for it.
# bats test_tags=req:DELETE-01, id:N0076
@test "delete <node> <property> removes the property's value" {
	aa update testpart_spi_dev native_cs 3 >/dev/null
	run_json delete testpart_spi_dev native_cs
	assert_success
	assert_json '.message' "Reset testpart_spi_dev.native_cs"
	run_json read testpart_spi_dev native_cs
	assert_json '.value' null
	[ "$(stored '.symbols.testpart_spi_dev.native_cs // null')" = null ]
}

# Description: deleting a property that has no default leaves it with no value.
# Steps:
#   1. Set testpart_spi_dev.native_cs to 3 with update.
#   2. Delete testpart_spi_dev native_cs.
#   3. Check it succeeds.
#   4. Check read, with --json, shows the property has no default and no value.
# bats test_tags=req:DELETE-01, req:DELETE-01-CAPI, id:N0077
@test "delete of a property with no default leaves it unset" {
	aa update testpart_spi_dev native_cs 3 >/dev/null
	run aa delete testpart_spi_dev native_cs
	assert_success
	run_json read testpart_spi_dev native_cs
	assert_json '.constraints.default // "none"' none
	assert_json '.value' null
}

# Description: deleting a property that has a default clears it rather than restoring the default,
# and a later edit doesn't fill it again.
# Steps:
#   1. Set testpart_spi_dev.max_speed_hz to 2000000 with update.
#   2. Delete testpart_spi_dev max_speed_hz, and check it succeeds.
#   3. Check read, with --json, shows the default 1000000, no value, and the user as source.
#   4. Update another node (testpart_ip comm_type TESTPART_SPI).
#   5. Check max_speed_hz is still empty in the workfile.
# bats test_tags=req:DELETE-01-CAPI, id:N0078
@test "delete of a property with a default clears it, and it stays empty" {
	aa update testpart_spi_dev max_speed_hz 2000000 >/dev/null
	run aa delete testpart_spi_dev max_speed_hz
	assert_success
	run_json read testpart_spi_dev max_speed_hz
	assert_json '.constraints.default' 1000000
	assert_json '.value' null
	assert_json '.source' user
	# Another edit runs bootstrap again: the cleared value stays empty.
	aa update testpart_ip comm_type TESTPART_SPI >/dev/null
	[ "$(stored '.symbols.testpart_spi_dev.max_speed_hz')" = null ]
}

# Description: deleting a node that nothing references removes it.
# Steps:
#   1. Add a test_array_holder node named holder.
#   2. Delete holder, with --json.
#   3. Check it succeeds and says holder was deleted.
#   4. Check the workfile no longer has holder.
# bats test_tags=req:DELETE-02, id:N0079
@test "delete <node> removes a device nothing references" {
	aa add test_array_holder --name holder >/dev/null
	run_json delete holder
	assert_success
	assert_json '.message' "Deleted 'holder'"
	[ "$(stored '.symbols | has("holder")')" = false ]
}

# Description: deleting a referenced node without --force only warns, listing the references it
# would clear, and changes nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete testpart_spi_dev, with --json.
#   3. Check it succeeds with a warning that names the reference (testpart_ip.comm_init) and
#      asks for --force.
#   4. Check the workfile didn't change.
#   5. Delete testpart_spi_dev again, without --json.
#   6. Check it lists the referencing property, says nothing was changed, and the workfile didn't
#      change.
# bats test_tags=req:DELETE-02, id:N0080
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

# Description: deleting a referenced node with --force removes it and clears the references to it.
# Steps:
#   1. Delete testpart_spi_dev --force, with --json.
#   2. Check it succeeds and says it deleted the node and cleared 1 reference.
#   3. Check the workfile no longer has testpart_spi_dev, and testpart_ip.comm_init is null.
# bats test_tags=req:DELETE-02, id:N0081
@test "delete <node> --force removes a referenced device and clears the reference" {
	run_json delete testpart_spi_dev --force
	assert_success
	assert_json '.message' "Deleted 'testpart_spi_dev' and cleared 1 reference to it"
	[ "$(stored '.symbols | has("testpart_spi_dev")')" = false ]
	[ "$(stored '.symbols.testpart_ip.comm_init')" = null ]
}

# Description: delete with no arguments, without --force, only warns that it would remove every
# node, lists them, and changes nothing.
# Steps:
#   1. Snapshot the workfile.
#   2. Delete with no arguments, with --json.
#   3. Check it succeeds with a warning that counts the 11 nodes, asks for --force, and lists the
#      nodes.
#   4. Check the workfile didn't change.
#   5. Delete with no arguments, without --json.
#   6. Check it says it would delete 11 nodes, lists them, says nothing was changed, and the
#      workfile didn't change.
# bats test_tags=req:DELETE-03, id:N0082
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

# Description: delete --force with no arguments removes every node, and a delete after it finds
# nothing to remove.
# Steps:
#   1. Delete --force with no arguments.
#   2. Check it succeeds and says it deleted 11 nodes.
#   3. Check the workfile has no nodes.
#   4. Delete with no arguments, and check it says there is nothing to delete.
# bats test_tags=req:DELETE-03, id:N0083
@test "delete --force with no arguments removes every device" {
	run aa delete --force
	assert_success
	assert_output "Deleted 11 nodes"
	[ "$(stored '.symbols')" = '{}' ]
	run aa delete
	assert_output "Nothing to delete: the workfile has no nodes"
}

# Description: delete <node> --force leaves the same workfile with and without --json.
# Steps:
#   1. Keep a copy of the starting workfile.
#   2. Delete testpart_spi_dev --force, without --json, and keep the result.
#   3. Restore the starting workfile.
#   4. Delete testpart_spi_dev --force, with --json, and check it succeeds (.ok true).
#   5. Check the two resulting workfiles are the same.
# bats test_tags=req:DELETE-05, id:N0084
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

# Description: delete --force with no arguments gives the same message and leaves the same
# workfile with and without --json.
# Steps:
#   1. Keep a copy of the starting workfile.
#   2. Delete --force with no arguments, without --json; keep its output and the workfile.
#   3. Restore the starting workfile.
#   4. Delete --force with no arguments, with --json, and check it succeeds.
#   5. Check the JSON message equals the text output, and the two workfiles are the same.
# bats test_tags=req:DELETE-05, id:N0085
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

# Description: after a delete, a value that has only one possible choice left is filled in again,
# and the output says so.
# Steps:
#   1. Edit the workfile by hand: remove testpart_spi_dev.mode (which has one value only) and its
#      automatic mark.
#   2. Delete testpart_spi_dev native_cs.
#   3. Check it succeeds and reports mode filled with TEST_SPI_MODE_0 as the only value.
#   4. Check the workfile has mode TEST_SPI_MODE_0.
# bats test_tags=req:DELETE-06, id:N0086
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

# Description: after a delete, the output lists the values that no longer apply (removed) and the
# required values left for the user to set.
# Steps:
#   1. Delete testpart_cs_gpio --force.
#   2. Check it succeeds and says it deleted the node and cleared 1 reference.
#   3. Check it reports testpart_spi_dev.cs_gpio_num as no longer applying, removed.
#   4. Check it lists testpart_spi_dev.cs_gpio as still to set.
#   5. Check the workfile no longer has testpart_spi_dev.cs_gpio_num.
# bats test_tags=req:DELETE-06, id:N0087
@test "delete reports what is left to set and drops what no longer applies" {
	run aa delete testpart_cs_gpio --force
	assert_success
	assert_line "Deleted 'testpart_cs_gpio' and cleared 1 reference to it"
	assert_line --regexp '^  - testpart_spi_dev.cs_gpio_num +1 \(no longer applies, removed\)$'
	assert_line "Still yours to set - required, and nothing to fill them from:"
	assert_line --regexp '^  ! testpart_spi_dev.cs_gpio +include '
	[ "$(stored '.symbols.testpart_spi_dev | has("cs_gpio_num")')" = false ]
}
