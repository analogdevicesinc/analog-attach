# skill where the backend is linux: the Claude Code skill, installed under $HOME/.claude.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, no workfile, and a
# claude stand-in first on PATH; $SKILL is analog-attach-linux and $SKILL_DIR its directory
# under $HOME/.claude/skills.
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

# Description: skill install installs the linux skill for Claude Code, a copy of the
# repository's skills/analog-attach-linux/SKILL.md, and says so in human mode.
# Steps:
#   1. Install analog-attach-linux, with --json.
#   2. Check it succeeds (.ok true) and the path is the skill's directory.
#   3. Check the installed SKILL.md is the same as the repository's skills/analog-attach-linux/SKILL.md (a
#      run from the repository installs that one).
#   4. Uninstall it, install it again in human mode, and check it says it was installed.
# bats test_tags=req:SKILL-01, id:L0300
@test "skill install installs the linux skill for Claude Code" {
	run_json skill install "$SKILL"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$SKILL_DIR"
	diff "$REPO_DIR/skills/analog-attach-linux/SKILL.md" "$SKILL_DIR/SKILL.md"
	run aa skill uninstall "$SKILL"
	run aa skill install "$SKILL"
	assert_output --partial "Skill $SKILL installed successfully!"
}

# Description: skill install refuses to replace an installed copy, pointing to --force, and
# keeps the edits made to it.
# Steps:
#   1. Install the skill and add a line to its SKILL.md.
#   2. Install it again, with --json; check it is refused (.ok false) and the message says it is
#      already installed and mentions --force.
#   3. Check the added line is still the last of SKILL.md.
# bats test_tags=req:SKILL-01, id:L0301
@test "skill install refuses to replace an installed copy" {
	aa skill install "$SKILL" >/dev/null
	echo "my edits" >>"$SKILL_DIR/SKILL.md"
	run_json skill install "$SKILL"
	assert_json '.ok' false
	assert_json '.message | test("already installed") and test("--force")' true
	run tail -n 1 "$SKILL_DIR/SKILL.md"
	assert_output "my edits"
}

# Description: skill install --force replaces an installed copy.
# Steps:
#   1. Install the skill and add a line to its SKILL.md.
#   2. Install it again with --force, with --json; check it succeeds (.ok true).
#   3. Check SKILL.md is again the same as the repository's.
# bats test_tags=req:SKILL-01, id:L0302
@test "skill install --force replaces an installed copy" {
	aa skill install "$SKILL" >/dev/null
	echo "my edits" >>"$SKILL_DIR/SKILL.md"
	run_json skill install "$SKILL" --force
	assert_json '.ok' true
	diff "$REPO_DIR/skills/analog-attach-linux/SKILL.md" "$SKILL_DIR/SKILL.md"
}

# Description: skill uninstall removes the installed skill's directory.
# Steps:
#   1. Install the skill.
#   2. Uninstall it, with --json; check it succeeds (.ok true) and the path is its directory.
#   3. Check the directory is gone.
# bats test_tags=req:SKILL-02, id:L0303
@test "skill uninstall removes the installed skill" {
	aa skill install "$SKILL" >/dev/null
	run_json skill uninstall "$SKILL"
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$SKILL_DIR"
	[ ! -e "$SKILL_DIR" ]
}

# Description: skill uninstall of a skill that is not installed says so.
# Steps:
#   1. Uninstall the skill, with --json, without installing it.
#   2. Check it is refused (.ok false) and the message says it is not installed.
# bats test_tags=req:SKILL-02, id:L0304
@test "skill uninstall of a skill that isn't installed says so" {
	run_json skill uninstall "$SKILL"
	assert_json '.ok' false
	assert_json '.message' "Skill $SKILL is not installed."
}

# Description: the linux backend has its own skill: an unknown name is refused naming it, and
# completion offers it.
# Steps:
#   1. Install nosuch; check it says the skill is unknown and names the linux backend's skill.
#   2. Complete skill install with an empty word; check the linux skill is offered.
#   3. Check nothing was written under $HOME/.claude.
# bats test_tags=req:SKILL-03, id:L0305
@test "the linux ecosystem has its own skill, named on the command line" {
	run aa skill install nosuch
	assert_output --partial "Unknown skill: nosuch. Skills of the linux backend: $SKILL"
	run aa __complete -- skill install ''
	assert_line --partial "$SKILL"
	[ ! -e "$HOME/.claude" ]
}

# Description: another ecosystem's skill is refused, naming the linux backend's skill.
# Steps:
#   1. Install analog-attach-noos.
#   2. Check it says the skill is unknown and names the linux backend's skill.
#   3. Check the noos skill was not installed.
# bats test_tags=req:SKILL-03, id:L0306
@test "another ecosystem's skill is refused, naming the selected one's" {
	run aa skill install analog-attach-noos
	assert_output --partial "Unknown skill: analog-attach-noos. Skills of the linux backend: $SKILL"
	[ ! -e "$HOME/.claude/skills/analog-attach-noos" ]
}

# A stand-in for an agent's command (`codex`, `gemini`) first on PATH: install checks it is
# there (`<command> --version`). With `broken`, it fails, as a missing one does.
stand_in() {
	if [ "${2:-}" = broken ]; then
		printf '#!/bin/sh\nexit 127\n' >"$BATS_TEST_TMPDIR/bin/$1"
	else
		printf '#!/bin/sh\necho "%s 1.0.0"\n' "$1" >"$BATS_TEST_TMPDIR/bin/$1"
	fi
	chmod +x "$BATS_TEST_TMPDIR/bin/$1"
}

# Description: --agent codex installs the skill for Codex CLI, under $HOME/.agents/skills, and
# names it; Claude Code's directory is left alone.
# Steps:
#   1. With a codex stand-in on PATH, install the skill --agent codex, with --json.
#   2. Check it succeeds, the path is $HOME/.agents/skills/<skill> and the agent codex.
#   3. Check SKILL.md is the repository's, and nothing was written under $HOME/.claude.
#   4. Uninstall it in human mode; check it says so for Codex CLI and the directory is gone.
# bats test_tags=req:SKILL-04, id:L0501
@test "skill install --agent codex installs the skill for Codex CLI" {
	stand_in codex
	run_json skill install "$SKILL" --agent codex
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$HOME/.agents/skills/$SKILL"
	assert_json '.agent' codex
	diff "$REPO_DIR/skills/analog-attach-linux/SKILL.md" "$HOME/.agents/skills/$SKILL/SKILL.md"
	[ ! -e "$HOME/.claude" ]
	run aa skill uninstall "$SKILL" --agent codex
	assert_output --partial "Skill $SKILL uninstalled successfully for Codex CLI."
	[ ! -e "$HOME/.agents/skills/$SKILL" ]
}

# Description: --agent gemini installs the skill for Gemini CLI, under $HOME/.gemini/skills,
# and refuses when Gemini CLI isn't installed.
# Steps:
#   1. With a gemini on PATH whose --version fails, install the skill --agent gemini, with
#      --json; check it is refused saying Gemini CLI is not installed, and nothing was written
#      under $HOME/.gemini.
#   2. With a gemini stand-in that runs, install it again in human mode; check it says so for
#      Gemini CLI and SKILL.md is under $HOME/.gemini/skills.
# bats test_tags=req:SKILL-04, id:L0502
@test "skill install --agent gemini installs the skill for Gemini CLI, which must be there" {
	stand_in gemini broken
	run_json skill install "$SKILL" --agent gemini
	assert_json '.ok' false
	assert_json '.message' "Gemini CLI is not installed. Install it from: https://geminicli.com"
	[ ! -e "$HOME/.gemini" ]
	stand_in gemini
	run aa skill install "$SKILL" --agent gemini
	assert_output --partial "Skill $SKILL installed successfully for Gemini CLI!"
	assert_output --partial "Gemini CLI now helps with"
	[ -f "$HOME/.gemini/skills/$SKILL/SKILL.md" ]
}

# Description: --agent all installs for each agent that is there, skipping the others, and
# uninstalls from each that has it.
# Steps:
#   1. With claude and codex stand-ins and a gemini that fails, install the skill --agent all
#      in human mode; check it names Claude Code and Codex CLI and says Gemini CLI was skipped.
#   2. List the skills --agent all, with --json; check there is an item per agent, installed
#      for claude and codex only.
#   3. Uninstall --agent all, with --json; check the agents it was removed for are claude and
#      codex, and both directories are gone.
# bats test_tags=req:SKILL-04, id:L0503
@test "skill install --agent all installs for each agent that is installed" {
	stand_in codex
	stand_in gemini broken
	run aa skill install "$SKILL" --agent all
	assert_output --partial "Skill $SKILL installed successfully for Claude Code and Codex CLI!"
	assert_output --partial "Skipped Gemini CLI: it is not installed."
	run_json skill install --agent all
	assert_json '[.skills[] | [.agent, .installed]] | tostring' '[["claude",true],["codex",true],["gemini",false]]'
	run_json skill uninstall "$SKILL" --agent all
	assert_json '[.agents[].agent] | tostring' '["claude","codex"]'
	[ ! -e "$SKILL_DIR" ]
	[ ! -e "$HOME/.agents/skills/$SKILL" ]
}

# Description: an unknown agent is refused, naming the agents, and completion offers them.
# Steps:
#   1. Install the skill --agent vim, with --json; check it is refused with the list of agents,
#      and nothing was written under $HOME/.claude.
#   2. Complete skill install's --agent with an empty word; check codex, gemini and all are
#      offered.
# bats test_tags=req:SKILL-04, id:L0504
@test "an unknown agent is refused, and completion offers the agents" {
	run_json skill install "$SKILL" --agent vim
	assert_json '.ok' false
	assert_json '.message' "Unknown agent: vim. Agents: claude, codex, gemini, all"
	[ ! -e "$HOME/.claude" ]
	run aa __complete -- skill install "$SKILL" --agent ''
	assert_line --partial codex
	assert_line --partial gemini
	assert_line --partial all
}
