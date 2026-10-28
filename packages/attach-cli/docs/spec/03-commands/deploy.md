# deploy

Copies the compiled overlay to a remote device and reboots it.

## 1. Synopsis

```
attach-linux [--json] deploy
```

Grammar: rule `deploy` in `01-grammar.abnf`. The command takes no arguments
or options. Its target comes from the config (02-common.md §8.1):

| Field | Meaning |
|---|---|
| `deploy-ip` | IP address or hostname of the device |
| `deploy-user` | SSH user name |
| `deploy-password` | SSH password, stored in plain text in `config.toml` |
| `overlay` | The overlay. Its `.dtbo` (named as `build` names it, build.md §2) is what is copied. |

## 2. Terms

| Term | Meaning |
|---|---|
| Compiled overlay | The `.dtbo` path derived from `overlay`, per `build`'s *Output file*. |
| Remote directory | `/boot/overlays/` on the device. |
| SSH options | `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null` |

## 3. Resources

The command needs only the deploy resource. It doesn't load the bindings, the
base or the overlay's content.

## 4. Requirements

### 4.1 Checks

**DEPLOY-001** The CLI shall check, and report together per COM-071 or
COM-072: that `deploy-ip`, `deploy-user`, `deploy-password` and `overlay` are
set, each missing one being the problem `Missing config field <field>` with
its description and hint (COM-126): `overlay` has the hint `Run 'attach-linux
init' to create one, or 'config-set overlay <path>'.`, where `<path>` is
literal; the `deploy-*` fields have none. When all four are set, it then
checks that the compiled overlay exists, and when it does, that `scp` and
`sshpass` are on `PATH`.

**DEPLOY-002** If the compiled overlay doesn't exist, then the problem shall be
`{ "field": "overlay", "kind": "missing", "message": "Compiled overlay <path>
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
refuse (COM-040, COM-041) and not reboot. Human mode writes the line `Deploy
failed (scp):`, then the command's standard error as it is, then a newline:
its own final newline leaves an empty line at the end. JSON mode gives `scp
failed: <standard error>` as `message`, the standard error unchanged (`\r\n`
line ends from ssh included).

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

## 5. Open issues

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

## 6. Examples

```
$ attach-linux deploy
Compiled overlay /work/clean.dtbo not found

Run 'build' first.
```

```
$ attach-linux --json deploy
{"ok":false,"message":"scp failed: ssh: Could not resolve hostname host.invalid: Name or service not known\r\nscp: Connection closed\r\n","severity":"error"}
```
