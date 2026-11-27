#!/usr/bin/env bash
# Check the grader against the cases, in the eval's image (no agent, no model):
#
#   test-grader.sh [<image>] [<case>...]
#
# For each case, in a fresh container: the reference solution (solutions.sh) must score 1.0, and
# the untouched start must score less (a grader that passes anything fails here). The image is
# the one run.sh --prepare-only stages, built with
#   docker build -t aa-skill-eval .stage/worktree/analog-attach-linux/evals/environment
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
evals="$here/../evals"
image="${1:-aa-skill-eval}"
shift || true
mapfile -t cases < <(python3 -c 'import json,sys; [print(e["id"]) for e in json.load(open(sys.argv[1]))["evals"]]' "$evals/evals.json")
[ $# -gt 0 ] && cases=("$@")

# score <case> <solve: 1 or 0>: the overall the grader gives, in a fresh container.
score() {
	docker run --rm -v "$evals/grader.py:/grader.py:ro" -v "$here/solutions.sh:/solutions.sh:ro" "$image" bash -c '
		set -e
		mkdir -p /tests /logs/verifier /logs/agent
		printf "{\"id\": \"%s\"}" "$1" >/tests/entry.json
		if [ "$2" = 1 ]; then . /solutions.sh; "solve_${1//-/_}" >/tmp/solve.log 2>&1 || { cat /tmp/solve.log >&2; exit 1; }; fi
		python3 /grader.py >/tmp/grade.log 2>&1 || { cat /tmp/grade.log >&2; exit 1; }
		cat /logs/verifier/reward.json' _ "$1" "$2"
}

failed=0
for case in "${cases[@]}"; do
	solved="$(score "$case" 1)" || { echo "FAIL $case: the solution or the grader broke"; failed=1; continue; }
	start="$(score "$case" 0)" || { echo "FAIL $case: the grader broke on the start"; failed=1; continue; }
	good="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["overall"])' "$solved")"
	bad="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["overall"])' "$start")"
	if [ "$good" != 1.0 ]; then
		echo "FAIL $case: the solution scores $good"
		python3 -c 'import json,sys; [print("    ", k, v["reason"]) for k, v in json.loads(sys.argv[1])["details"].items() if v["score"] < 1]' "$solved"
		failed=1
	elif python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) >= 1 else 1)' "$bad"; then
		echo "FAIL $case: the untouched start scores $bad too"
		failed=1
	else
		echo "ok   $case (solution 1.0, start $bad)"
	fi
done
exit "$failed"
