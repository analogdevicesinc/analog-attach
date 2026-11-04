# import on both backends: the same case answers alike (GEN-02, GEN-08). Only what both share is
# compared: the exit status, the shape of the common fields, and a few values; never the text.

# bats file_tags=eco:all, conformity

# Preconditions: two projects side by side, one noos on attach-no-os-lib's test fixtures (target
# otherboard) and one linux on the Linux tree (RPi 4 base); neither has a workfile yet.
setup() {
	load ../helpers
	conformity_projects
}

# Description: import of a file that doesn't exist is refused the same way on both backends.
# Steps:
#   1. Run, with --json, import /nonexistent.json on noos and import /nonexistent.dtso on linux.
#   2. Check both are refused (exit 0, .ok false, severity error).
# bats test_tags=conformity, req:IMPORT-01, req:GEN-08, req:GEN-09, id:C0026
@test "import of a file that doesn't exist is refused the same way on both backends" {
	conform import /nonexistent.json -- import /nonexistent.dtso
	assert_same_status 0
	assert_same '{ok, severity}' '{"ok":false,"severity":"error"}'
}
