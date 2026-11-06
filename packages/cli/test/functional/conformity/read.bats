# read on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: read of a node that doesn't exist is refused the same way on both backends.
# Steps:
#   1. Run init on each backend.
#   2. Run read nosuch, with --json, on each backend.
#   3. Check both are refused (exit 0, .ok false, severity error) with a message.
# bats test_tags=conformity, req:READ-02, req:GEN-08, req:GEN-09, id:C0011
@test "an unknown node is refused the same way on both backends" {
	on noos init
	on linux init
	conform read nosuch -- read nosuch
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
	assert_same '.message | type' '"string"'
}

# Description: read <node> gives the node with the same fields on both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, read pin on noos and read adxl345 on linux.
#   3. Check both succeed with the same fields, ok true and severity info, kind node, and the same
#      types for message, key and origin.
# bats test_tags=conformity, req:READ-02, req:GEN-08, id:C0017
@test "read <node> gives the same fields on both backends" {
	with_conformity_devices
	conform read pin -- read adxl345
	assert_same_status 0
	assert_same 'keys'
	assert_same '{ok, severity}' '{"ok":true,"severity":"info"}'
	assert_same '.kind' '"node"'
	assert_same '{message, key, origin} | shape'
}

# Description: read <node> <property> gives the property with the same fields on both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, read pin number on noos and read adxl345 reg on linux.
#   3. Check both succeed with ok true, severity info, kind property and the fields every property
#      read has: message, key, type, value, required, definition, suggestions.
# bats test_tags=conformity, req:READ-03, req:GEN-08, id:C0018
@test "read <node> <property> gives the same fields on both backends" {
	with_conformity_devices
	conform read pin number -- read adxl345 reg
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":true,"severity":"info"}'
	assert_same '[has("message", "kind", "key", "type", "value", "required", "definition", "suggestions")] | all' true
	assert_same '.kind' '"property"'
}
