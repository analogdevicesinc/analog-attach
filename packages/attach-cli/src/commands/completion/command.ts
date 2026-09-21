import { Command } from "commander";

import type { LocalContext } from "../../context";
import { FILES_DIRECTIVE, DIRS_DIRECTIVE } from "./spec";

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
    local cur
    cur="\${COMP_WORDS[COMP_CWORD]}"

    local IFS=$'\\n'
    local -a lines
    lines=( $(attach-linux __complete -- "\${COMP_WORDS[@]:1:COMP_CWORD-1}" "$cur" 2>/dev/null) )

    case "\${lines[0]}" in
        ${FILES_DIRECTIVE}) _attach_linux_filedir; return ;;
        ${DIRS_DIRECTIVE})  _attach_linux_filedir -d; return ;;
    esac

    # bash has no per-candidate descriptions; drop any "\\tdescription" tail.
    local -a values
    local line
    for line in "\${lines[@]}"; do
        values+=( "\${line%%$'\\t'*}" )
    done
    COMPREPLY=( $(compgen -W "\${values[*]}" -- "$cur") )
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

    # The slice is intentionally unquoted: a quoted empty range would inject a
    # spurious empty argument (breaking command-name completion), whereas the
    # words here never contain spaces.
    local -a raw
    raw=( \${(f)"$(attach-linux __complete -- \${words[2,$((CURRENT-1))]} "$cur" 2>/dev/null)"} )

    case "\${raw[1]}" in
        ${FILES_DIRECTIVE}) _files; return ;;
        ${DIRS_DIRECTIVE})  _files -/; return ;;
    esac

    # Each line is "value" or "value<TAB>description"; _describe wants "value:description".
    local -a described
    local line
    for line in "\${raw[@]}"; do
        described+=( "\${line/$'\\t'/:}" )
    done
    _describe -t attach-linux 'attach-linux' described
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
        end
    end
    for line in $out
        printf '%s\\n' $line
    end
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
