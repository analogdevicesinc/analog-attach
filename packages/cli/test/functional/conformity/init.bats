# init on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: init in a new project creates the workfile and answers with the same fields on
# both backends.
# Steps:
#   1. Run init, with --json, on each backend.
#   2. Check both succeed (.ok true, created true), and path, created and the common fields have
#      the same types.
# bats test_tags=conformity, req:INIT-01, req:INIT-05, req:GEN-08, id:C0005
@test "init creates the workfile and answers alike on both backends" {
	conform init -- init
	assert_same_status 0
	assert_same '{ok, created}' '{"ok":true,"created":true}'
	assert_same '{ok, message, severity, path, created} | shape'
}
