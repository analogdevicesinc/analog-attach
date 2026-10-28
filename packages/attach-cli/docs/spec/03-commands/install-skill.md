# install-skill, uninstall-skill

Install or remove the Claude Code skill that teaches Claude to use
`attach-linux`.

## 1. Synopsis

```
attach-linux install-skill [--force]
attach-linux uninstall-skill
```

Grammar: rules `install-skill` and `uninstall-skill` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `--force` | Install over an installed skill. | off |

## 2. Terms

| Term | Meaning |
|---|---|
| Home | The value of `HOME`, else of `USERPROFILE`, else the empty string. |
| Skill directory | `<home>/.claude/skills/attach-linux`. With an empty home it is `.claude/skills/attach-linux` relative to the CWD. |
| Installed | The skill directory has a file `SKILL.md`. |
| Packaged skill | The `SKILL.md` at the root of the `attach-linux` package, next to `dist/`. |

## 3. Resources

Neither command reads the workspace or its config: they work in any
directory, configured or not.

## 4. install-skill

**SKILL-001** The CLI shall check that Claude Code is installed by running
`claude --version` from `PATH`, its output discarded. If that fails, then the
CLI shall write `Claude Code is not installed.` and `Install it from:
https://claude.ai/code`, and install nothing.

**SKILL-002** If the skill is installed and `--force` isn't given, then the
CLI shall write `Attach skill is already installed.` and `Use --force to
overwrite.`, and change nothing.

**SKILL-003** Otherwise the CLI shall create the skill directory (and its
parents) when missing, and copy the packaged skill to `SKILL.md` in it,
replacing any file of that name. Other files in the directory are kept.

**SKILL-004** When the copy succeeds, the CLI shall write:

```

Attach skill installed successfully!

Claude Code will now assist with device tree configuration.
Try asking: "help me configure an ADC for my Raspberry Pi"

```

**SKILL-005** If the packaged skill is missing or the copy fails, then the CLI
shall write `SKILL.md not found at <path>` or `Failed to install skill:
<error>` to standard error and exit with status 1 (COM-130).

## 5. uninstall-skill

**SKILL-010** If the skill isn't installed, then the CLI shall write `Attach
skill is not installed.` and change nothing.

**SKILL-011** Otherwise the CLI shall remove the skill directory with
everything in it, and write an empty line, `Attach skill uninstalled
successfully.` and an empty line.

**SKILL-012** If the removal fails, then the CLI shall write `Failed to
uninstall skill: <error>` to standard error and exit with status 1 (COM-130).

## 6. Both commands

**SKILL-020** Except for the failures of SKILL-005 and SKILL-012, the CLI
shall write every message to standard output and exit with status 0, in human
and in JSON mode alike: neither command has a JSON response. (Open issue
S-2.)

## 7. Open issues

**S-2. `--json` is ignored.** Both commands write their human text under
`--json`. The CLI's convention (COM-020) is one JSON object or nothing.

**S-3. An empty home installs into the CWD.** With `HOME` and `USERPROFILE`
both unset or empty, the skill goes to `./.claude/skills/attach-linux`, and
`uninstall-skill` removes it from there.

**S-4. `uninstall-skill` removes the whole directory.** Files the user added
next to `SKILL.md` are deleted with it, while `install-skill` keeps them
(SKILL-003).

**S-5. `install-skill` without Claude Code exits 0.** As C-1 in
`02-common.md`: the refusals of SKILL-001 and SKILL-002 exit with status 0.

## 8. Examples

```
$ attach-linux install-skill
                                                  (empty line)
Attach skill installed successfully!
                                                  (empty line)
Claude Code will now assist with device tree configuration.
Try asking: "help me configure an ADC for my Raspberry Pi"
                                                  (empty line)
$ attach-linux install-skill
Attach skill is already installed.
Use --force to overwrite.
$ attach-linux uninstall-skill
                                                  (empty line)
Attach skill uninstalled successfully.
                                                  (empty line)
$ attach-linux uninstall-skill
Attach skill is not installed.
```
