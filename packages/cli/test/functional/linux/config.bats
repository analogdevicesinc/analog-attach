# Examples: config where the backend is linux. No Linux tree is set up, so these only reach
# what works without one.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
}

# bats test_tags=req:CONFIG-01
@test "config lists the Linux settings, the required ones marked" {
	run aa config
	assert_success
	assert_output --partial "* linux"
	assert_output --partial "* devicetree"
}

# bats test_tags=req:GEN-13
@test "a command that needs an unset setting names it" {
	# The exit status differs by mode today (0 as text, 2 with --json): not checked here.
	run aa read
	assert_output --partial "Missing config field linux"
}
