# Bash completion for aa (Analog Attach CLI)
# Install: copy to /etc/bash_completion.d/aa or source directly

_aa_complete() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    local completions

    # Call aa with --complete flag, passing the current command line
    completions=$(aa --complete "${COMP_LINE}" 2>/dev/null)

    # Convert completions to array and set COMPREPLY
    COMPREPLY=($(compgen -W "${completions}" -- "${cur}"))
}

# -o nosort preserves the order emitted by `aa --complete` (workfile values and
# command names first, --flags last) instead of bash re-sorting alphabetically.
complete -o nosort -F _aa_complete aa
