# Bash completion for aa (Analog Attach CLI)
# Install: aa completion install [--user]
#
# Requires an `aa` that provides `aa complete` (0.1.0+). If you upgrade aa while a
# shell is open, re-source this file — an older cached copy calls a flag that no
# longer exists and silently completes nothing.

_aa_complete() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    local completions

    # aa complete <route> <partial> [prior tokens...] — the same entrypoint
    # attach-meta uses. The route is the first non-flag word; the words between it
    # and the cursor are the prior tokens that give parameter hooks their context.
    #
    # Flags after the route must stay in the token list. A flag's value completion is
    # reached only by handing stricli the flag itself as the preceding word, so
    # dropping it turns `--template-set <TAB>` into a bare `generate <TAB>` and
    # proposes flag names instead of the set names. Positional hooks are unaffected:
    # prior_positionals() in src/completion/completion.ts filters flags out again.
    local route=""
    local tokens=()
    local index
    for (( index = 1; index < COMP_CWORD; index++ )); do
        local word="${COMP_WORDS[index]}"
        if [[ -z "$route" ]]; then
            # Anything before the route is a global flag such as --workfile; skip it.
            [[ "$word" == -* ]] && continue
            route="$word"
        else
            # COMP_WORDBREAKS splits `--flag=value` into three words, leaving a bare
            # `=` that stricli would read as a positional.
            [[ "$word" == "=" ]] && continue
            tokens+=("$word")
        fi
    done

    completions=$(aa complete "${route}" "${cur}" "${tokens[@]}" 2>/dev/null)

    COMPREPLY=($(compgen -W "${completions}" -- "${cur}"))
}

# -o nosort preserves the order emitted by `aa complete` (workfile values and
# command names first, --flags last) instead of bash re-sorting alphabetically.
complete -o nosort -F _aa_complete aa
