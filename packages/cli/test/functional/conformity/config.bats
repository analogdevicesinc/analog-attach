# config on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: config <key> gives the setting's entry with the same fields on both backends.
# Steps:
#   1. Run config workfile, with --json, on each backend.
#   2. Check both succeed, and their entry has the same fields.
# bats test_tags=conformity, req:CONFIG-02, req:GEN-08, id:C0001
@test "config <key> gives the same fields on both backends" {
	conform config workfile -- config workfile
	assert_same_status 0
	assert_same '.ok' true
	assert_same '[.configs[0] | keys]'
}

# Description: config lists every setting with the same fields on both backends.
# Steps:
#   1. Run config, with --json, on each backend.
#   2. Check both succeed, and every entry of both has the same fields.
# bats test_tags=conformity, req:CONFIG-01, req:GEN-08, id:C0002
@test "config lists the settings with the same fields on both backends" {
	conform config -- config
	assert_same_status 0
	assert_same '[.configs[] | keys] | unique'
}

# Description: an unknown setting key is a usage error on both backends.
# Steps:
#   1. Run config nosuchkey, with --json, on each backend.
#   2. Check both fail with a usage error (exit 2).
# bats test_tags=conformity, req:CONFIG-11, req:GEN-09, id:C0003
@test "an unknown setting is a usage error on both backends" {
	conform config nosuchkey -- config nosuchkey
	assert_same_status 2
}

# Description: a value a setting can't take is refused the same way on both backends, with the
# same error type.
# Steps:
#   1. Run, with --json, config interview maybe on noos and config overlay-syntax bar on linux.
#   2. Check both are refused (exit 0, .ok false, severity error) with the error type
#      invalid-setting.
# bats test_tags=conformity, req:CONFIG-03, req:GEN-09, req:GEN-17, id:C0004
@test "a value a setting can't take is refused the same way on both backends" {
	conform config interview maybe -- config overlay-syntax bar
	assert_same_status 0
	assert_same '{ok, severity, error_type}' '{"ok":false,"severity":"error","error_type":"invalid-setting"}'
}
