# deploy

Copies the compiled overlay to a remote device and reboots it. A shared
command: §2 to §4 as the linux backend does it, §5 as the noos backend does
it (flashes the generated project to the board through a debug probe).

## 1. Synopsis

```
analog-attach [--json] deploy
analog-attach [--json] deploy [--board <board>] [--probe <probe>]     # where the backend is noos
```

Grammar: rule `deploy` in `01-grammar.abnf`.

| Option (noos) | Meaning | Default |
|---|---|---|
| `--board <board>` | The board preset of the project to flash. | the project's only preset |
| `--probe <probe>` | The debug probe: `openocd` or `jlink`. | the `probe` setting, else `openocd` |

Where the backend is linux, the command takes no arguments or options. Its
target comes from the settings (02-common.md §8.1):

| Field | Meaning |
|---|---|
| `deploy-ip` | IP address or hostname of the device |
| `deploy-user` | SSH user name |
| `deploy-password` | SSH password, stored in plain text in the settings file |
| `workfile` | The overlay. Its `.dtbo` (named as `build` names it, build.md §2) is what is copied. |

## 2. Terms

| Term | Meaning |
|---|---|
| Compiled overlay | The `.dtbo` path derived from `workfile`, per `build`'s *Output file*. |
| Remote directory | `/boot/overlays/` on the device. |
| SSH options | `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` |

## 3. Resources

The command needs only the deploy resource. It doesn't load the bindings, the
base or the overlay's content.

## 4. Requirements

### 4.1 Checks

**DEPLOY-001** The CLI shall check, and report together per COM-071 or
COM-072: that `deploy-ip`, `deploy-user`, `deploy-password` and `workfile`
are set, each missing one being the problem `Missing config field <field>`
with its description and hint (COM-126): `workfile` has the setup hint of
02-common.md §8.3; the `deploy-*` fields have none. When all four are set, it then
checks that the compiled overlay exists, and when it does, that `scp` and
`sshpass` are on `PATH`.

**DEPLOY-002** If the compiled overlay doesn't exist, then the problem shall be
`{ "field": "workfile", "kind": "missing", "message": "Compiled overlay <path>
not found" }` with the hint `Run 'build' first.`, `<path>` being the compiled
overlay.

**DEPLOY-003** If `scp` or `sshpass` isn't on `PATH`, then the problem shall be
`{ "field": "deploy", "kind": "missing", "message": "<tools> not found on PATH
(needed to deploy)" }`, `<tools>` being the missing ones joined by `, `
(`scp, sshpass`).

**DEPLOY-004** The CLI shall not check that the compiled overlay is newer
than the overlay or that the overlay parses.

### 4.2 Copy

**DEPLOY-010** The CLI shall run the shell command `sshpass -e scp <SSH
options> "<compiled overlay>" <user>@<ip>:/boot/overlays/`, with the password
in the environment variable `SSHPASS` and not on the command line.

**DEPLOY-011** If the copy exits with a non-zero status, then the CLI shall
refuse (COM-040, COM-041) with `Deploy failed (scp):`, a newline, and the
command's standard error as it is (`\r\n` line ends from ssh included), and
not reboot. Human mode writes that, then a newline: its own final newline
leaves an empty line at the end. JSON mode gives it as `message`.

### 4.3 Reboot

**DEPLOY-020** When the copy succeeds, the CLI shall run `sshpass -e ssh <SSH
options> <user>@<ip> sudo reboot` with the same environment.

**DEPLOY-021** The CLI shall ignore the reboot command's exit status and
output: the reboot drops the connection, so a failure is expected.

**DEPLOY-022** After DEPLOY-020, the CLI shall write `Deployed <compiled
overlay> to <user>@<ip>:/boot/overlays/ and rebooted` in human mode. In JSON
mode it shall respond per `04-protocol/deploy.schema.json`: `{ "ok": true,
"message": "Deployed and rebooted", "severity": "info", "host": <ip>,
"remote_path": "/boot/overlays/" }`.

**DEPLOY-023** The CLI shall not change any workspace file.

## 5. Where the backend is noos

The project is the one `build` builds (`build.md` §5).

**DEPLOY-500** If `--probe` is neither `openocd` nor `jlink`, then the CLI
shall report the input error `Unknown probe '<probe>'. Supported: openocd,
jlink` before anything else.

**DEPLOY-501** The CLI shall refuse for the project directory as `build.md`
BUILD-500 says.

**DEPLOY-502** When `deploy-command` is set, the CLI shall run it with the
shell in the project directory, after the progress line `Deploying <dir>
with '<command>'`; `--board` and `--probe` change nothing in it (open issue
D-7). If it exits with a non-zero status, then the CLI shall refuse with
`Deploy failed with exit code <n>`; otherwise the JSON message is `Deployed
<dir> with '<command>'`.

**DEPLOY-510** Otherwise the probe shall be `--probe`, else the `probe`
setting, else `openocd`. The CLI shall refuse for `capi-path` as BUILD-510
says, then read the presets and the project, and check the tools, as
BUILD-512 and BUILD-513 say.

**DEPLOY-511** The CLI shall write the progress line `Flashing <target> to
<board> via <probe>`, then every line the tools write, to standard error,
in both modes (`02-common.md` COM-514). With `deploy-command`, the progress
line is DEPLOY-502's.

**DEPLOY-512** The CLI shall run `cmake --preset <board> -DPROBE=<probe>`
and `cmake --build <dir>/build --target flash` in the project directory,
with `CAPI_DIR` set to `capi-path`. If the first exits with a non-zero
status, then the CLI shall refuse with `CMake configure failed with exit
code <n>`; if the second does, with `Deploy failed with exit code <n>`. It
doesn't build first: what the `flash` target depends on is up to the
project.

**DEPLOY-520** When it succeeds, the CLI shall respond `{"ok": true,
"message": "Flashed <target> to <board> via <probe>", "severity": "info"}`
(`04-protocol/deploy.schema.json#/$defs/noos`; with `deploy-command`,
DEPLOY-502's message), and write `Deploy completed successfully` in human
mode.

**DEPLOY-521** The CLI shall change no setting and not the workfile; the
build directory is what the tools leave.

## 6. Open issues

**D-1. Host keys aren't checked.** The SSH options accept any host key and
record none. A man-in-the-middle gets the password.

**D-2. `deploy-ip` and `deploy-user` go into the shell command unquoted.** A
value with spaces or shell metacharacters changes the command
(`deploy-user = "pi; touch /tmp/x"` runs `touch` on the local machine).

**D-3. "rebooted" is said whatever happened.** A failed `sudo reboot` (sudo
asking for a password, a dropped connection before the command) still gives
`Deployed … and rebooted` and `ok: true`.

**D-4. A stale `.dtbo` is deployed.** Nothing checks that the compiled
overlay is newer than the overlay (DEPLOY-004), so an edit after the last
`build` isn't on the device.

**D-5. No timeout.** The SSH options set no `ConnectTimeout`, so an
unreachable address that doesn't refuse the connection hangs until the
system's TCP timeout.

**D-6. The response doesn't say which overlay went.** `host` and
`remote_path` are given but not the copied file, and `remote_path` is the
directory.

**D-7. `--board` and `--probe` are ignored with `deploy-command`.** The
command runs as it is; `--probe` is still checked (DEPLOY-500).

## 7. Examples

```
$ analog-attach deploy
Compiled overlay /work/clean.dtbo not found

Run 'build' first.
```

```
$ analog-attach --json deploy
{"ok":false,"message":"Deploy failed (scp):\nssh: Could not resolve hostname host.invalid: Name or service not known\r\nscp: Connection closed\r\n","severity":"error"}
```

Where the backend is noos (a stand-in capi whose `flash` target echoes the
probe; the tool's lines are on standard error):

```
$ analog-attach deploy --probe jlink
Flashing p_app to testboard via jlink
-- Configuring done (0.0s)
-- Generating done (0.0s)
-- Build files have been written to: /work/out/work/build
[1/1] cd /work/out/work/build && /usr/bin/cmake -E echo flashing\ with\ PROBE=jlink
flashing with PROBE=jlink
Deploy completed successfully
```

```
$ analog-attach --json deploy --probe nope
Unknown probe 'nope'. Supported: openocd, jlink
```

(standard error, status 2.)
