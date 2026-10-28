# Fish completion for attach-noos (Analog Attach CLI)
# Print: attach-noos completion fish    Install: attach-noos completion fish --install
#
# Every list comes from `attach-noos complete <route> <partial> [prior tokens...]`, the same
# entry point the bash and zsh scripts call, so the three shells offer the same thing.

function __attach_noos_complete
    set -l words (commandline -opc)
    set -l cur (commandline -ct)
    # The first word is attach-noos itself.
    set -e words[1]

    # The route is the first non-flag word; the words between it and the cursor are the
    # prior tokens that give parameter hooks their context. Flags stay in the tokens: a
    # flag's value completion is reached only with the flag as the preceding word.
    set -l route ""
    set -l tokens
    for word in $words
        if test -z "$route"
            string match -q -- '-*' $word; and continue
            set route $word
        else
            set -a tokens $word
        end
    end

    attach-noos complete "$route" "$cur" $tokens 2>/dev/null
end

# -f: what attach-noos proposes, not file names; -k: keep its order (values, then flags).
complete -c attach-noos -f -k -a '(__attach_noos_complete)'
