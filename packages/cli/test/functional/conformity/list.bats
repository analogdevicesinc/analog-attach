# list on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: list devices with a filter lists the matching devices in the same form on both
# backends.
# Steps:
#   1. Run init on each backend.
#   2. Run, with --json, list devices testpart on noos and list devices adxl on linux.
#   3. Check both succeed, and list devices with a key, in the same form.
# bats test_tags=conformity, req:LIST-01, req:LIST-02, req:GEN-08, id:C0006
@test "list devices with a filter answers in the same form on both backends" {
	on noos init
	on linux init
	conform list devices testpart -- list devices adxl
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":true,"severity":"info"}'
	assert_same '.devices[0].key | type' '"string"'
}

# Description: list devices with a filter that matches nothing is no refusal, on both backends.
# Steps:
#   1. Run init on each backend.
#   2. Run list devices zzznothing, with --json, on each backend.
#   3. Check both succeed with an empty list of devices.
# bats test_tags=conformity, req:LIST-02, id:C0007
@test "list devices with a filter that matches nothing is no refusal on both backends" {
	on noos init
	on linux init
	conform list devices zzznothing -- list devices zzznothing
	assert_same_status 0
	assert_same '{ok, devices}' '{"ok":true,"devices":[]}'
}

# Description: an unknown list kind is a usage error on both backends.
# Steps:
#   1. Run list nosuch, with --json, on each backend.
#   2. Check both fail with a usage error (exit 2).
# bats test_tags=conformity, req:LIST-11, req:GEN-09, id:C0008
@test "an unknown list kind is a usage error on both backends" {
	conform list nosuch -- list nosuch
	assert_same_status 2
}

# Description: list value of a property gives its suggestions in the same form on both backends.
# Steps:
#   1. Create the workfile on each backend and add a device (with_conformity_devices).
#   2. Run, with --json, list value pin number on noos and list value adxl345 reg on linux.
#   3. Check both succeed (.ok true) with a list of suggestions.
# bats test_tags=conformity, req:LIST-08, req:GEN-08, id:C0027
@test "list value of a property answers in the same form on both backends" {
	with_conformity_devices
	conform list value pin number -- list value adxl345 reg
	assert_same_status 0
	assert_same '.ok' true
	assert_same '.suggestions | type' '"array"'
}
