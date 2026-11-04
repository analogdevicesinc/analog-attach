# add on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: add of a device type that doesn't exist is refused the same way on both backends.
# Steps:
#   1. Run init on each backend.
#   2. Run, with --json, add nosuchdevice on noos and add adi,nosuchdevice on linux.
#   3. Check both are refused (exit 0, .ok false, severity error) with a message.
# bats test_tags=conformity, req:ADD-02, req:GEN-08, req:GEN-09, id:C0010
@test "an unknown device type is refused the same way on both backends" {
	on noos init
	on linux init
	conform add nosuchdevice -- add adi,nosuchdevice
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
	assert_same '.message | type' '"string"'
}
