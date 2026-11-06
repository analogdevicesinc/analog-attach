# delete on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: delete <node> <property> removes the value and answers alike on both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, delete pin number on noos and delete adxl345 reg on linux.
#   3. Check both succeed (.ok true) with the same fields' types.
# bats test_tags=conformity, req:DELETE-01, req:GEN-08, id:C0022
@test "delete of a property answers alike on both backends" {
	with_conformity_devices
	conform delete pin number -- delete adxl345 reg
	assert_same_status 0
	assert_same '.ok' true
	assert_same '{ok, message, severity} | shape'
}

# Description: delete of a node that doesn't exist is refused the same way on both backends.
# Steps:
#   1. Run init on each backend.
#   2. Run delete nosuch, with --json, on each backend.
#   3. Check both are refused (exit 0, .ok false, severity error, error type not-found).
# bats test_tags=conformity, req:DELETE-02, req:GEN-08, req:GEN-09, req:GEN-17, id:C0023
@test "delete of an unknown node is refused the same way on both backends" {
	on noos init
	on linux init
	conform delete nosuch -- delete nosuch
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
	assert_same '.error_type' '"not-found"'
}
