# skill

Install or remove a skill of the backend for an AI agent (Claude Code, Codex
CLI or Gemini CLI): a skill teaches the agent to use `analog-attach` for what
the backend targets. Each backend packages its own skills, by name (the linux
backend's is `analog-attach-linux`, the noos backend's `analog-attach-noos`).

## 1. Synopsis

```
analog-attach skill install [<name>] [--force] [--agent <agent>]
analog-attach skill uninstall [<name>] [--agent <agent>]
```

Grammar: rule `skill` in `01-grammar.abnf`.

| Argument | Meaning | Default |
|---|---|---|
| `install`, `uninstall` | The action. Another word is an unknown command (GRM-004); `skill` alone writes its usage (GRM-018). | |
| `<name>` | The skill: one of the backend's (SKILL-021). Without it, the skills are listed (SKILL-022). | |
| `--force` | With `install`: install over an installed skill. | off |
| `--agent <agent>` | The agent: `claude`, `codex`, `gemini`, or `all` for each of them (SKILL-040, SKILL-041). | `claude` |

## 2. Terms

| Term | Meaning |
|---|---|
| Home | The user's home directory (`os.homedir()`: `HOME`, else the account's). |
| Agent | An AI agent a skill is installed for (SKILL-040): Claude Code (`claude`), Codex CLI (`codex`) or Gemini CLI (`gemini`). |
| Skill directory | The agent's directory of the skill: `<home>/.claude/skills/<name>` for Claude Code, `<home>/.agents/skills/<name>` for Codex CLI, `<home>/.gemini/skills/<name>` for Gemini CLI. |
| Installed | The skill directory has a file `SKILL.md`. |
| Packaged skill | The backend's directory of the skill in the installation (`skills/<name>/`, `02-common.md` COM-016), holding its `SKILL.md`. Where the CLI runs from its repository, the repository's own `skills/<name>/`. |

## 3. Resources

Neither action reads the workspace or the settings beyond `backend`: they
work in any directory with a backend set (COM-014).

## 4. The name

**SKILL-021** The CLI shall look `<name>` up among the backend's skills. When
the backend has none, it shall report the input error `The <backend> backend
has no skills`; when none has the name, it shall refuse (`02-common.md`
COM-043) with `Unknown skill: <name>. Skills of the <backend> backend:
<names>`, `<names>` joined with `, `.
**SKILL-022** With no `<name>`, `skill install` and `skill uninstall` shall list
the backend's skills, and change nothing: in JSON `{ ok: true, message,
severity: "info", skills }`, `message` being `Skills of the <backend> backend:
<names>` and an item per skill and agent of `--agent` (SKILL-040) `{ name,
about, installed, path, agent }`, `path` that agent's skill directory; in
human mode the header `Skills of the <backend> backend:` (`Skills of the
<backend> backend for <Agent>:` when `--agent` names one), a line per item,
its name, what it helps with, ` · <Agent>` with `--agent all`, and
` (installed)` when it is, then `Install one with: analog-attach skill install
<name>` (`Remove` and `uninstall` for `skill uninstall`), followed by
` --agent <agent>` when `--agent` was given. With no backend set, it is
COM-014's input error.

## 5. skill install

**SKILL-001** The CLI shall check that the agent is installed by running its
command with `--version` from `PATH` (`claude --version`, `codex --version`,
`gemini --version`), its output discarded. If that fails, then the CLI shall
refuse with `<Agent> is not installed.` and `Install it from: <site>` (two
lines in human mode, one joined with a space in the JSON `message`; the site
`https://claude.ai/code`, `https://developers.openai.com/codex/cli` or
`https://geminicli.com`), and install nothing. With `--agent all`, SKILL-041
says which agents are checked.

**SKILL-002** If the skill is installed and `--force` isn't given, then the
CLI shall refuse with `Skill <name> is already installed<for>.` and `Use --force
to overwrite.` (two lines, or one joined with a space), and change nothing.
`<for>` is SKILL-040's.

**SKILL-003** Otherwise the CLI shall create the skill directory (and its
parents) when missing, and copy the packaged skill's files into it, replacing
those of the same names. Other files in the directory are kept.

**SKILL-004** When the copy succeeds, the CLI shall write in human mode:

```

Skill <name> installed successfully<for>!

<Agent> now helps with <about>.

```

`<about>` being the skill's description (`Linux device tree overlays`;
`CAPI projects for no-OS drivers` for `analog-attach-noos`), `<for>`
SKILL-040's, and `<Agent>` the agent's name (`They now help` when it was
installed for more than one, SKILL-041).

**SKILL-005** If the packaged skill has no `SKILL.md`, or the copy fails, then
the CLI shall end with the error `SKILL.md not found at <directory>` or the
file system's, as COM-130 says.

## 6. skill uninstall

**SKILL-010** If the skill isn't installed, then the CLI shall refuse with
`Skill <name> is not installed<for>.` (`… for any agent.` with `--agent all`)
and change nothing.

**SKILL-011** Otherwise the CLI shall remove the skill directory with
everything in it, and write in human mode an empty line, `Skill <name>
uninstalled successfully<for>.` and an empty line.

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
severity: "info", path, agent }`, `message` being `Installed skill <name> to
<path>` or `Removed skill <name> from <path>`, `path` the skill directory,
absolute, and `agent` the agent's id (`claude`, `codex`, `gemini`). With
`--agent all` it is SKILL-041's. A refusal is the common refusal (COM-040).
Schema: `04-protocol/skill.schema.json`.

## 8. Agents

**SKILL-040** Both actions shall work on the skill directory of the agent
`--agent` names: `claude` (Claude Code, the default), `codex` (Codex CLI) or
`gemini` (Gemini CLI). When `--agent` is given, `<for>` in the messages is
` for <Agent>` (` for Codex CLI`); without it, `<for>` is empty. Another
value shall be refused (COM-043) with `Unknown agent: <value>. Agents: claude,
codex, gemini, all`, before the name is looked up, and nothing changes.

**SKILL-041** With `--agent all`:
- `skill install` shall install the skill for each agent that is installed
  (SKILL-001's check), and end its human text with a line `Skipped <Agent>: it
  is not installed.` per agent that isn't. When none is, it shall refuse with
  `Neither Claude Code, Codex CLI nor Gemini CLI is installed.` (in human mode
  followed by an `Install <Agent> from: <site>` line per agent). When the
  skill is installed for any of them and `--force` isn't given, it shall
  refuse as SKILL-002, `<for>` naming those, and install nothing.
- `skill uninstall` shall remove the skill for each agent that has it.
- `<for>` names the agents it was done for, joined as a list (` for Claude
  Code and Codex CLI`).
- In JSON, a success shall be `{ ok: true, message, severity: "info", agents
  }`, `agents` an `{ agent, path }` per agent it was done for, and `message`
  SKILL-030's with the paths joined with `, `.

## 9. Open issues

**S-4. `skill uninstall` removes the whole directory.** Files the user added
next to the skill's are deleted with it, while `skill install` keeps them
(SKILL-003).

**S-5. `skill install` without the agent exits 0.** As C-1 in
`02-common.md`: the refusals of SKILL-001 and SKILL-002 exit with status 0.

**S-6. A skill is only reachable through its backend.** `skill uninstall`
can't remove a skill of another backend, so switching `backend` leaves the
old backend's skills installed with no command to remove them.

**S-7. Gemini CLI also reads Codex CLI's directory.** Gemini CLI reads
`~/.agents/skills` as well as `~/.gemini/skills`, so a skill installed for
both is found twice by Gemini CLI, which uses the `~/.agents/skills` copy
(Codex CLI's).

## 10. Examples

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
{"ok":true,"message":"Removed skill analog-attach-linux from /home/u/.claude/skills/analog-attach-linux","severity":"info","path":"/home/u/.claude/skills/analog-attach-linux","agent":"claude"}
$ analog-attach skill uninstall analog-attach-linux
Skill analog-attach-linux is not installed.
$ analog-attach skill install foo
Unknown skill: foo. Skills of the linux backend: analog-attach-linux
$ analog-attach skill install analog-attach-linux --agent codex
                                                  (empty line)
Skill analog-attach-linux installed successfully for Codex CLI!
                                                  (empty line)
Codex CLI now helps with Linux device tree overlays.
$ analog-attach --json skill uninstall analog-attach-linux --agent codex
{"ok":true,"message":"Removed skill analog-attach-linux from /home/u/.agents/skills/analog-attach-linux","severity":"info","path":"/home/u/.agents/skills/analog-attach-linux","agent":"codex"}
$ analog-attach skill install analog-attach-linux --agent vim
Unknown agent: vim. Agents: claude, codex, gemini, all
$ analog-attach skill uninstall analog-attach-linux --force
No flag registered for --force                         (stderr, exit 2)
```
