# validate on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: validate of a new, empty workfile answers in the same form on both backends: the
# ok, message and severity, and the errors and the warnings, both empty.
# Steps:
#   1. Run init on each backend.
#   2. Run validate, with --json, on each backend.
#   3. Check both succeed with the same fields: ok true, severity info, the message, and errors and
#      warnings both empty.
# bats test_tags=conformity, req:VALIDATE-01, req:GEN-08, id:C0009
@test "validate of an empty workfile answers alike on both backends" {
	on noos init
	on linux init
	conform validate -- validate
	assert_same_status 0
	assert_same '.' '{"ok":true,"message":"0 error(s), 0 warning(s)","severity":"info","errors":[],"warnings":[]}'
}
