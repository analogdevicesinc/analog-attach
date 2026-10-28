import { Command, Option } from "commander";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { LocalContext } from "../../context";
import { FILES_DIRECTIVE, DIRS_DIRECTIVE, NOSPACE_DIRECTIVE, GROUP_DIRECTIVE } from "./spec";

// The completion scripts are thin stubs: on every TAB press they hand the
// words typed so far to `attach-linux __complete` and render whatever it prints
// (see `complete.ts`). All grammar lives in the engine, so these stubs never
// change when commands or flags are added.

function bash_stub(): string {
    return `# bash completion for attach-linux
#
# Enable with:  source <(attach-linux completion bash)
# or install with:  attach-linux completion bash --install

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
        [[ "$line" == ${GROUP_DIRECTIVE}* ]] && continue
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
# or install to a directory on $fpath as \`_attach-linux\` (attach-linux completion zsh --install).

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

    # Each group (after a ${GROUP_DIRECTIVE} line) is listed apart, under its heading.
    local -a described suffix
    $nospace && suffix=( -S '' )
    local line heading=""
    local -i group=0 ret=1
    for line in "\${raw[@]}" "${GROUP_DIRECTIVE}"; do
        if [[ "$line" == ${GROUP_DIRECTIVE}* ]]; then
            if (( \${#described} )); then
                if [[ -n "$heading" ]]; then
                    _describe -t "attach-linux-$group" "$heading" described "\${suffix[@]}" -V "attach-linux-$group" -X "%B$heading%b" && ret=0
                else
                    _describe -t attach-linux 'attach-linux' described "\${suffix[@]}" && ret=0
                fi
            fi
            described=()
            heading="\${line#*$'\\t'}"
            [[ "$heading" == "$line" ]] && heading=""
            group+=1
            continue
        fi
        described+=( "\${line/$'\\t'/:}" )
    done
    return ret
}

# One line per candidate, in the engine's order (zsh's grouped listing would
# put names that share a description on one line, reversed). Kept when the
# user has set the style for attach-linux.
if [[ -z "$(zstyle -L ':completion:*:*:attach-linux:*' list-grouped)" ]]; then
    zstyle ':completion:*:*:attach-linux:*' list-grouped false
fi

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
# or install to ~/.config/fish/completions/attach-linux.fish (attach-linux completion fish --install)

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
    string match -v -- '${GROUP_DIRECTIVE}*' $out
end

complete -c attach-linux -f -a '(__attach_linux_complete)'
`;
}

const STUBS: Record<string, () => string> = {
    bash: bash_stub,
    fish: fish_stub,
    zsh: zsh_stub,
};

/** The completion script for a shell, or undefined for a shell it doesn't support. */
export function completion_script(shell: string): string | undefined {
    return STUBS[shell]?.();
}

/** The shell `$SHELL` names (`/usr/bin/zsh` → `zsh`), when it is one of the supported ones. */
export function shell_from_environment(environment: NodeJS.ProcessEnv = process.env): string | undefined {
    const name = path.basename(environment["SHELL"] ?? "");
    return name in STUBS ? name : undefined;
}

/** Where `--install` puts the script: a directory of the user's that the shell loads completions from by itself (zsh's needs adding to fpath). */
export function install_path(shell: string, environment: NodeJS.ProcessEnv = process.env): string {
    const home = environment["HOME"] ?? os.homedir();
    const data = environment["XDG_DATA_HOME"] ?? path.join(home, ".local", "share");
    const config = environment["XDG_CONFIG_HOME"] ?? path.join(home, ".config");
    switch (shell) {
        case "bash": { return path.join(data, "bash-completion", "completions", "attach-linux"); }
        case "fish": { return path.join(config, "fish", "completions", "attach-linux.fish"); }
        default: { return path.join(data, "zsh", "site-functions", "_attach-linux"); }
    }
}

/** What to do after installing for `shell`, so the script loads. */
function install_note(shell: string, file: string): string[] {
    switch (shell) {
        case "bash": { return ["It loads in new shells, through the bash-completion package."]; }
        case "fish": { return ["It loads in new shells."]; }
        default: {
            return [
                "Add its directory to fpath in ~/.zshrc, before compinit, then start a new shell:",
                `  fpath=(${path.dirname(file)} $fpath)`,
            ];
        }
    }
}

/** Write the script for `shell` to its install path, replacing an earlier one. Returns the lines to print. */
export function install_completion(shell: string, environment: NodeJS.ProcessEnv = process.env): string[] {
    const file = install_path(shell, environment);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${STUBS[shell]?.() ?? ""}\n`);
    return [`Installed ${shell} completion to ${file}`, ...install_note(shell, file)];
}

/** Remove the script `install_completion` wrote for `shell`. Returns the lines to print. */
export function uninstall_completion(shell: string, environment: NodeJS.ProcessEnv = process.env): string[] {
    const file = install_path(shell, environment);
    if (!fs.existsSync(file)) { return [`${shell} completion is not installed (no ${file})`]; }
    fs.rmSync(file);
    return [`Removed ${file}`, ...(shell === "zsh" ? ["Remove its fpath line from ~/.zshrc if you added one."] : [])];
}

export function build_completion_command(_context: LocalContext): Command {
    return new Command("completion")
        .description("Print the shell completion script, or install it")
        .argument("[shell]", "Shell to complete for (bash, fish, zsh); default: the one $SHELL names")
        .addOption(new Option("--install", "Install the script where the shell loads it (in your home directory)").conflicts("uninstall"))
        .addOption(new Option("--uninstall", "Remove the installed script"))
        .addHelpText("after", `
--install writes the script to a directory of yours that the shell loads
completions from by itself, replacing an earlier one:
  bash  ~/.local/share/bash-completion/completions/attach-linux (needs bash-completion)
  fish  ~/.config/fish/completions/attach-linux.fish
  zsh   ~/.local/share/zsh/site-functions/_attach-linux (add the directory to fpath)
It never edits a shell startup file.

Examples:
  $ source <(attach-linux completion bash)
  $ attach-linux completion fish | source
  $ attach-linux completion --install
  $ attach-linux completion zsh --uninstall`)
        .action((shell: string | undefined, options: { install?: boolean; uninstall?: boolean }) => {
            const chosen = shell ?? shell_from_environment();
            if (chosen === undefined) {
                console.error(`Cannot tell the shell from $SHELL (${process.env["SHELL"] ?? "not set"}). Name one: ${Object.keys(STUBS).join(", ")}`);
                return;
            }
            const stub = STUBS[chosen];
            if (stub === undefined) {
                console.error(`Unknown shell: ${chosen}. Supported: ${Object.keys(STUBS).join(", ")}`);
                return;
            }
            if (options.install === true || options.uninstall === true) {
                const lines = options.install === true ? install_completion(chosen) : uninstall_completion(chosen);
                for (const line of lines) { console.log(line); }
                return;
            }
            console.log(stub());
        });
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test("shell_from_environment — the base name of $SHELL when it is a supported shell", () => {
        expect(shell_from_environment({ SHELL: "/usr/bin/zsh" })).toBe("zsh");
        expect(shell_from_environment({ SHELL: "/bin/bash" })).toBe("bash");
        expect(shell_from_environment({ SHELL: "/bin/sh" })).toBeUndefined();
        expect(shell_from_environment({})).toBeUndefined();
    });

    test("install_path — the user's autoload directories, XDG variables first", () => {
        expect(install_path("bash", { HOME: "/h" })).toBe("/h/.local/share/bash-completion/completions/attach-linux");
        expect(install_path("fish", { HOME: "/h" })).toBe("/h/.config/fish/completions/attach-linux.fish");
        expect(install_path("zsh", { HOME: "/h", XDG_DATA_HOME: "/d" })).toBe("/d/zsh/site-functions/_attach-linux");
    });

    test("install_completion / uninstall_completion — write the script, replace it, remove it", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "attach-completion-"));
        try {
            const environment = { HOME: home };
            const file = install_path("zsh", environment);
            expect(install_completion("zsh", environment)[0]).toBe(`Installed zsh completion to ${file}`);
            expect(install_completion("zsh", environment).join("\n")).toContain(`fpath=(${path.dirname(file)} $fpath)`);
            expect(fs.readFileSync(file, "utf8")).toBe(`${completion_script("zsh") ?? ""}\n`);
            expect(uninstall_completion("zsh", environment)[0]).toBe(`Removed ${file}`);
            expect(fs.existsSync(file)).toBe(false);
            expect(uninstall_completion("zsh", environment)).toEqual([`zsh completion is not installed (no ${file})`]);
        } finally {
            fs.rmSync(home, { recursive: true });
        }
    });
}
