# skill where the backend is noos: the Claude Code skill, installed under $HOME/.claude.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, no
# workfile; a stand-in claude command on PATH, and no skill installed under $HOME/.claude.
setup() {
	load ../helpers
	new_project noos
	# install checks that Claude Code is there (`claude --version`): a stand-in for it.
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho "1.0.0 (Claude Code)"\n' >"$BATS_TEST_TMPDIR/bin/claude"
	chmod +x "$BATS_TEST_TMPDIR/bin/claude"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH"
	SKILL=analog-attach-noos
	SKILL_DIR="$HOME/.claude/skills/$SKILL"
}

# Description: skill install copies the noos skill into Claude Code's skills directory.
# Steps:
#   1. Install analog-attach-noos, with --json.
#   2. Check it succeeds, with .path the skill's directory under $HOME/.claude/skills.
#   3. Check the installed SKILL.md is the CLI's noos SKILL.md.
#   4. Uninstall it, install it again without --json, and check it says it was installed.
# bats test_tags=req:SKILL-01, id:N0242
@test "skill install installs the noos skill for Claude Code" {
	run_json skill install "$SKILL"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$SKILL_DIR"
	diff "$CLI_DIR/skills/noos/SKILL.md" "$SKILL_DIR/SKILL.md"
	run aa skill uninstall "$SKILL"
	run aa skill install "$SKILL"
	assert_output --partial "Skill $SKILL installed successfully!"
}

# Description: skill install refuses to replace a copy already installed, keeping the user's edits.
# Steps:
#   1. Install analog-attach-noos, and append a line to its SKILL.md.
#   2. Install it again, with --json.
#   3. Check it is refused (.ok false), saying it is already installed and naming --force.
#   4. Check the appended line is still there.
# bats test_tags=req:SKILL-01, id:N0243
@test "skill install refuses to replace an installed copy" {
	aa skill install "$SKILL" >/dev/null
	echo "my edits" >>"$SKILL_DIR/SKILL.md"
	run_json skill install "$SKILL"
	assert_json '.ok' false
	assert_json '.message | test("already installed") and test("--force")' true
	run tail -n 1 "$SKILL_DIR/SKILL.md"
	assert_output "my edits"
}

# Description: skill install --force replaces a copy already installed.
# Steps:
#   1. Install analog-attach-noos, and append a line to its SKILL.md.
#   2. Install it again with --force, with --json, and check it succeeds (.ok true).
#   3. Check SKILL.md is again the CLI's noos SKILL.md.
# bats test_tags=req:SKILL-01, id:N0244
@test "skill install --force replaces an installed copy" {
	aa skill install "$SKILL" >/dev/null
	echo "my edits" >>"$SKILL_DIR/SKILL.md"
	run_json skill install "$SKILL" --force
	assert_json '.ok' true
	diff "$CLI_DIR/skills/noos/SKILL.md" "$SKILL_DIR/SKILL.md"
}

# Description: skill uninstall removes the installed skill's directory.
# Steps:
#   1. Install analog-attach-noos.
#   2. Uninstall it, with --json.
#   3. Check it succeeds, with .path the skill's directory, and the directory is gone.
# bats test_tags=req:SKILL-02, id:N0245
@test "skill uninstall removes the installed skill" {
	aa skill install "$SKILL" >/dev/null
	run_json skill uninstall "$SKILL"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$SKILL_DIR"
	[ ! -e "$SKILL_DIR" ]
}

# Description: uninstalling a skill that isn't installed is refused and says so.
# Steps:
#   1. Uninstall analog-attach-noos, with --json, without installing it first.
#   2. Check it is refused (.ok false), saying the skill is not installed.
# bats test_tags=req:SKILL-02, id:N0246
@test "skill uninstall of a skill that isn't installed says so" {
	run_json skill uninstall "$SKILL"
	assert_json '.ok' false
	assert_json '.message' "Skill $SKILL is not installed."
}

# Description: the noos backend offers its own skill: an unknown skill name is refused naming it,
# and completion offers it.
# Steps:
#   1. Install nosuch.
#   2. Check it is refused (exit 0), saying the skill is unknown and naming analog-attach-noos.
#   3. Ask for completions of skill install, and check analog-attach-noos is offered.
#   4. Check nothing was written under $HOME/.claude.
# bats test_tags=req:SKILL-03, id:N0247
@test "the noos ecosystem has its own skill, named on the command line" {
	run aa skill install nosuch
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "Unknown skill: nosuch. Skills of the noos backend: $SKILL"
	run aa __complete -- skill install ''
	assert_line --partial "$SKILL"
	[ ! -e "$HOME/.claude" ]
}

# Description: the linux backend's skill is refused under noos, the message naming the noos one.
# Steps:
#   1. Install analog-attach-linux.
#   2. Check it is refused (exit 0), naming analog-attach-noos.
#   3. Check the linux skill was not installed.
# bats test_tags=req:SKILL-03, id:N0248
@test "another ecosystem's skill is refused, naming the selected one's" {
	run aa skill install analog-attach-linux
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "analog-attach-noos"
	[ ! -e "$HOME/.claude/skills/analog-attach-linux" ]
}

# Description: skill install and skill uninstall with no name list the backend's skills, each with
# what it helps with and whether it is installed.
# Steps:
#   1. Run skill install, with --json, with no name.
#   2. Check it succeeds, listing analog-attach-noos, not installed.
#   3. Install analog-attach-noos.
#   4. Run skill uninstall, with --json, with no name; check it lists analog-attach-noos as
#      installed.
#   5. Run skill install with no name in human mode; check it names the skill, marks it
#      installed, and says how to install one.
# bats test_tags=req:SKILL-01, req:SKILL-02, req:SKILL-03, id:N0281
@test "skill install and uninstall with no name list the skills" {
	run_json skill install
	assert_success
	assert_json '[.ok, (.skills | map("\(.name) \(.installed)") | join(","))] | map(tostring) | join(" ")' "true analog-attach-noos false"
	aa skill install analog-attach-noos >/dev/null
	run_json skill uninstall
	assert_json '.skills[0] | "\(.name) \(.installed)"' "analog-attach-noos true"
	run aa skill install
	assert_success
	assert_output --partial "analog-attach-noos"
	assert_output --partial "(installed)"
	assert_output --partial "Install one with: analog-attach skill install <name>"
}
