#!/usr/bin/env bash
# Run the analog-attach-linux skill's Tier 3 eval (NVIDIA SkillEvaluator), or prepare it.
#
#   run.sh [--skill <rev>] [--label <name>] [--prepare-only] [--no-build] [-- <tier3 evaluate options>]
#
#   --skill <rev>    the skill as it is at a git revision (HEAD~1, a branch…); default: the working tree
#   --label <name>   the staging folder's name under .stage/ (default: worktree, or the revision);
#                    the results stay in .stage/<label>/analog-attach-linux/evals/results/
#   --prepare-only   stage everything, run `tier3 validate`, and stop: no agent runs
#   --no-build       use the eval's analog-attach binary from the last run (.stage/analog-attach)
#
# Everything after -- goes to `skillevaluator tier3 evaluate` (--max-cases 1, --n-attempts 1,
# --skip-baseline, --agent-model claude-code=<model>…).
#
# A full run is 13 cases × 3 attempts × 2 arms, 6 at a time (evals/config.yml). Quicker:
#   run.sh --no-build -- --reuse-baseline latest
#                    after a change of the skill alone: the without-skill attempts of the last
#                    run are kept, half the attempts. SkillEvaluator takes them only from a run
#                    of the same cases, grader and environment, so not after a change of those,
#                    nor of the CLI (the binary is in the environment): --no-build keeps it.
#   run.sh -- --n-attempts 1
#                    one attempt a case, to try a change out; three for the record.
#
# The skill lives in skills/analog-attach-linux/ (skills/linux/ before it was named after the
# skill, which a --rev that old still reads), which the CLI ships; its evals live here, which it
# doesn't.
# SkillEvaluator wants them together (<skill>/evals/), so this assembles a staging copy:
# the skill's files, evals/, and evals/environment/assets/ (the standalone binary and the
# functional tests' sparse Linux tree, as a tar), which the Dockerfile copies into the image.
#
# The binary is built without its skills/ (the CLI's copy of skills/, emptied for the build and
# put back after it, with the binary that was in dist-binary/): a binary that carries the skill
# would hand it to the runs without the skill, and SkillEvaluator refuses an environment that has
# the skill's SKILL.md in any of its files. The eval's binary is kept as .stage/analog-attach.
#
# The agent is Claude Code on a subscription: it needs CLAUDE_CODE_OAUTH_TOKEN, which
# `claude setup-token` prints. The grader is a script (grading.mode custom_only): no API key.
# Needs: docker, git, yarn, tar, and skillevaluator[tier3] ($SKILLEVALUATOR, else on PATH).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cli="$repo/packages/cli"
skillevaluator="${SKILLEVALUATOR:-skillevaluator}"

rev="" label="" prepare_only=0 build=1
while [ $# -gt 0 ]; do
	case "$1" in
		--skill) rev="$2"; shift 2 ;;
		--label) label="$2"; shift 2 ;;
		--prepare-only) prepare_only=1; shift ;;
		--no-build) build=0; shift ;;
		--) shift; break ;;
		-h|--help) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
	esac
done
label="${label:-${rev:-worktree}}"
label="${label//[^A-Za-z0-9._-]/_}"

command -v "$skillevaluator" >/dev/null || { echo "skillevaluator not found: pip install 'skillevaluator[tier3]', or set SKILLEVALUATOR" >&2; exit 2; }
if [ "$prepare_only" = 0 ]; then
	command -v docker >/dev/null || { echo "docker not found" >&2; exit 2; }
	[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || { echo "CLAUDE_CODE_OAUTH_TOKEN is not set: run 'claude setup-token' and export what it prints" >&2; exit 2; }
fi

case "$(uname -m)" in
	x86_64) arch=x64 ;;
	aarch64|arm64) arch=arm64 ;;
	*) echo "Unsupported architecture: $(uname -m)" >&2; exit 2 ;;
esac
binary="$cli/dist-binary/linux-$arch/analog-attach"
eval_binary="$here/.stage/analog-attach"
if [ "$build" = 1 ]; then
	echo "Building the analog-attach binary, without its skills/..." >&2
	(cd "$repo" && yarn build >/dev/null)
	kept="$(mktemp -d)"
	[ -e "$binary" ] && cp -p "$binary" "$kept/analog-attach"
	put_back() {
		rm -rf "$cli/skills" && cp -r "$repo/skills" "$cli/skills"
		if [ -e "$kept/analog-attach" ]; then cp -p "$kept/analog-attach" "$binary"; else rm -f "$binary"; fi
		rm -rf "$kept"
	}
	trap put_back EXIT
	rm -rf "$cli/skills" && mkdir "$cli/skills"
	(cd "$repo" && yarn workspace @analog-attach/cli build:binary >/dev/null)
	mkdir -p "$here/.stage" && cp "$binary" "$eval_binary"
	put_back
	trap - EXIT
fi
[ -x "$eval_binary" ] || { echo "No eval binary at $eval_binary: run without --no-build" >&2; exit 2; }
tree="$("$cli/test/functional/linux-tree.sh")"

stage="$here/.stage/$label/analog-attach-linux"
echo "Staging $stage..." >&2
# The earlier runs' results stay: they are the record, and what --reuse-baseline reuses.
kept_results="$here/.stage/.results-$label"
rm -rf "$kept_results"
[ -d "$stage/evals/results" ] && mv "$stage/evals/results" "$kept_results"
rm -rf "$stage"
mkdir -p "$stage"
if [ -n "$rev" ]; then
	skill_path=skills/analog-attach-linux
	git -C "$repo" cat-file -e "$rev:$skill_path" 2>/dev/null || skill_path=skills/linux
	git -C "$repo" archive "$rev" "$skill_path" | tar -x -C "$stage" --strip-components=2
else
	cp -r "$repo/skills/analog-attach-linux/." "$stage/"
fi
rm -rf "$stage/evals"
cp -r "$here/evals" "$stage/evals"
[ -d "$kept_results" ] && mv "$kept_results" "$stage/evals/results"
assets="$stage/evals/environment/assets"
mkdir -p "$assets"
cp "$eval_binary" "$assets/analog-attach"
# A tar, which the Dockerfile ADDs (unpacks): the tree has symlinks, which SkillEvaluator refuses
# in the environment folder.
tar -C "$tree" --exclude .git -cf "$assets/linux.tar" .

cd "$here/.stage/$label"
"$skillevaluator" tier3 validate "$stage" --strict
[ "$prepare_only" = 1 ] && { echo "Prepared: $stage" >&2; exit 0; }

# SkillEvaluator wants a provider; anthropic makes claude-code the agent, which logs in with the
# OAuth token (harbor's claude-code, CLAUDE_FORCE_OAUTH, drops any API key), and the custom grader
# calls no model. SkillEvaluator still wants an ANTHROPIC_API_KEY and lists the models with it:
# without a real one, a placeholder, and skillevaluator-oauth.py answers that check.
export SKILL_EVAL_LLM_PROVIDER="${SKILL_EVAL_LLM_PROVIDER:-anthropic}"
export CLAUDE_FORCE_OAUTH=1
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
	"$skillevaluator" tier3 evaluate "$stage" --agents claude-code --env-mode docker "$@"
else
	python="$(sed -n '1s/^#!//p' "$(command -v "$skillevaluator")")"
	ANTHROPIC_API_KEY=unused-the-agent-uses-the-oauth-token \
		$python "$here/skillevaluator-oauth.py" tier3 evaluate "$stage" --agents claude-code --env-mode docker "$@"
fi
