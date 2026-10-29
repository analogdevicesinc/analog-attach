// The shell completion stubs and `completion [shell] [--install|--uninstall]`, ported from
// attach-cli's completion/command.ts. The stubs are thin: on every Tab they hand the words
// typed so far to `<program> __complete` and render what it prints (complete.ts), so they
// never change when commands, flags or backends are added.
//
// One change from attach-cli: a directive line (`FILES` / `DIRS`) may be followed by
// candidates, which the stub offers next to the shell's own file names (`Completion.fallback`,
// decision 12). A lone directive works as before.

import * as fs from "node:fs";
import path from "node:path";
import { answer, input_error, type Outcome } from "../interface/backend-interface";
import type { CommonResponse } from "../interface/backend-responses";
import type { FrontEnd, Route } from "./routes";

export const DIRECTIVE_PREFIX = "__ANALOG_ATTACH_COMPLETE_";
export const FILES_DIRECTIVE = `${DIRECTIVE_PREFIX}FILES__`;
export const DIRS_DIRECTIVE = `${DIRECTIVE_PREFIX}DIRS__`;
export const NOSPACE_DIRECTIVE = `${DIRECTIVE_PREFIX}NOSPACE__`;
/** Starts a group of candidates: `__ANALOG_ATTACH_COMPLETE_GROUP__<TAB><heading>`. zsh lists each group apart; bash and fish skip the line. */
export const GROUP_DIRECTIVE = `${DIRECTIVE_PREFIX}GROUP__`;

export const SHELLS = ["bash", "fish", "zsh"] as const;
export type Shell = (typeof SHELLS)[number];

/** `analog-attach` → `analog_attach`, for shell function names. */
function identifier(program: string): string {
    return program.replaceAll(/[^A-Za-z0-9_]/g, "_");
}

function bash_stub(program: string): string {
    const name = identifier(program);
    return `# bash completion for ${program}
#
# Enable with:  source <(${program} completion bash)
# or install with:  ${program} completion bash --install

_${name}_filedir() {
    if declare -F _filedir >/dev/null 2>&1; then
        if [[ "$1" == "-d" ]]; then _filedir -d; else _filedir; fi
        return
    fi
    local IFS=$'\\n'
    if [[ "$1" == "-d" ]]; then
        COMPREPLY+=( $(compgen -d -- "$cur") )
    else
        COMPREPLY+=( $(compgen -f -- "$cur") )
    fi
    if [[ \${#COMPREPLY[@]} -gt 0 ]] && type compopt &>/dev/null; then
        compopt -o filenames
    fi
}

_${name}_complete() {
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
    lines=( $(${program} __complete -- "\${committed[@]}" "$cur" 2>/dev/null) )

    # A directive first: the shell's own file or directory names, after any candidates.
    local fallback=""
    case "\${lines[0]}" in
        ${FILES_DIRECTIVE}) fallback="-f"; lines=( "\${lines[@]:1}" ) ;;
        ${DIRS_DIRECTIVE})  fallback="-d"; lines=( "\${lines[@]:1}" ) ;;
    esac
    COMPREPLY=()
    if [[ -n "$fallback" && \${#lines[@]} -eq 0 ]]; then
        _${name}_filedir "$fallback"
        return
    fi

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
    if [[ -n "$fallback" ]]; then
        _${name}_filedir "$fallback"
        COMPREPLY=( "\${values[@]}" "\${COMPREPLY[@]}" )
        return
    fi
    COMPREPLY=( "\${values[@]}" )
    if $nospace && type compopt &>/dev/null; then
        compopt -o nospace
    fi
}

complete -F _${name}_complete ${program}
`;
}

function zsh_stub(program: string): string {
    return `#compdef ${program}
#
# Enable with:  source <(${program} completion zsh)
# or install to a directory on $fpath as \`_${program}\` (${program} completion zsh --install).

# Named to match the command (and the conventional autoload file name
# \`_${program}\`) so the funcstack guard below fires on the first TAB whether
# this file is sourced or autoloaded from $fpath.
_${program}() {
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
    raw=( \${(f)"$(${program} __complete -- "\${committed[@]}" "$cur" 2>/dev/null)"} )

    # A directive first: the shell's own file or directory names, after any candidates.
    local fallback=""
    case "\${raw[1]}" in
        ${FILES_DIRECTIVE}) fallback=files; shift raw ;;
        ${DIRS_DIRECTIVE})  fallback=dirs; shift raw ;;
    esac
    if [[ -n "$fallback" ]] && (( \${#raw} == 0 )); then
        if [[ "$fallback" == dirs ]]; then _files -/; else _files; fi
        return
    fi

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
                    _describe -t "${program}-$group" "$heading" described "\${suffix[@]}" -V "${program}-$group" -X "%B$heading%b" && ret=0
                else
                    _describe -t ${program} '${program}' described "\${suffix[@]}" && ret=0
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
    if [[ "$fallback" == dirs ]]; then
        _files -/ && ret=0
    elif [[ "$fallback" == files ]]; then
        _files && ret=0
    fi
    return ret
}

# One line per candidate, in the engine's order (zsh's grouped listing would
# put names that share a description on one line, reversed). Kept when the
# user has set the style for ${program}.
if [[ -z "$(zstyle -L ':completion:*:*:${program}:*' list-grouped)" ]]; then
    zstyle ':completion:*:*:${program}:*' list-grouped false
fi

# Works both ways: when autoloaded from $fpath the function is invoked inside a
# completion context (funcstack[1] is the function itself), so run it; when the
# file is sourced directly it is not, so register it with compdef instead of
# calling it (a direct call errors and completes nothing).
if [[ "\$funcstack[1]" == "_${program}" ]]; then
    _${program} "$@"
else
    compdef _${program} ${program}
fi
`;
}

function fish_stub(program: string): string {
    const name = identifier(program);
    return `# fish completion for ${program}
#
# Enable with:  ${program} completion fish | source
# or install to ~/.config/fish/completions/${program}.fish (${program} completion fish --install)

function __${name}_complete
    set -l tokens (commandline -opc)
    set -l cur (commandline -ct)
    set -e tokens[1]
    set -l out (${program} __complete -- $tokens "$cur" 2>/dev/null)
    # A directive first: the shell's own file or directory names, after any candidates.
    set -l fallback
    if test (count $out) -gt 0
        switch $out[1]
            case ${FILES_DIRECTIVE}
                set fallback files
                set -e out[1]
            case ${DIRS_DIRECTIVE}
                set fallback dirs
                set -e out[1]
            case ${NOSPACE_DIRECTIVE}
                set -e out[1]
        end
    end
    if test (count $out) -gt 0
        string match -v -- '${GROUP_DIRECTIVE}*' $out
    end
    switch "$fallback"
        case files
            __fish_complete_path "$cur"
        case dirs
            __fish_complete_directories "$cur"
    end
end

complete -c ${program} -f -a '(__${name}_complete)'
`;
}

const STUBS: Readonly<Record<Shell, (program: string) => string>> = { bash: bash_stub, fish: fish_stub, zsh: zsh_stub };

function is_shell(name: string): name is Shell {
    return (SHELLS as readonly string[]).includes(name);
}

/** The completion script for a shell, or undefined for a shell it doesn't support. */
export function completion_script(shell: string, program: string): string | undefined {
    return is_shell(shell) ? STUBS[shell](program) : undefined;
}

export type Environment = Readonly<Record<string, string | undefined>>;

/** The shell `$SHELL` names (`/usr/bin/zsh` → `zsh`), when it is one of the supported ones. */
export function shell_from_environment(environment: Environment): Shell | undefined {
    const name = path.basename(environment["SHELL"] ?? "");
    return is_shell(name) ? name : undefined;
}

/** Where `--install` puts the script: a directory of the user's that the shell loads completions from by itself (zsh's needs adding to fpath). */
export function install_path(shell: Shell, program: string, home: string, environment: Environment): string {
    const absolute = (value: string | undefined): string | undefined => value !== undefined && path.isAbsolute(value) ? value : undefined;
    const data = absolute(environment["XDG_DATA_HOME"]) ?? path.join(home, ".local", "share");
    const config = absolute(environment["XDG_CONFIG_HOME"]) ?? path.join(home, ".config");
    switch (shell) {
        case "bash": { return path.join(data, "bash-completion", "completions", program); }
        case "fish": { return path.join(config, "fish", "completions", `${program}.fish`); }
        case "zsh": { return path.join(data, "zsh", "site-functions", `_${program}`); }
    }
}

/** What to do after installing for `shell`, so the script loads. */
function install_note(shell: Shell, file: string): string[] {
    switch (shell) {
        case "bash": { return ["It loads in new shells, through the bash-completion package."]; }
        case "fish": { return ["It loads in new shells."]; }
        case "zsh": {
            return [
                "Add its directory to fpath in ~/.zshrc, before compinit, then start a new shell:",
                `  fpath=(${path.dirname(file)} $fpath)`,
            ];
        }
    }
}

export interface CompletionPlace {
    program: string;
    home: string;
    environment: Environment;
}

/** Write the script for `shell` to its install path, replacing an earlier one. Returns the lines to print. */
export function install_completion(shell: Shell, place: CompletionPlace): string[] {
    const file = install_path(shell, place.program, place.home, place.environment);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${STUBS[shell](place.program)}\n`);
    return [`Installed ${shell} completion to ${file}`, ...install_note(shell, file)];
}

/** Remove the script `install_completion` wrote for `shell`. Returns the lines to print. */
export function uninstall_completion(shell: Shell, place: CompletionPlace): string[] {
    const file = install_path(shell, place.program, place.home, place.environment);
    if (!fs.existsSync(file)) { return [`${shell} completion is not installed (no ${file})`]; }
    fs.rmSync(file);
    return [`Removed ${file}`, ...(shell === "zsh" ? ["Remove its fpath line from ~/.zshrc if you added one."] : [])];
}

export interface CompletionResponse extends CommonResponse {
    /** The script, when it is printed rather than installed. */
    script?: string;
}

/**
 * `completion [shell] [--install|--uninstall]`. A shell it doesn't know, or can't tell from
 * `$SHELL`, is an input error (attach-cli's CO-6 fix). The script is the text; under
 * `--json` it is the response's `script`.
 */
export function run_completion(shell: string | undefined, options: { install: boolean; uninstall: boolean }, place: CompletionPlace): Outcome<CompletionResponse> {
    if (options.install && options.uninstall) { return input_error("option '--install' cannot be used with option '--uninstall'"); }
    const chosen = shell ?? shell_from_environment(place.environment);
    if (chosen === undefined) {
        return input_error(`Cannot tell the shell from $SHELL (${place.environment["SHELL"] ?? "not set"}). Name one: ${SHELLS.join(", ")}`);
    }
    if (!is_shell(chosen)) { return input_error(`Unknown shell: ${chosen}. Supported: ${SHELLS.join(", ")}`); }
    if (options.install || options.uninstall) {
        const lines = options.install ? install_completion(chosen, place) : uninstall_completion(chosen, place);
        return answer({ ok: true, message: lines.join("\n"), severity: "info" }, lines.join("\n"));
    }
    const script = STUBS[chosen](place.program);
    return answer({ ok: true, message: `${chosen} completion script`, severity: "info", script }, script);
}

/** The `completion` route. */
export function completion_route(front: FrontEnd): Route {
    const place: CompletionPlace = { program: front.program, home: front.home, environment: front.environment };
    return {
        path: ["completion"],
        brief: "Print the shell completion script, or install it",
        full: `Print the shell completion script, or install it.

--install writes the script to a directory of yours that the shell loads
completions from by itself, replacing an earlier one:
  bash  ~/.local/share/bash-completion/completions/${front.program} (needs bash-completion)
  fish  ~/.config/fish/completions/${front.program}.fish
  zsh   ~/.local/share/zsh/site-functions/_${front.program} (add the directory to fpath)
It never edits a shell startup file.`,
        examples: ["completion bash", "completion --install", "completion zsh --uninstall"],
        group: "tooling",
        positionals: [{ name: "shell", placeholder: "shell", brief: `Shell to complete for (${SHELLS.join(", ")}); default: the one $SHELL names`, optional: true }],
        flags: {
            install: { kind: "boolean", brief: "Install the script where the shell loads it (in your home directory)" },
            uninstall: { kind: "boolean", brief: "Remove the installed script" },
        },
        asks: false,
        supported: true,
        run: input => Promise.resolve(run_completion(
            typeof input.positionals["shell"] === "string" ? input.positionals["shell"] : undefined,
            { install: input.flags["install"] === true, uninstall: input.flags["uninstall"] === true },
            place,
        )),
        complete: index => Promise.resolve(index === 0 ? { candidates: SHELLS.map(shell => ({ value: shell })) } : undefined),
    };
}

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;
    const os = await import("node:os");

    test("shell_from_environment - the base name of $SHELL when it is a supported shell", () => {
        expect(shell_from_environment({ SHELL: "/usr/bin/zsh" })).toBe("zsh");
        expect(shell_from_environment({ SHELL: "/bin/bash" })).toBe("bash");
        expect(shell_from_environment({ SHELL: "/bin/sh" })).toBeUndefined();
        expect(shell_from_environment({})).toBeUndefined();
    });

    test("install_path - the user's autoload directories, XDG variables first", () => {
        expect(install_path("bash", "analog-attach", "/h", {})).toBe("/h/.local/share/bash-completion/completions/analog-attach");
        expect(install_path("fish", "analog-attach", "/h", {})).toBe("/h/.config/fish/completions/analog-attach.fish");
        expect(install_path("zsh", "analog-attach", "/h", { XDG_DATA_HOME: "/d" })).toBe("/d/zsh/site-functions/_analog-attach");
    });

    test("the stubs name the program, use the renamed directives and keep zsh's list-grouped", () => {
        for (const shell of SHELLS) {
            const script = completion_script(shell, "analog-attach")!;
            expect(script).toContain("analog-attach __complete -- ");
            expect(script).not.toContain("attach-linux");
            expect(script).not.toContain("__ATTACH_COMPLETE");
            expect(script).toContain(FILES_DIRECTIVE);
        }
        expect(completion_script("zsh", "analog-attach")).toContain("zstyle ':completion:*:*:analog-attach:*' list-grouped false");
        expect(completion_script("bash", "analog-attach")).toContain("complete -F _analog_attach_complete analog-attach");
        expect(completion_script("fish", "analog-attach")).toContain("complete -c analog-attach -f -a '(__analog_attach_complete)'");
        expect(completion_script("sh", "analog-attach")).toBeUndefined();
    });

    test("install_completion / uninstall_completion - write the script, replace it, remove it", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "aa-completion-"));
        try {
            const place = { program: "analog-attach", home, environment: {} };
            const file = install_path("zsh", "analog-attach", home, {});
            expect(install_completion("zsh", place)[0]).toBe(`Installed zsh completion to ${file}`);
            expect(install_completion("zsh", place).join("\n")).toContain(`fpath=(${path.dirname(file)} $fpath)`);
            expect(fs.readFileSync(file, "utf8")).toBe(`${completion_script("zsh", "analog-attach") ?? ""}\n`);
            expect(uninstall_completion("zsh", place)[0]).toBe(`Removed ${file}`);
            expect(fs.existsSync(file)).toBe(false);
            expect(uninstall_completion("zsh", place)).toEqual([`zsh completion is not installed (no ${file})`]);
        } finally {
            fs.rmSync(home, { recursive: true });
        }
    });

    test("run_completion - an unknown shell or an unreadable $SHELL is an input error", () => {
        const place = { program: "analog-attach", home: "/nonexistent", environment: { SHELL: "/bin/sh" } };
        expect(run_completion("tcsh", { install: false, uninstall: false }, place)).toEqual({ kind: "input-error", message: "Unknown shell: tcsh. Supported: bash, fish, zsh" });
        expect(run_completion(undefined, { install: false, uninstall: false }, place)).toEqual({ kind: "input-error", message: "Cannot tell the shell from $SHELL (/bin/sh). Name one: bash, fish, zsh" });
        expect(run_completion("zsh", { install: true, uninstall: true }, place).kind).toBe("input-error");
        expect(run_completion(undefined, { install: false, uninstall: false }, { ...place, environment: { SHELL: "/bin/zsh" } }).kind).toBe("answer");
    });
}
