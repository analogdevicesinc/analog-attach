# enable / disable where the backend is noos: not offered (a possible later addition).

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# bats test_tags=req:ENABLE-02
@test "enable and disable are not offered for noos" {
	run aa --help
	assert_success
	refute_line --regexp '^ +(enable|disable) '
	refute_output --partial "analog-attach enable"
	refute_output --partial "analog-attach disable"
}

# bats test_tags=req:ENABLE-02
@test "enable and disable are refused and change nothing" {
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run aa enable testpart_spi_dev
	assert_failure
	assert_output --partial "enable"
	run aa disable testpart_spi_dev
	assert_failure
	assert_output --partial "disable"
	cmp -s "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json" || fail "the workfile changed"
}
