#!/usr/bin/env bash
# Stop hook: block "done" while attach-lib / attach-no-os-lib / the CLI fail `yarn verify`.
# Skips when nothing in those packages changed since the last passing run.
cd "$(dirname "$0")/../.." || exit 0

input=$(cat)
# Already continuing because of this hook: don't loop.
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac

paths=(packages/attach-lib packages/attach-no-os-lib packages/cli scripts)
[ -z "$(git status --porcelain -- "${paths[@]}")" ] && exit 0

stamp=$(git diff HEAD -- "${paths[@]}" | cat - <(git ls-files -o --exclude-standard -- "${paths[@]}" | xargs -r cat) | sha1sum | cut -d' ' -f1)
cache=.claude/.verify-pass
[ -f "$cache" ] && [ "$(cat "$cache")" = "$stamp" ] && exit 0

if out=$(scripts/verify.sh 2>&1); then
  echo "$stamp" > "$cache"
  exit 0
fi
{
  echo "yarn verify failed. Fix this before finishing:"
  echo "$out" | tail -60
} >&2
exit 2
