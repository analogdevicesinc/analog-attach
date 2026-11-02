# enable / disable where the backend is noos: not offered (a possible later addition).

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, and a
# workfile with the eval-testpart board added (with_sensor).
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# Description: the help of a noos project doesn't list enable or disable.
# Steps:
#   1. Run --help.
#   2. Check it succeeds and lists neither enable nor disable as a command or in an example.
# bats test_tags=req:ENABLE-02, id:N0095
@test "enable and disable are not offered for noos" {
	run aa --help
	assert_success
	refute_line --regexp '^ +(enable|disable) '
	refute_output --partial "analog-attach enable"
	refute_output --partial "analog-attach disable"
}

# Description: enable and disable fail under noos, naming the command, and leave the workfile as
# it was.
# Steps:
#   1. Keep a copy of the workfile.
#   2. Enable testpart_spi_dev, and check it fails, the output naming enable.
#   3. Disable testpart_spi_dev, and check it fails, the output naming disable.
#   4. Check the workfile didn't change.
# bats test_tags=req:ENABLE-02, id:N0096
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
