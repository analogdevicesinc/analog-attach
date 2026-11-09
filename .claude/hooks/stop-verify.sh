#!/usr/bin/env bash
# Stop hook: block "done" while the changed side of attach-lib / attach-no-os-lib / the CLI fails verify.
# Skips when nothing in those packages changed since the last passing run.
#
# Which verify (scripts/verify.sh) runs is chosen by what changed:
#   only the Linux side (attach-lib, the CLI's src/backends/linux/)       --linux
#   only the no-OS side (attach-no-os-lib, the CLI's src/backends/noos/)  --no-os
#   anything else, or both sides                                          everything
# The spec's prose (packages/cli/docs/, but its 04-protocol schemas, which the contract test reads) is read by no build
# or test, so it chooses nothing; when only it changed, nothing runs.
cd "$(dirname "$0")/../.." || exit 0

input=$(cat)
# Already continuing because of this hook: don't loop.
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac

paths=(packages/attach-lib packages/attach-no-os-lib packages/cli scripts)
[ -z "$(git status --porcelain -- "${paths[@]}")" ] && exit 0

linux=false noos=false common=false
while IFS= read -r file; do
    case "$file" in
        packages/attach-lib/*|packages/cli/src/backends/linux/*) linux=true ;;
        packages/attach-no-os-lib/*|packages/cli/src/backends/noos/*) noos=true ;;
        packages/cli/docs/spec/04-protocol/*) common=true ;;
        packages/cli/docs/*) ;;
        *) common=true ;;
    esac
done < <({ git diff --name-only HEAD -- "${paths[@]}"; git ls-files -o --exclude-standard -- "${paths[@]}"; } | sort -u)

if $common || { $linux && $noos; }; then mode=(); name="yarn verify"
elif $linux; then mode=(--linux); name="yarn verify:linux"
elif $noos; then mode=(--no-os); name="yarn verify:no-os"
else exit 0
fi

stamp=$(git diff HEAD -- "${paths[@]}" | cat - <(git ls-files -o --exclude-standard -- "${paths[@]}" | xargs -r cat) | sha1sum | cut -d' ' -f1)
cache=.claude/.verify-pass
[ -f "$cache" ] && [ "$(cat "$cache")" = "$stamp" ] && exit 0

if out=$(scripts/verify.sh "${mode[@]}" 2>&1); then
  echo "$stamp" > "$cache"
  exit 0
fi
{
  echo "$name failed. Fix this before finishing:"
  echo "$out" | tail -60
} >&2
exit 2
