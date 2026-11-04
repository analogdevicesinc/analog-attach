# rename on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: rename gives a device a new name and answers alike on both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, rename pin pin2 on noos and rename adxl345 accel on linux.
#   3. Check both succeed (.ok true) with the same fields.
# bats test_tags=conformity, req:RENAME-01, req:GEN-08, id:C0024
@test "rename answers alike on both backends" {
	with_conformity_devices
	conform rename pin pin2 -- rename adxl345 accel
	assert_same_status 0
	assert_same '.ok' true
	assert_same 'keys'
}

# Description: rename of a node that doesn't exist is refused the same way on both backends.
# Steps:
#   1. Run init on each backend.
#   2. Run rename nosuch other, with --json, on each backend.
#   3. Check both are refused (exit 0, .ok false, severity error).
# bats test_tags=conformity, req:RENAME-01, req:GEN-08, req:GEN-09, id:C0025
@test "rename of an unknown node is refused the same way on both backends" {
	on noos init
	on linux init
	conform rename nosuch other -- rename nosuch other
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
}
