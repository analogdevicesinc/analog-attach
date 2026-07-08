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

complete -F _aa_complete aa
