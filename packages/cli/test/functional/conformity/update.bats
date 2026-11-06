# update on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: update <node> <property> with no value shows the property with the same fields on
# both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, update pin number on noos and update adxl345 reg on linux.
#   3. Check both succeed with ok true, severity info, kind property and the fields every property
#      read has: message, key, type, value, required, definition, suggestions.
# bats test_tags=conformity, req:UPDATE-03, req:GEN-08, id:C0019
@test "update with no value shows the property alike on both backends" {
	with_conformity_devices
	conform update pin number -- update adxl345 reg
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":true,"severity":"info"}'
	assert_same '[has("message", "kind", "key", "type", "value", "required", "definition", "suggestions")] | all' true
	assert_same '.kind' '"property"'
}

# Description: update <node> <property> <value> sets the value and answers alike on both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, update pin number 3 on noos and update adxl345 reg 0x1d on linux.
#   3. Check both succeed (.ok true) with the same severity and the same fields' types.
# bats test_tags=conformity, req:UPDATE-01, req:GEN-08, id:C0020
@test "update sets a value and answers alike on both backends" {
	with_conformity_devices
	conform update pin number 3 -- update adxl345 reg 0x1d
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":true,"severity":"info"}'
	assert_same '{ok, message, severity} | shape'
}

# Description: update of a node that doesn't exist is refused the same way on both backends.
# Steps:
#   1. Run init on each backend.
#   2. Run update nosuch x 1, with --json, on each backend.
#   3. Check both are refused (exit 0, .ok false, severity error, error type not-found).
# bats test_tags=conformity, req:UPDATE-01, req:GEN-08, req:GEN-09, req:GEN-17, id:C0021
@test "update of an unknown node is refused the same way on both backends" {
	on noos init
	on linux init
	conform update nosuch x 1 -- update nosuch x 1
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
	assert_same '.error_type' '"not-found"'
}
