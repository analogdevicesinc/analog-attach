# Every command (the shared front end) on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: an unknown command is a usage error on both backends.
# Steps:
#   1. Run nosuchcommand, with --json, on each backend.
#   2. Check both fail with a usage error (exit 2).
# bats test_tags=conformity, req:GEN-02, req:GEN-09, id:C0012
@test "an unknown command is a usage error on both backends" {
	conform nosuchcommand -- nosuchcommand
	assert_same_status 2
}

# Description: --version prints the same version on both backends.
# Steps:
#   1. Run --version on each backend.
#   2. Check both succeed and print the same text.
# bats test_tags=conformity, req:GEN-11, id:C0013
@test "--version prints the same on both backends" {
	conform --version -- --version
	assert_same_status 0
	[ "$noos_output" = "$linux_output" ] || fail "noos: $noos_output, linux: $linux_output"
}

# Description: analog-attach --json alone gives one result of the same form on both backends: the
# usage and the required settings still missing.
# Steps:
#   1. Run analog-attach --json, with no command, on each backend.
#   2. Check both succeed with the same fields (ok, message, severity, usage, missing).
# bats test_tags=conformity, req:SETUP-04, req:GEN-07, id:C0014
@test "the bare --json run answers in the same form on both backends" {
	conform -- 
	assert_same_status 0
	assert_same 'keys'
	assert_same '{ok, usage, missing} | shape'
}

# Description: completion bash gives the script in the same form on both backends.
# Steps:
#   1. Run completion bash, with --json, on each backend.
#   2. Check both succeed with the same fields, the script a text.
# bats test_tags=conformity, req:COMPLETION-01, id:C0015
@test "completion bash answers in the same form on both backends" {
	conform completion bash -- completion bash
	assert_same_status 0
	assert_same '. | shape'
}

# Description: skill install of a skill that doesn't exist is refused the same way on both
# backends, with the same error type.
# Steps:
#   1. Run skill install nosuch, with --json, on each backend.
#   2. Check both are refused (exit 0, .ok false) with the error type unknown-choice.
# bats test_tags=conformity, req:SKILL-03, req:GEN-17, id:C0016
@test "an unknown skill is refused the same way on both backends" {
	conform skill install nosuch -- skill install nosuch
	assert_same_status 0
	assert_same '{ok, error_type}' '{"ok":false,"error_type":"unknown-choice"}'
}

# Description: skill install with no name lists the backend's skills in the same form on both
# backends.
# Steps:
#   1. Run skill install, with --json, with no name, on each backend.
#   2. Check both succeed with one skill each, with the same fields, not installed.
# bats test_tags=conformity, req:SKILL-01, req:SKILL-03, id:C0030
@test "skill install with no name lists the skills alike on both backends" {
	conform skill install -- skill install
	assert_same_status 0
	assert_same '.ok' true
	assert_same '[.skills[] | keys]'
	assert_same '[.skills[].installed]' '[false]'
}
