# bash completion for attach-linux
#
# Enable with:  source <(attach-linux completion bash)

_attach_linux_suggest() {
    # Emits one candidate per line from the CLI's JSON `suggest` protocol.
    attach-linux --json suggest "$@" 2>/dev/null \
        | grep -o '"value":"[^"]*"' \
        | sed 's/"value":"//;s/"$//'
}

# Populate COMPREPLY from a newline-separated candidate list, filtered by $cur.
_attach_linux_complete() {
    local IFS=$'\n'
    COMPREPLY=( $(compgen -W "$1" -- "$cur") )
}

# Complete a file (default) or directory (-d) argument, preferring
# bash-completion's _filedir when it is available.
_attach_linux_filedir() {
    if declare -F _filedir >/dev/null 2>&1; then
        if [[ "$1" == "-d" ]]; then _filedir -d; else _filedir; fi
        return
    fi
    local IFS=$'\n'
    if [[ "$1" == "-d" ]]; then
        COMPREPLY=( $(compgen -d -- "$cur") )
    else
        COMPREPLY=( $(compgen -f -- "$cur") )
    fi
    if [[ ${#COMPREPLY[@]} -gt 0 ]] && type compopt &>/dev/null; then
        compopt -o filenames
    fi
}

# The compatible key `add` is operating on: first positional after `add`.
_attach_linux_parents() {
    local key="" skip=0 i w
    for (( i = 1; i < COMP_CWORD; i++ )); do
        w="${COMP_WORDS[i]}"
        if (( skip )); then skip=0; continue; fi
        case "$w" in
            add|--json) ;;
            --name|--to|--label|--overlay|--context|--linux|--dt-schema) skip=1 ;;
            --*) ;;
            *) [[ -n "$w" ]] && { key="$w"; break; } ;;
        esac
    done
    [[ -z "$key" ]] && return
    _attach_linux_suggest parent "$key"
}

# The path segments already typed for read/update/delete, excluding the word
# currently being completed.
_attach_linux_navigate() {
    local segments=() skip=0 i w
    for (( i = 1; i < COMP_CWORD; i++ )); do
        w="${COMP_WORDS[i]}"
        if (( skip )); then skip=0; continue; fi
        case "$w" in
            update|read|delete|--json) ;;
            --with|--overlay|--context|--linux|--dt-schema) skip=1 ;;
            --*) ;;
            *) [[ -n "$w" ]] && segments+=("$w") ;;
        esac
    done
    _attach_linux_suggest navigate "${segments[@]}"
}

# config-set takes <field> <value>; complete fields first, then a file path.
_attach_linux_config_set() {
    local count=0 seen=0 i w
    for (( i = 1; i < COMP_CWORD; i++ )); do
        w="${COMP_WORDS[i]}"
        case "$w" in
            --json) ;;
            config-set) seen=1 ;;
            -*) ;;
            *) (( seen )) && (( count++ )) ;;
        esac
    done
    if (( count == 0 )); then
        COMPREPLY=( $(compgen -W "linux dt-schema context overlay" -- "$cur") )
    else
        _attach_linux_filedir
    fi
}

_attach_linux() {
    local cur prev cmd i w
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"

    local commands="attach-manifest config-get config-set create-workfile \
list-devices add read update delete validate validate2 move rename \
list-intelligence suggest build deploy get-schema enable disable \
install-skill uninstall-skill completion"

    # Locate the subcommand: the first non-flag word after argv[0].
    cmd=""
    for (( i = 1; i < COMP_CWORD; i++ )); do
        w="${COMP_WORDS[i]}"
        case "$w" in
            --json|-h|--help|-v|--version) ;;
            -*) ;;
            *) cmd="$w"; break ;;
        esac
    done

    # No subcommand yet: complete command names or global flags.
    if [[ -z "$cmd" ]]; then
        if [[ "$cur" == -* ]]; then
            COMPREPLY=( $(compgen -W "--json --help --version" -- "$cur") )
        else
            COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
        fi
        return
    fi

    # Option values that mean the same thing across every command.
    case "$prev" in
        --overlay|--context|--dtbo) _attach_linux_filedir; return ;;
        --linux|--dt-schema)        _attach_linux_filedir -d; return ;;
    esac

    # Command-specific option values (dynamic suggestions).
    case "$cmd" in
        add)
            [[ "$prev" == "--to" ]] && { _attach_linux_complete "$(_attach_linux_parents)"; return; } ;;
        get-schema)
            [[ "$prev" == "--compatible" ]] && { _attach_linux_complete "$(_attach_linux_suggest device-key "$cur")"; return; } ;;
    esac

    # Flags for the current command.
    if [[ "$cur" == -* ]]; then
        local flags=""
        case "$cmd" in
            add)              flags="--name --to --label --overlay --context --linux --dt-schema" ;;
            create-workfile)  flags="--name" ;;
            read)             flags="--overlay --context" ;;
            update)           flags="--with --overlay --context --linux --dt-schema" ;;
            delete)           flags="--overlay --context --force" ;;
            validate|validate2) flags="--overlay --linux --dt-schema --context" ;;
            move|rename)      flags="--to --overlay --context" ;;
            enable|disable)   flags="--node --overlay --context" ;;
            get-schema)       flags="--compatible --context --linux --dt-schema" ;;
            build)            flags="--overlay --build-command" ;;
            deploy)           flags="--dtbo --ip --user --password" ;;
            list-devices)     flags="--includes-word" ;;
        esac
        COMPREPLY=( $(compgen -W "$flags --help" -- "$cur") )
        return
    fi

    # Positional arguments.
    case "$cmd" in
        add)                _attach_linux_complete "$(_attach_linux_suggest device-key "$cur")" ;;
        read|update|delete) _attach_linux_complete "$(_attach_linux_navigate)" ;;
        completion)         COMPREPLY=( $(compgen -W "bash fish zsh" -- "$cur") ) ;;
        config-get)         COMPREPLY=( $(compgen -W "linux dt-schema context overlay" -- "$cur") ) ;;
        config-set)         _attach_linux_config_set ;;
    esac
}

complete -F _attach_linux attach-linux
