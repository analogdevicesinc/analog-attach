# deploy where the backend is linux: the project's aa_deploy.sh run, whose starter (init writes it)
# copies the .dtbo to a Raspberry Pi running Kuiper over SSH, adds it to config.txt, and reboots
# the board.
#
# The tests run the starter against a board simulated on this machine: stand-ins for ssh, scp
# and sshpass that act on a folder ($BOARD) as the board's root, and for the board's sudo and
# reboot. They record what they were given. Nothing here reaches a device unless AA_DEPLOY_IP is
# set (with AA_DEPLOY_USER and AA_DEPLOY_PASSWORD): that test copies to the device and reboots it.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, an empty overlay created
# with init (not built; init writes the starter aa_deploy.sh), the variables BOARD_IP 10.0.0.5 and
# BOARD_USER pi, and the secret BOARD_PASSWORD.
setup() {
	load ../helpers
	new_project linux
	with_overlay
	aa config var BOARD_IP 10.0.0.5 >/dev/null
	aa config var BOARD_USER pi >/dev/null
	aa config var BOARD_PASSWORD --secret >/dev/null
}

# `run_config_error <words>`: run_json for a configuration error, a refusal with its errors and
# hints (COM-071): exit 0, nothing on standard error, .ok false.
run_config_error() {
	run_json "$@"
	assert_success
	[ -z "$stderr" ] || fail "standard error: $stderr"
	assert_json '.ok' false
}

# `board [<boot folder>]`: a simulated Raspberry Pi in $BOARD (password s3cr3t-board-pw), with
# <boot folder> (/boot/firmware by default; /boot for an older Kuiper; none for no overlays/)
# holding overlays/ and a config.txt. Puts the stand-ins first on $STAND_INS, the PATH to deploy
# with; each appends its arguments to $CALLS. The board's state: $BOARD/down (it doesn't answer),
# $BOARD/scp-fails (a copy fails), $BOARD/rebooted (written by its reboot).
board() {
	local boot=${1-/boot/firmware}
	BOARD="$BATS_TEST_TMPDIR/board"
	CALLS="$BATS_TEST_TMPDIR/calls"
	local bin="$BATS_TEST_TMPDIR/stand-ins" board_bin="$BATS_TEST_TMPDIR/board-bin"
	mkdir -p "$BOARD/tmp" "$bin" "$board_bin"
	if [ -n "$boot" ]; then
		mkdir -p "$BOARD$boot/overlays"
		printf '[all]\ndtparam=audio=on\n' >"$BOARD$boot/config.txt"
	fi
	echo s3cr3t-board-pw >"$BOARD/password"
	# sshpass -e <tool> <arguments>: the password from SSHPASS; 5, as sshpass, when it is wrong.
	cat >"$bin/sshpass" <<-EOF
		#!/bin/sh
		echo "sshpass \$*" >>"$CALLS"
		[ "\$1" = -e ] || exit 3
		shift
		[ "\$SSHPASS" = "\$(cat "$BOARD/password")" ] || exit 5
		exec "\$@"
	EOF
	# ssh <-o option>... <user>@<host> <command>: the command run on the board, its paths under $BOARD.
	cat >"$bin/ssh" <<-EOF
		#!/bin/sh
		echo "ssh \$*" >>"$CALLS"
		while [ "\$1" = -o ]; do shift 2; done
		[ -e "$BOARD/down" ] && { echo "ssh: connect to host: Connection timed out" >&2; exit 255; }
		command=\$(printf '%s' "\$2" | sed -e "s#/tmp/analog-attach-#$BOARD/tmp/analog-attach-#g" -e "s#/boot#$BOARD/boot#g")
		PATH="$board_bin:\$PATH" exec sh -c "\$command"
	EOF
	# scp <-o option>... <file> <user>@<host>:<path>: the file copied to the board.
	cat >"$bin/scp" <<-EOF
		#!/bin/sh
		echo "scp \$*" >>"$CALLS"
		while [ "\$1" = -o ]; do shift 2; done
		[ -e "$BOARD/down" ] && { echo "ssh: connect to host: Connection timed out" >&2; exit 255; }
		[ -e "$BOARD/scp-fails" ] && { echo "scp: dest open: Permission denied" >&2; exit 1; }
		cp "\$1" "$BOARD\${2#*:}"
	EOF
	# The board's sudo -S -p '' <command>: the password on its standard input.
	cat >"$board_bin/sudo" <<-EOF
		#!/bin/sh
		echo "sudo \$*" >>"$CALLS"
		[ "\$1" = -S ] || exit 1
		shift 3
		read -r password
		[ "\$password" = "\$(cat "$BOARD/password")" ] || { echo "sudo: incorrect password" >&2; exit 1; }
		exec "\$@"
	EOF
	printf '#!/bin/sh\necho "reboot $*" >>"%s"\ntouch "%s/rebooted"\n' "$CALLS" "$BOARD" >"$board_bin/reboot"
	chmod +x "$bin"/* "$board_bin"/*
	STAND_INS="$bin:$PATH"
}

# `wait_reboot`: the board's reboot ran (aa_deploy.sh starts it in the background, a second later).
wait_reboot() {
	local tries=0
	while [ ! -e "$BOARD/rebooted" ] && [ $tries -lt 50 ]; do
		sleep 0.1
		tries=$((tries + 1))
	done
	[ -e "$BOARD/rebooted" ] || fail "the board was not rebooted"
}

# `deploy_json`: deploy, with --json, through the stand-ins, with the password in the environment.
deploy_json() {
	BOARD_PASSWORD=s3cr3t-board-pw PATH="$STAND_INS" run_json deploy
}

# Description: deploy of an overlay that was never built is refused, the starter saying to build it
# first, and copies nothing.
# Steps:
#   1. Set up the simulated board.
#   2. Run deploy, with --json and the password in the environment; check it is refused, the
#      message saying aa_deploy.sh exited with status 1, then that the .dtbo is not found and to
#      run build first.
#   3. Check the stand-ins were not called.
# bats test_tags=req:DEPLOY-01, id:L0102
@test "deploy of an overlay that was never built says to build it first" {
	board
	deploy_json
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' tool-failed
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: '"$PROJECT/build/overlay.dtbo not found: run analog-attach build first"
	[ ! -e "$CALLS" ]
}

# Description: deploy copies the built .dtbo to the board's boot folder's overlays/, adds it to
# config.txt, and reboots the board.
# Steps:
#   1. Build the overlay and set up the simulated board (boot folder /boot/firmware).
#   2. Run deploy, with --json and the password in the environment; check it succeeds with the
#      message Deployed <.dtbo> with AA_DEPLOY.
#   3. Check the board's /boot/firmware/overlays/overlay.dtbo is the .dtbo, nothing is left in
#      its /tmp, and its config.txt ends with [all] and dtoverlay=overlay.
#   4. Check the board was rebooted.
# bats test_tags=req:DEPLOY-01, req:DEPLOY-03, req:SET-14-LNX, id:L0103
@test "deploy copies the .dtbo to the board's overlays, adds it to config.txt, then reboots it" {
	aa build >/dev/null
	board
	deploy_json
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Deployed $PROJECT/build/overlay.dtbo with AA_DEPLOY"
	cmp "$PROJECT/build/overlay.dtbo" "$BOARD/boot/firmware/overlays/overlay.dtbo"
	[ -z "$(ls "$BOARD/tmp")" ] || fail "left in /tmp: $(ls "$BOARD/tmp")"
	run tail -n 2 "$BOARD/boot/firmware/config.txt"
	assert_output "$(printf '[all]\ndtoverlay=overlay')"
	wait_reboot
}

# Description: in human mode, deploy says it completed on standard output, and the steps of
# aa_deploy.sh are on standard error.
# Steps:
#   1. Build the overlay and set up the simulated board.
#   2. Run deploy with the password in the environment.
#   3. Check standard output is Deploy completed successfully, and standard error has the
#      progress line, then the board check, the copy, the config.txt line and the reboot.
# bats test_tags=req:DEPLOY-03, id:L0104
@test "deploy in human mode says what it copied where" {
	aa build >/dev/null
	board
	BOARD_PASSWORD=s3cr3t-board-pw PATH="$STAND_INS" run --separate-stderr aa deploy
	assert_success
	assert_output "Deploy completed successfully"
	local line
	for line in "Deploying $PROJECT/build/overlay.dtbo with AA_DEPLOY" "Checking pi@10.0.0.5" \
		"Copying overlay.dtbo to pi@10.0.0.5:/boot/firmware/overlays/overlay.dtbo" \
		"Added dtoverlay=overlay to /boot/firmware/config.txt" "Rebooting pi@10.0.0.5"; do
		[[ "$stderr" == *"$line"* ]] || fail "no '$line' on standard error: $stderr"
	done
	wait_reboot
}

# Description: the password reaches the board through the environment and sudo's standard input,
# never on a command line, and is written nowhere in the project.
# Steps:
#   1. Build the overlay and set up the simulated board.
#   2. Run deploy, with --json and the password in the environment; check it succeeds.
#   3. Check sshpass and sudo were called, and no recorded command line has the password.
#   4. Check no file of the project has it.
# bats test_tags=req:DEPLOY-03, req:SET-16-LNX, id:L0105
@test "deploy passes the password in the environment, not on the command line" {
	aa build >/dev/null
	board
	deploy_json
	assert_json '.ok' true
	wait_reboot
	run grep -c '^sshpass -e ssh' "$CALLS"
	[ "$output" -gt 0 ] || fail "sshpass was not used"
	run grep -c '^sudo -S' "$CALLS"
	[ "$output" -gt 0 ] || fail "sudo was not used"
	run grep -c s3cr3t-board-pw "$CALLS"
	assert_output 0
	run grep -rl s3cr3t-board-pw "$PROJECT"
	assert_output ""
}

# Description: deploy uses the board's variables as they are set at the time; as root it needs no
# sudo.
# Steps:
#   1. Build the overlay, set up the simulated board, and set BOARD_IP to board.local and
#      BOARD_USER to root.
#   2. Run deploy, with --json and the password in the environment; check it succeeds.
#   3. Check ssh and scp went to root@board.local, and sudo was not called.
# bats test_tags=req:DEPLOY-03, req:SET-15-LNX, id:L0106
@test "deploy uses the board's variables as they are set" {
	aa build >/dev/null
	board
	aa config var BOARD_IP board.local >/dev/null
	aa config var BOARD_USER root >/dev/null
	deploy_json
	assert_json '.ok' true
	wait_reboot
	run grep -c 'root@board.local' "$CALLS"
	[ "$output" -gt 0 ] || fail "nothing went to root@board.local: $(cat "$CALLS")"
	run grep -c '10.0.0.5\|pi@' "$CALLS"
	assert_output 0
	run grep -c '^sudo' "$CALLS"
	assert_output 0
}

# Description: a failed copy shows scp's message, says the deploy failed, and doesn't reboot the
# board.
# Steps:
#   1. Build the overlay and set up the simulated board, whose copies fail.
#   2. Run deploy with the password in the environment; check it is refused (exit 0), standard
#      output is Deploy failed: AA_DEPLOY exited with status 1, and scp's message is on standard
#      error.
#   3. Run deploy, with --json; check .ok is false and the message ends with scp's message.
#   4. Check the board was not rebooted and its config.txt is unchanged.
# bats test_tags=req:DEPLOY-03, id:L0107
@test "a failed copy shows scp's messages, says the deploy failed and doesn't reboot" {
	aa build >/dev/null
	board
	touch "$BOARD/scp-fails"
	BOARD_PASSWORD=s3cr3t-board-pw PATH="$STAND_INS" run --separate-stderr aa deploy
	assert_success  # a refusal: the command ran (GEN-09)
	assert_output "Deploy failed: AA_DEPLOY exited with status 1"
	[[ "$stderr" == *"scp: dest open: Permission denied"* ]] || fail "standard error: $stderr"
	deploy_json
	assert_json '.ok' false
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\nscp: dest open: Permission denied'
	sleep 1.5
	[ ! -e "$BOARD/rebooted" ]
	run grep -c dtoverlay "$BOARD/boot/firmware/config.txt"
	assert_output 0
}

# Description: the starter aa_deploy.sh stops before anything when sshpass isn't on PATH, naming it.
# Steps:
#   1. Build the overlay.
#   2. Run deploy, with --json and the password in the environment, with a PATH of everything
#      but sshpass; check it is refused, the message saying sshpass is not on PATH.
# bats test_tags=req:DEPLOY-03, id:L0108
@test "deploy reports sshpass missing" {
	aa build >/dev/null
	local bin="$BATS_TEST_TMPDIR/path-without-sshpass" directory directories
	mkdir -p "$bin"
	IFS=: read -ra directories <<<"$PATH"
	for directory in "${directories[@]}"; do
		[ -d "$directory" ] && ln -s "$directory"/* "$bin/" 2>/dev/null || true
	done
	rm -f "$bin/sshpass"
	BOARD_PASSWORD=s3cr3t-board-pw PATH="$bin" run_json deploy
	assert_json '.ok' false
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: sshpass is not on PATH'
}

# Description: with a board variable unset, the starter aa_deploy.sh names it and the config var
# command that sets it, and copies nothing.
# Steps:
#   1. Build the overlay, set up the simulated board, and reset BOARD_IP.
#   2. Run deploy, with --json and the password in the environment; check it is refused, the
#      message saying BOARD_IP is not set and how to set it.
#   3. Check the stand-ins were not called.
# bats test_tags=req:GEN-13, req:SET-15-LNX, id:L0109
@test "deploy with no board set names the variable, and copies nothing" {
	aa build >/dev/null
	board
	aa config var BOARD_IP --reset >/dev/null
	deploy_json
	assert_json '.ok' false
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: BOARD_IP is not set: analog-attach config var BOARD_IP <address>'
	[ ! -e "$CALLS" ]
}

# Description: deploy changes no file of the project.
# Steps:
#   1. Build the overlay and set up the simulated board.
#   2. Take the checksums of every file in the project.
#   3. Run deploy, with --json and the password in the environment; check it succeeds.
#   4. Check every file's checksum is the same.
# bats test_tags=req:DEPLOY-01, id:L0110
@test "deploy changes no file of the project" {
	aa build >/dev/null
	board
	local before
	before=$(cd "$PROJECT" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
	deploy_json
	assert_json '.ok' true
	wait_reboot
	[ "$(cd "$PROJECT" && find . -type f -print0 | sort -z | xargs -0 sha256sum)" = "$before" ]
}

# Description: deploy puts the built overlay on a real device and reboots it; skipped unless
# AA_DEPLOY_IP is set.
# Steps:
#   1. Skip without AA_DEPLOY_IP, or without ssh, scp and sshpass.
#   2. Set BOARD_IP and BOARD_USER from the environment, and build the overlay.
#   3. Run deploy with BOARD_PASSWORD from AA_DEPLOY_PASSWORD.
#   4. Check it succeeds and says it completed.
# bats test_tags=req:DEPLOY-01, req:DEPLOY-03, needs:board, id:L0111
@test "deploy puts the built overlay on a real device and reboots it" {
	[ -n "${AA_DEPLOY_IP:-}" ] || skip "copies to a device and reboots it (set AA_DEPLOY_IP, AA_DEPLOY_USER, AA_DEPLOY_PASSWORD)"
	need ssh scp sshpass
	aa config var BOARD_IP "$AA_DEPLOY_IP" >/dev/null
	aa config var BOARD_USER "${AA_DEPLOY_USER:-analog}" >/dev/null
	aa build >/dev/null
	BOARD_PASSWORD="${AA_DEPLOY_PASSWORD:-analog}" run --separate-stderr aa deploy
	assert_success
	assert_output "Deploy completed successfully"
}

# Description: with output devicetree, deploy copies the built .dtb over the board's
# /boot/devicetree.dtb, then reboots it, leaving config.txt alone; before a build the starter
# says the .dtb is missing.
# Steps:
#   1. Set output to devicetree and set up the simulated board.
#   2. Run deploy, with --json and the password in the environment; check it is refused, saying
#      build/overlay.dtb is not found.
#   3. Build, then run deploy, with --json; check it succeeds, naming the .dtb.
#   4. Check the board's /boot/devicetree.dtb is the .dtb, its config.txt is unchanged, and it
#      was rebooted.
# bats test_tags=req:DEPLOY-01, req:DEPLOY-03-FULL, req:SET-12-LNX, id:L0358
@test "with output devicetree, deploy copies the .dtb over the device's devicetree, then reboots it" {
	aa config output devicetree >/dev/null
	board
	deploy_json
	assert_json '.ok' false
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: '"$PROJECT/build/overlay.dtb not found: run analog-attach build first"
	aa build >/dev/null
	deploy_json
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Deployed $PROJECT/build/overlay.dtb with AA_DEPLOY"
	cmp "$PROJECT/build/overlay.dtb" "$BOARD/boot/devicetree.dtb"
	run grep -c dtoverlay "$BOARD/boot/firmware/config.txt"
	assert_output 0
	wait_reboot
}

# --- The script and its secret ---------------------------------------------------------------

# Description: with no aa_deploy.sh at the project root, deploy is refused with a configuration error
# that says how to write the starter, together with a secret it can't get, and writes no script.
# Steps:
#   1. Remove aa_deploy.sh.
#   2. Run deploy, with --json and no password in the environment; check it is refused, the
#      errors on aa_deploy.sh (missing, not-generated) and BOARD_PASSWORD, the first hint
#      init --restore deploy.
#   3. Check no aa_deploy.sh was written.
# bats test_tags=req:SET-14-LNX, req:DEPLOY-01, id:L0410
@test "deploy with no aa_deploy.sh says how to restore it, and doesn't write one itself" {
	rm "$PROJECT/aa_deploy.sh"
	run_config_error deploy
	assert_json '[.errors[].field] | join(",")' 'aa_deploy.sh,BOARD_PASSWORD'
	assert_json '.errors[0] | [.kind, .error_type, .message] | join(" | ")' "missing | not-generated | aa_deploy.sh not found in $PROJECT"
	assert_json '.hints[0]' "Run 'analog-attach init --restore deploy' to write the starter aa_deploy.sh, or set AA_DEPLOY to another command ('analog-attach config var AA_DEPLOY <command>')."
	[ ! -e "$PROJECT/aa_deploy.sh" ]
}

# Description: deploy runs AA_DEPLOY, a command of the project's in place of aa_deploy.sh, in the
# project root with the scripts' variables and the secret's value, its output shown; aa_deploy.sh
# then isn't needed.
# Steps:
#   1. Build the overlay, remove aa_deploy.sh, and set AA_DEPLOY to two lines: echo the .dtbo and the
#      user, then copy $AA_DTBO to deployed.dtbo when $BOARD_PASSWORD is the one given.
#   2. Run deploy, with --json and the password in the environment; check it succeeds with the
#      message Deployed <.dtbo> with AA_DEPLOY, and deployed.dtbo in the project is the .dtbo.
#   3. Run deploy in human mode; check standard output is Deploy completed successfully, and
#      standard error has the progress line naming AA_DEPLOY and the command's line.
# bats test_tags=req:DEPLOY-01, req:SET-17-LNX, req:SET-16-LNX, id:L0496
@test "deploy runs AA_DEPLOY, a command of the project's, in place of aa_deploy.sh" {
	aa build >/dev/null
	rm "$PROJECT/aa_deploy.sh"
	aa config var AA_DEPLOY $'echo "sending $AA_DTBO as $BOARD_USER"\n[ "$BOARD_PASSWORD" = pw ] && cp "$AA_DTBO" deployed.dtbo' >/dev/null
	BOARD_PASSWORD=pw run_json deploy
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Deployed $PROJECT/build/overlay.dtbo with AA_DEPLOY"
	cmp "$PROJECT/build/overlay.dtbo" "$PROJECT/deployed.dtbo"
	BOARD_PASSWORD=pw run --separate-stderr aa deploy
	assert_success
	assert_output "Deploy completed successfully"
	[[ "$stderr" == *"Deploying $PROJECT/build/overlay.dtbo with AA_DEPLOY"* ]] || fail "no progress line: $stderr"
	[[ "$stderr" == *"sending $PROJECT/build/overlay.dtbo as pi"* ]] || fail "the command's line isn't on standard error: $stderr"
}

# Description: on an older Kuiper, whose boot folder is /boot, deploy copies there and adds the
# overlay to /boot/config.txt.
# Steps:
#   1. Build the overlay and set up the simulated board with the boot folder /boot.
#   2. Run deploy, with --json and the password in the environment; check it succeeds.
#   3. Check the board's /boot/overlays/overlay.dtbo is the .dtbo and /boot/config.txt ends with
#      dtoverlay=overlay.
# bats test_tags=req:DEPLOY-03, id:L0411
@test "deploy finds the boot folder of an older Kuiper" {
	aa build >/dev/null
	board /boot
	deploy_json
	assert_json '.ok' true
	cmp "$PROJECT/build/overlay.dtbo" "$BOARD/boot/overlays/overlay.dtbo"
	run tail -n 1 "$BOARD/boot/config.txt"
	assert_output dtoverlay=overlay
	wait_reboot
}

# Description: deploy adds the overlay to config.txt only once: a second deploy finds it there.
# Steps:
#   1. Build the overlay, set up the simulated board, and deploy, with --json and the password
#      in the environment.
#   2. Deploy again; check it succeeds and standard error says config.txt already has it.
#   3. Check config.txt has dtoverlay=overlay once.
# bats test_tags=req:DEPLOY-03, id:L0412
@test "deploy adds the overlay to config.txt only when it is missing" {
	aa build >/dev/null
	board
	deploy_json
	assert_json '.ok' true
	wait_reboot
	deploy_json
	assert_json '.ok' true
	[[ "$stderr" == *"/boot/firmware/config.txt already has dtoverlay=overlay"* ]] || fail "standard error: $stderr"
	run grep -c '^dtoverlay=overlay$' "$BOARD/boot/firmware/config.txt"
	assert_output 1
}

# Description: a wrong password, or a board that doesn't answer, is refused with what went wrong,
# and nothing is copied.
# Steps:
#   1. Build the overlay and set up the simulated board.
#   2. Run deploy, with --json and a wrong password in the environment; check it is refused,
#      saying the board refused the password.
#   3. Make the board not answer; deploy with the right password; check it is refused, saying
#      the board doesn't answer over SSH, with ssh's status 255.
#   4. Check nothing was copied to the board.
# bats test_tags=req:DEPLOY-03, id:L0413
@test "deploy says when the board refuses the password or doesn't answer" {
	aa build >/dev/null
	board
	BOARD_PASSWORD=wrong PATH="$STAND_INS" run_json deploy
	assert_json '.ok' false
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: pi@10.0.0.5 refused the password'
	touch "$BOARD/down"
	deploy_json
	assert_json '.ok' false
	assert_json '.message | endswith("aa_deploy.sh: pi@10.0.0.5 does not answer over SSH (exit status 255)")' true
	[ ! -e "$BOARD/boot/firmware/overlays/overlay.dtbo" ]
}

# Description: a board without an overlays folder in /boot/firmware or /boot is refused as not a
# Raspberry Pi running Kuiper.
# Steps:
#   1. Build the overlay and set up the simulated board with no boot folder.
#   2. Run deploy, with --json and the password in the environment; check it is refused with
#      that message, and the board was not rebooted.
# bats test_tags=req:DEPLOY-03, id:L0414
@test "deploy refuses a board that isn't a Raspberry Pi running Kuiper" {
	aa build >/dev/null
	board ""
	deploy_json
	assert_json '.ok' false
	assert_json '.message' $'Deploy failed: AA_DEPLOY exited with status 1\naa_deploy.sh: no /boot/firmware/overlays or /boot/overlays on pi@10.0.0.5: is it a Raspberry Pi running Kuiper?'
	[ ! -e "$BOARD/rebooted" ]
}

# Description: piped or with --json, a secret the environment doesn't have is refused by name,
# with how to give it, and aa_deploy.sh doesn't run; an empty value counts as none.
# Steps:
#   1. Build the overlay and set up the simulated board.
#   2. Run deploy, with --json and no password in the environment; check it is refused with a
#      configuration error on BOARD_PASSWORD, missing-setting, saying it is not in the
#      environment, and the hint naming BOARD_PASSWORD=… deploy and a terminal.
#   3. Run it with BOARD_PASSWORD empty; check the same refusal.
#   4. Run deploy in human mode with standard input from /dev/null; check it says the same.
#   5. Check the stand-ins were not called.
# bats test_tags=req:SET-16-LNX, id:L0415
@test "a secret not in the environment is refused by name when deploy can't ask" {
	aa build >/dev/null
	board
	PATH="$STAND_INS" run_config_error deploy
	assert_json '.errors[0] | [.field, .kind, .error_type, .message] | join(" | ")' 'BOARD_PASSWORD | missing | missing-setting | Secret variable BOARD_PASSWORD is not in the environment'
	assert_json '.hints[0]' 'Set it in the environment deploy runs in (BOARD_PASSWORD=… analog-attach deploy), or run deploy on a terminal, which asks for it.'
	BOARD_PASSWORD="" PATH="$STAND_INS" run_config_error deploy
	assert_json '.errors[0].field' BOARD_PASSWORD
	PATH="$STAND_INS" run --separate-stderr aa deploy </dev/null
	assert_success
	assert_line --index 0 "Secret variable BOARD_PASSWORD is not in the environment"
	[ ! -e "$CALLS" ]
}

# Description: on a terminal, deploy asks for a secret the environment doesn't have, without
# showing what is typed, and deploys with it; stopping the question deploys nothing.
# Steps:
#   1. Build the overlay and set up the simulated board.
#   2. Run deploy on a terminal; at BOARD_PASSWORD: type the password and Enter.
#   3. Check it exits 0, says Deploy completed successfully, and the screen never shows the
#      password.
#   4. Run deploy on a terminal again and press Ctrl-C at the question; check it exits 130,
#      saying nothing was deployed.
# bats test_tags=req:SET-16-LNX, id:L0416
@test "on a terminal, deploy asks for the secret without showing it" {
	aa build >/dev/null
	board
	PATH="$STAND_INS" tty_run "BOARD_PASSWORD:" $'s3cr3t-board-pw\r' -- deploy
	assert_success
	assert_output --partial "Deploy completed successfully"
	refute_output --partial s3cr3t-board-pw
	wait_reboot
	PATH="$STAND_INS" tty_run "BOARD_PASSWORD:" $'\x03' -- deploy
	assert_failure 130
	assert_output --partial "Stopped: nothing was deployed."
}
