# skill where the backend is linux: the Claude Code skill, installed under $HOME/.claude.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
	# install checks that Claude Code is there (`claude --version`): a stand-in for it.
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	printf '#!/bin/sh\necho "1.0.0 (Claude Code)"\n' >"$BATS_TEST_TMPDIR/bin/claude"
	chmod +x "$BATS_TEST_TMPDIR/bin/claude"
	PATH="$BATS_TEST_TMPDIR/bin:$PATH"
	SKILL=analog-attach-linux
	SKILL_DIR="$HOME/.claude/skills/$SKILL"
}

# bats test_tags=req:SKILL-01
@test "skill install installs the linux skill for Claude Code" {
	run_json skill install "$SKILL"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$SKILL_DIR"
	diff "$CLI_DIR/skills/linux/SKILL.md" "$SKILL_DIR/SKILL.md"
	run aa skill uninstall "$SKILL"
	run aa skill install "$SKILL"
	assert_output --partial "Skill $SKILL installed successfully!"
}

# bats test_tags=req:SKILL-01
@test "skill install refuses to replace an installed copy" {
	aa skill install "$SKILL" >/dev/null
	echo "my edits" >>"$SKILL_DIR/SKILL.md"
	run_json skill install "$SKILL"
	assert_json '.ok' false
	assert_json '.message | test("already installed") and test("--force")' true
	run tail -n 1 "$SKILL_DIR/SKILL.md"
	assert_output "my edits"
}

# bats test_tags=req:SKILL-01
@test "skill install --force replaces an installed copy" {
	aa skill install "$SKILL" >/dev/null
	echo "my edits" >>"$SKILL_DIR/SKILL.md"
	run_json skill install "$SKILL" --force
	assert_json '.ok' true
	diff "$CLI_DIR/skills/linux/SKILL.md" "$SKILL_DIR/SKILL.md"
}

# bats test_tags=req:SKILL-02
@test "skill uninstall removes the installed skill" {
	aa skill install "$SKILL" >/dev/null
	run_json skill uninstall "$SKILL"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$SKILL_DIR"
	[ ! -e "$SKILL_DIR" ]
}

# bats test_tags=req:SKILL-02
@test "skill uninstall of a skill that isn't installed says so" {
	run_json skill uninstall "$SKILL"
	assert_json '.ok' false
	assert_json '.message' "Skill $SKILL is not installed."
}

# bats test_tags=req:SKILL-03
@test "the linux ecosystem has its own skill, named on the command line" {
	run aa skill install nosuch
	assert_output --partial "Unknown skill: nosuch. Skills of the linux backend: $SKILL"
	run aa __complete -- skill install ''
	assert_line --partial "$SKILL"
	[ ! -e "$HOME/.claude" ]
}

# bats test_tags=req:SKILL-03
@test "another ecosystem's skill is refused, naming the selected one's" {
	run aa skill install analog-attach-noos
	assert_output --partial "Unknown skill: analog-attach-noos. Skills of the linux backend: $SKILL"
	[ ! -e "$HOME/.claude/skills/analog-attach-noos" ]
}
