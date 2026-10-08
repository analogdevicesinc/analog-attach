import { Command } from "commander";

import type { LocalContext } from "../../context";
import { FILES_DIRECTIVE, DIRS_DIRECTIVE, NOSPACE_DIRECTIVE } from "./spec";

// The completion scripts are thin stubs: on every TAB press they hand the
// words typed so far to `attach-linux __complete` and render whatever it prints
// (see `complete.ts`). All grammar lives in the engine, so these stubs never
// change when commands or flags are added.

function bash_stub(): string {
    return `# bash completion for attach-linux
#
# Enable with:  source <(attach-linux completion bash)

_attach_linux_filedir() {
    if declare -F _filedir >/dev/null 2>&1; then
        if [[ "$1" == "-d" ]]; then _filedir -d; else _filedir; fi
        return
    fi
    local IFS=$'\\n'
    if [[ "$1" == "-d" ]]; then
        COMPREPLY=( $(compgen -d -- "$cur") )
    else
        COMPREPLY=( $(compgen -f -- "$cur") )
    fi
    if [[ \${#COMPREPLY[@]} -gt 0 ]] && type compopt &>/dev/null; then
        compopt -o filenames
    fi
}

_attach_linux_complete() {
    # Rebuild words from COMP_LINE so COMP_WORDBREAKS (@:=) doesn't split
    # path tokens like spi0/adi,ad7124-8@2 into pieces.
    local line_to_point="\${COMP_LINE:0:COMP_POINT}"
    local -a words_arr
    read -ra words_arr <<< "$line_to_point"
    local n=\${#words_arr[@]}
    # If the line ends in a space the cursor is on a new empty word.
    local cur
    if [[ "$line_to_point" =~ [[:space:]]$ ]]; then
        cur=""
    else
        cur="\${words_arr[$((n-1))]}"
        n=$((n-1))
    fi
    # Drop the program name (words_arr[0]) and pass the rest as committed.
    local -a committed=( "\${words_arr[@]:1:n-1}" )

    local IFS=$'\\n'
    local -a lines
    lines=( $(attach-linux __complete -- "\${committed[@]}" "$cur" 2>/dev/null) )

    case "\${lines[0]}" in
        ${FILES_DIRECTIVE}) _attach_linux_filedir; return ;;
        ${DIRS_DIRECTIVE})  _attach_linux_filedir -d; return ;;
    esac

    local nospace=false
    if [[ "\${lines[0]}" == "${NOSPACE_DIRECTIVE}" ]]; then
        nospace=true
        lines=( "\${lines[@]:1}" )
    fi

    local -a values
    local line value
    for line in "\${lines[@]}"; do
        value="\${line%%$'\\t'*}"
        if [[ "$cur" != '"'* && "$cur" != "'"* && "$value" == *" "* ]]; then
            printf -v value '%q' "$value"
        fi
        values+=( "$value" )
    done
    # Trim candidates to match bash's COMP_WORDBREAKS-split current word.
    # Without this, a candidate "spi0/adi,ad7124-8@2" would be inserted as
    # "spi0/adi,ad7124-8@spi0/adi,ad7124-8@2" because bash thinks the word
    # starts after the last "@".
    local bash_cur="\${COMP_WORDS[COMP_CWORD]}"
    if [[ "$bash_cur" != "$cur" && -n "$bash_cur" ]]; then
        local prefix="\${cur%"$bash_cur"}"
        local -a trimmed
        for v in "\${values[@]}"; do
            trimmed+=( "\${v#"$prefix"}" )
        done
        values=( "\${trimmed[@]}" )
    fi
    COMPREPLY=( "\${values[@]}" )
    if $nospace && type compopt &>/dev/null; then
        compopt -o nospace
    fi
}

complete -F _attach_linux_complete attach-linux
`;
}

function zsh_stub(): string {
    return `#compdef attach-linux
#
# Enable with:  source <(attach-linux completion zsh)
# or install to a directory on $fpath as \`_attach-linux\`.

# Named to match the command (and the conventional autoload file name
# \`_attach-linux\`) so the funcstack guard below fires on the first TAB whether
# this file is sourced or autoloaded from $fpath.
_attach-linux() {
    local cur
    cur="\${words[CURRENT]}"

    # Build committed words as individually quoted arguments so @ and other
    # glob characters in paths like spi0/adi,ad7124-8@2 are not expanded.
    local -a committed
    local i
    for (( i=2; i < CURRENT; i++ )); do
        committed+=( "\${words[i]}" )
    done
    local -a raw
    raw=( \${(f)"$(attach-linux __complete -- "\${committed[@]}" "$cur" 2>/dev/null)"} )

    case "\${raw[1]}" in
        ${FILES_DIRECTIVE}) _files; return ;;
        ${DIRS_DIRECTIVE})  _files -/; return ;;
    esac

    local nospace=false
    if [[ "\${raw[1]}" == "${NOSPACE_DIRECTIVE}" ]]; then
        nospace=true
        shift raw
    fi

    local -a described
    local line
    for line in "\${raw[@]}"; do
        described+=( "\${line/$'\\t'/:}" )
    done
    if $nospace; then
        _describe -t attach-linux 'attach-linux' described -S ''
    else
        _describe -t attach-linux 'attach-linux' described
    fi
}

# Works both ways: when autoloaded from $fpath the function is invoked inside a
# completion context (funcstack[1] is the function itself), so run it; when the
# file is sourced directly it is not, so register it with compdef instead of
# calling it (a direct call errors and completes nothing).
if [[ "\$funcstack[1]" == "_attach-linux" ]]; then
    _attach-linux "$@"
else
    compdef _attach-linux attach-linux
fi
`;
}

function fish_stub(): string {
    return `# fish completion for attach-linux
#
# Enable with:  attach-linux completion fish | source
# or install to ~/.config/fish/completions/attach-linux.fish

function __attach_linux_complete
    set -l tokens (commandline -opc)
    set -l cur (commandline -ct)
    set -e tokens[1]
    set -l out (attach-linux __complete -- $tokens "$cur" 2>/dev/null)
    if test (count $out) -gt 0
        switch $out[1]
            case ${FILES_DIRECTIVE}
                __fish_complete_path "$cur"
                return
            case ${DIRS_DIRECTIVE}
                __fish_complete_directories "$cur"
                return
            case ${NOSPACE_DIRECTIVE}
                set -e out[1]
        end
    end
    printf '%s\\n' $out
end

complete -c attach-linux -f -a '(__attach_linux_complete)'
`;
}

const STUBS: Record<string, () => string> = {
    bash: bash_stub,
    fish: fish_stub,
    zsh: zsh_stub,
};

export function build_completion_command(_context: LocalContext): Command {
    return new Command("completion")
        .description("Generate shell completion script")
        .argument("<shell>", "Shell to generate completions for (bash, fish, zsh)")
        .action((shell: string) => {
            const stub = STUBS[shell];
            if (stub === undefined) {
                console.error(`Unknown shell: ${shell}. Supported: ${Object.keys(STUBS).join(", ")}`);
                return;
            }
            console.log(stub());
        });
}
