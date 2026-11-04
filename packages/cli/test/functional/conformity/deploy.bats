# deploy on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: deploy is a command of both backends, with its help.
# Steps:
#   1. Run deploy --help on each backend.
#   2. Check both succeed and start with the usage.
# bats test_tags=conformity, req:DEPLOY-01, req:GEN-02, req:GEN-10, id:C0029
@test "deploy is a command of both backends, with its help" {
	conform deploy --help -- deploy --help
	assert_same_status 0
	[ "${noos_output%%$'\n'*}" = USAGE ] || fail "noos: $noos_output"
	[ "${linux_output%%$'\n'*}" = USAGE ] || fail "linux: $linux_output"
}
