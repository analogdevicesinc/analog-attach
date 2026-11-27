# deploy

Runs the project's `AA_DEPLOY`, by default its `aa_deploy.sh`, which copies the compiled overlay
to a Raspberry Pi running Kuiper and reboots it; where the `output` setting is
`devicetree`, the compiled devicetree over the board's own. A shared command:
§2 to §4 as the linux backend does it, §5 as the noos backend does it (flashes
the generated project to the board through a debug probe).

## 1. Synopsis

```
analog-attach [--json] deploy
analog-attach [--json] deploy [--probe <probe>]     # where the backend is noos
```

Grammar: rule `deploy` in `01-grammar.abnf`.

| Option (noos) | Meaning | Default |
|---|---|---|
| `--probe <probe>` | The debug probe: `openocd` or `jlink`. | the `probe` setting, else `openocd` |

Where the backend is linux, the command takes no arguments or options. What
it deploys and where is `AA_DEPLOY`'s: the CLI hands it the system variables
and the project's (02-common.md §8.6). The starter's board is three project
variables, the password a secret, which `init` sets when it writes the
starter, to a Kuiper image's defaults (init.md INIT-107): `BOARD_IP`
`analog.local`, `BOARD_USER` `analog`, and `BOARD_PASSWORD` a secret, by
name only, its value given at each `deploy` (§4.2). A variable the project
had is kept (INIT-108). Another board is set with `config var`:

```
analog-attach config var BOARD_IP 192.168.2.10
analog-attach config var BOARD_USER root
```

## 2. Terms

| Term | Meaning |
|---|---|
| Compiled overlay | The `.dtbo` path derived from `workfile` and `build-dir`, per `build`'s *Output file* (`$AA_DTBO`); where `output` is `devicetree`, the `.dtb` path (the *compiled devicetree*, `$AA_DTB`). |
| AA_DEPLOY | The executable variable deploy runs (02-common.md COM-158): `./aa_deploy.sh` unless `config var AA_DEPLOY <command>` set another. |
| aa_deploy.sh | The file `aa_deploy.sh` in the directory that holds `.analog-attach/` (02-common.md §8.6), what `AA_DEPLOY` runs by default. `init` writes its starter (init.md INIT-100). |
| Secret | A project variable stored by name only (`config var <NAME> --secret`, config.md CONFIG-304; the starter's `BOARD_PASSWORD`, set so by `init`, init.md INIT-107): its value is the environment's or typed on a terminal, never written (02-common.md COM-157). |
| Boot folder | On the board: `/boot/firmware` when it has an `overlays/` folder (Kuiper's newer releases), else `/boot` when that has one. |

## 3. Resources

The command needs the `workfile` setting, `aa_deploy.sh` while `AA_DEPLOY` is
its default (02-common.md COM-150), and the value of each secret (DEPLOY-040 to DEPLOY-042). It doesn't load the
bindings, the base or the overlay's content, and doesn't check the compiled
overlay or the tools: what `AA_DEPLOY` needs is its own to check (the
starter's checks, DEPLOY-033).

## 4. Requirements

### 4.1 Checks

**DEPLOY-001** When the workspace can't be loaded, the CLI shall report it per
COM-071 or COM-072 and run nothing. The problems of `aa_deploy.sh` (COM-150,
while `AA_DEPLOY` is its default) come first, then each secret that DEPLOY-042 refuses, in the order of the
project's variables.

**DEPLOY-002** *Withdrawn.* (A compiled overlay that didn't exist was the
problem `Compiled overlay <path> not found`; the starter checks it,
DEPLOY-033.)

**DEPLOY-003** *Withdrawn.* (`scp` or `sshpass` not on `PATH` was a
problem of the workspace; the starter checks its tools, DEPLOY-033.)

**DEPLOY-004** The CLI shall not check that the compiled overlay exists, is
newer than the overlay or that the overlay parses.

### 4.2 Secrets

**DEPLOY-040** For each secret of the project, the CLI shall take the value
of the environment variable of that name in the environment it runs in,
when that is set and not empty. A client that runs `deploy` for a user (the
GUI) hands a secret over this way: in the run's environment, never on the
command line or in a file.

**DEPLOY-041** When the run can ask (human mode, standard input and output a
terminal), the CLI shall ask, once the workspace has loaded, for each secret
the environment doesn't give, in the order of the project's variables:
`<NAME>:`, the answer hidden: nothing of it is echoed (the line says `[input
is masked]`), and no key shows it. An empty one is refused with `<NAME> can't be empty` and asked again. If a question is
stopped, then the CLI shall cancel (COM-060) with `Stopped: nothing was
deployed.` and run nothing.

**DEPLOY-042** When the run can't ask (JSON mode, or standard input or output
not a terminal), each secret the environment doesn't give shall be a problem
of the workspace (DEPLOY-001): `{ "field": "<NAME>", "kind": "missing",
"error_type": "missing-setting", "message": "Secret variable <NAME> is not
in the environment" }`, with the hint `Set it in the environment deploy runs
in (<NAME>=… analog-attach deploy), or run deploy on a terminal, which asks
for it.`

**DEPLOY-043** The CLI shall write a secret's value nowhere: not to a file,
not to standard output or standard error, not in a response; and shall
hand it to `AA_DEPLOY` in its environment only (02-common.md COM-157).

### 4.3 The script

**DEPLOY-010** to **DEPLOY-015**, **DEPLOY-020** to **DEPLOY-022**
*Withdrawn.* (The CLI copied the compiled overlay with `sshpass -e scp`, ran
`sudo reboot`, or a `deploy-command` of the user's instead, with the
`deploy-ip`, `deploy-user` and `deploy-password` settings, and answered
`Deployed and rebooted` with `host` and `remote_path`. `AA_DEPLOY`
(`aa_deploy.sh`) does it now, DEPLOY-030 to DEPLOY-033.)

**DEPLOY-030** When the workspace has loaded and every secret has a value,
the CLI shall run `AA_DEPLOY` per 02-common.md COM-151, with the environment
of COM-152 for `deploy`, the secrets included, after the progress line
`Deploying <compiled overlay> with AA_DEPLOY`.

**DEPLOY-031** If `AA_DEPLOY` exits with a non-zero status, or doesn't
start, then the CLI shall refuse (COM-040, COM-041) with `Deploy failed:
AA_DEPLOY exited with status <n>` (`Deploy failed: AA_DEPLOY did not run:
<why>` when it didn't start), `error_type` `tool-failed`; in JSON mode
followed by a newline and the command's standard error, as build.md
BUILD-031.

**DEPLOY-032** When `AA_DEPLOY` succeeds, the CLI shall write `Deploy
completed successfully` in human mode, and in JSON mode respond per
`04-protocol/deploy.schema.json`: `{ "ok": true, "message": "Deployed
<compiled overlay> with AA_DEPLOY", "severity": "info" }`.

**DEPLOY-033** The starter `aa_deploy.sh` (init.md INIT-100) shall, writing
each step's line to standard output and exiting with status 1 and
`aa_deploy.sh: <why>` on standard error at the first that fails:

1. check that `BOARD_IP`, `BOARD_USER` and `BOARD_PASSWORD` are set, each
   missing one with the `config var` command that sets it; that the
   compiled overlay (`$AA_DTBO`, or `$AA_DTB` where `$AA_OUTPUT` is
   `devicetree`) is a file (`<file> not found: run analog-attach build
   first`); and that `ssh`, `scp` and `sshpass` are on `PATH`;
2. `Checking <user>@<ip>`: run `true` on the board over SSH, with the SSH
   options `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o
   ConnectTimeout=10 -o LogLevel=ERROR`, `<user>@<ip> refused the password`
   when sshpass says so (its status 5), `<user>@<ip> does not answer over
   SSH (exit status <n>)` otherwise;
3. find the target: where `$AA_OUTPUT` is `devicetree`,
   `/boot/devicetree.dtb`; else `<boot folder>/overlays/<file's name>`, or
   `no /boot/firmware/overlays or /boot/overlays on <user>@<ip>: is it a
   Raspberry Pi running Kuiper?` when the board has neither;
4. `Copying <name> to <user>@<ip>:<target>`: copy the file with `scp` to
   `/tmp/analog-attach-<name>` on the board, then as root to the target,
   removing the copy in `/tmp`;
5. for an overlay, check that `<boot folder>/config.txt` exists
   (`<config> not found on <user>@<ip>`), and unless a line of it is
   `dtoverlay=<name>` (the file's name without `.dtbo`, followed by the end
   of the line, `,` or `:`, after any spaces), append an empty line,
   `[all]` and `dtoverlay=<name>` as root: `Added dtoverlay=<name> to
   <config>`, or `<config> already has dtoverlay=<name>`;
6. `Rebooting <user>@<ip>`: start the reboot as root, in the background,
   a second later, so the SSH session ends before the board goes down.

It runs a command as root with `sudo -S`, the password on sudo's standard
input, or directly where `BOARD_USER` is `root`. It hands the password to
`sshpass` in the environment variable `SSHPASS` (`sshpass -e`), never on a
command line. It doesn't check the board after the reboot, load the overlay
at run time, or keep a copy of what it replaces.

**DEPLOY-023** The CLI shall not change any workspace file.

## 5. Where the backend is noos

The project is the one `build` builds (`build.md` §5).

**DEPLOY-500** If `--probe` is neither `openocd` nor `jlink`, then the CLI
shall refuse with `Unknown probe '<probe>'. Supported: openocd, jlink`
(`02-common.md` COM-043) before anything else.

**DEPLOY-501** The CLI shall refuse for the project directory as `build.md`
BUILD-500 says.

**DEPLOY-503** When `build-command` is unset (the project is built by the
CLI's own step, so its image is where `build.md` BUILD-512 says) and that
image doesn't exist, the CLI shall refuse with `<target> is not built for
<board> (no <elf>). Build it first: analog-attach build`, before running
`deploy-command` or flashing. Deploy doesn't build: it puts on the board what
`build` made. With a `build-command` of the user's, the image is wherever
that command puts it, and the CLI doesn't look for it.

**DEPLOY-502** When `deploy-command` is set, the CLI shall run it with the
shell in the project directory, after the progress line `Deploying <dir>
with '<command>'`; `--probe` changes nothing in it (open issue D-7). If it exits with a non-zero status, then the CLI shall refuse with
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

**DEPLOY-512** The CLI shall run `cmake --preset <board> -B <build>
-DPROBE=<probe>` and `cmake --build <build> --target flash` in the project
directory (`<build>` as `build.md` BUILD-512 says),
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

**D-1. Host keys aren't checked.** The starter's SSH options accept any host
key and record none. A man-in-the-middle gets the password.

**D-4. A stale `.dtbo` is deployed.** Nothing checks that the compiled
overlay is newer than the overlay (DEPLOY-004), so an edit after the last
`build` isn't on the device.

**D-7. `--probe` is ignored with `deploy-command`.** The command runs as it
is; `--probe` is still checked (DEPLOY-500).

**D-8. The starter puts a full devicetree at `/boot/devicetree.dtb`.** That is
where U-Boot finds it on Kuiper's Zynq boards; others name it otherwise
(`system.dtb` on ZynqMP, the board's own `.dtb` on a Raspberry Pi), and
`aa_deploy.sh` has to be edited for them. The device's devicetree is written
over with no copy kept, so one that doesn't boot has to be put back from the
SD card.

**D-9. Success means the reboot started.** The starter doesn't wait for the
board to come back or check that the overlay loaded (DEPLOY-033), so an
overlay the board rejects at boot is found only on the board.

**D-10. The secret is in the command's environment.** `AA_DEPLOY` and every
process it starts (`ssh`, `scp`) inherit it, readable by the same user
through `/proc/<pid>/environ` while they run.

## 7. Examples

```
$ analog-attach deploy
BOARD_PASSWORD:
Deploying /work/build/clean.dtbo with AA_DEPLOY
Checking analog@192.168.2.10
Copying clean.dtbo to analog@192.168.2.10:/boot/overlays/clean.dtbo
Added dtoverlay=clean to /boot/config.txt
Rebooting analog@192.168.2.10
Deploy completed successfully
```

The password isn't shown; the script's lines are on standard error.

```
$ analog-attach --json deploy
{"ok":false,"message":"Secret variable BOARD_PASSWORD is not in the environment","severity":"error","error_type":"missing-setting","errors":[{"field":"BOARD_PASSWORD","kind":"missing","error_type":"missing-setting","message":"Secret variable BOARD_PASSWORD is not in the environment"}],"hints":["Set it in the environment deploy runs in (BOARD_PASSWORD=… analog-attach deploy), or run deploy on a terminal, which asks for it."]}
$ BOARD_PASSWORD=analog analog-attach --json deploy
{"ok":false,"message":"Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: analog@192.168.2.10 does not answer over SSH (exit status 255)","severity":"error","error_type":"tool-failed"}
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
{"ok":false,"message":"Unknown probe 'nope'. Supported: openocd, jlink","severity":"error","error_type":"unknown-choice"}
```
