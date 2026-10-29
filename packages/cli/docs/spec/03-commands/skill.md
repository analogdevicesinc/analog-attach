# skill

Install or remove a Claude Code skill of the backend: a skill teaches Claude
to use `analog-attach` for what the backend targets. Each backend packages
its own skills, by name (the linux backend's is `analog-attach-linux`, the
noos backend's `analog-attach-noos`).

## 1. Synopsis

```
analog-attach skill install <name> [--force]
analog-attach skill uninstall <name>
```

Grammar: rule `skill` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `install`, `uninstall` | The action. Another word is an unknown command (GRM-004); `skill` alone writes its usage (GRM-018). | |
| `<name>` | The skill: one of the backend's (SKILL-021). Required. | |
| `--force` | With `install`: install over an installed skill. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Home | The user's home directory (`os.homedir()`: `HOME`, else the account's). |
| Skill directory | `<home>/.claude/skills/<name>`. |
| Installed | The skill directory has a file `SKILL.md`. |
| Packaged skill | The backend's directory of the skill in the `analog-attach` package (`skills/<backend>/`), holding its `SKILL.md`. |

## 3. Resources

Neither action reads the workspace or the settings beyond `backend`: they
work in any directory with a backend set (COM-014).

## 4. The name

**SKILL-021** The CLI shall look `<name>` up among the backend's skills. When
the backend has none, it shall report the input error `The <backend> backend
has no skills`; when none has the name, the input error `Unknown skill:
<name>. Skills of the <backend> backend: <names>`, `<names>` joined with `, `.
A missing `<name>` is stricli's `Expected argument for name` (GRM-004).

## 5. skill install

**SKILL-001** The CLI shall check that Claude Code is installed by running
`claude --version` from `PATH`, its output discarded. If that fails, then the
CLI shall refuse with `Claude Code is not installed.` and `Install it from:
https://claude.ai/code` (two lines in human mode, one joined with a space in
the JSON `message`), and install nothing.

**SKILL-002** If the skill is installed and `--force` isn't given, then the
CLI shall refuse with `Skill <name> is already installed.` and `Use --force
to overwrite.` (two lines, or one joined with a space), and change nothing.

**SKILL-003** Otherwise the CLI shall create the skill directory (and its
parents) when missing, and copy the packaged skill's files into it, replacing
those of the same names. Other files in the directory are kept.

**SKILL-004** When the copy succeeds, the CLI shall write in human mode:

```

Skill <name> installed successfully!

Claude Code now helps with <about>.

```

`<about>` being the skill's description (`Linux device tree overlays`;
`CAPI projects for no-OS drivers` for `analog-attach-noos`).

**SKILL-005** If the packaged skill has no `SKILL.md`, or the copy fails, then
the CLI shall end with the error `SKILL.md not found at <directory>` or the
file system's, as COM-130 says.

## 6. skill uninstall

**SKILL-010** If the skill isn't installed, then the CLI shall refuse with
`Skill <name> is not installed.` and change nothing.

**SKILL-011** Otherwise the CLI shall remove the skill directory with
everything in it, and write in human mode an empty line, `Skill <name>
uninstalled successfully.` and an empty line.

**SKILL-012** If the removal fails, then the CLI shall end with the file
system's error, as COM-130 says.

**SKILL-013** `--force` with `uninstall` shall be stricli's input error `No
flag registered for --force` (GRM-004), and change nothing.

## 7. Both actions

**SKILL-020** Both actions shall follow the outcomes of `02-common.md` §2:
successes and refusals on standard output with status 0, input errors on
standard error with status 2 (COM-031), thrown errors with status 1
(COM-130).

**SKILL-030** In JSON mode, a success shall be `{ ok: true, message,
severity: "info", path }`, `message` being `Installed skill <name> to <path>`
or `Removed skill <name> from <path>` and `path` the skill directory,
absolute. A refusal is the common refusal (COM-040). Schema:
`04-protocol/skill.schema.json`.

## 8. Open issues

**S-2.** *Fixed.* (`--json` was ignored: both actions wrote their human text.
They now answer JSON, SKILL-030.)

**S-3.** *Fixed.* (An empty `HOME` installed into the CWD. The home is now
the account's when `HOME` is unset.)

**S-4. `skill uninstall` removes the whole directory.** Files the user added
next to the skill's are deleted with it, while `skill install` keeps them
(SKILL-003).

**S-5. `skill install` without Claude Code exits 0.** As C-1 in
`02-common.md`: the refusals of SKILL-001 and SKILL-002 exit with status 0.

**S-6. A skill is only reachable through its backend.** `skill uninstall`
can't remove a skill of another backend, so switching `backend` leaves the
old backend's skills installed with no command to remove them.

## 9. Examples

```
$ analog-attach skill install analog-attach-linux
                                                  (empty line)
Skill analog-attach-linux installed successfully!
                                                  (empty line)
Claude Code now helps with Linux device tree overlays.
                                                  (empty line)
$ analog-attach skill install analog-attach-linux
Skill analog-attach-linux is already installed.
Use --force to overwrite.
$ analog-attach --json skill uninstall analog-attach-linux
{"ok":true,"message":"Removed skill analog-attach-linux from /home/u/.claude/skills/analog-attach-linux","severity":"info","path":"/home/u/.claude/skills/analog-attach-linux"}
$ analog-attach skill uninstall analog-attach-linux
Skill analog-attach-linux is not installed.
$ analog-attach skill install foo
Unknown skill: foo. Skills of the linux backend: analog-attach-linux   (stderr, exit 2)
$ analog-attach skill uninstall analog-attach-linux --force
No flag registered for --force                         (stderr, exit 2)
```
