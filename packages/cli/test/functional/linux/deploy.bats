# deploy where the backend is linux: the .dtbo copied to the device's /boot/overlays/ over
# scp, then the device rebooted.
#
# The tests run stand-ins for sshpass and scp, which record what they were given. Nothing here
# reaches a device unless AA_DEPLOY_IP is set (with AA_DEPLOY_USER and AA_DEPLOY_PASSWORD):
# that test copies to the device and reboots it.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, deploy-ip 10.0.0.5,
# deploy-user pi and deploy-password secret, and an empty overlay created with init (not built).
setup() {
	load ../helpers
	new_project linux deploy-ip=10.0.0.5 deploy-user=pi deploy-password=secret
	with_overlay
}

# `run_config_error <words>`: run_json for a configuration error, which is JSON on standard
# error (exit 2): $output is that JSON.
run_config_error() {
	run_json "$@"
	assert_failure 2
	output=$stderr
}

# `stand_ins [<scp exit status>]`: sshpass and scp stand-ins first on PATH. sshpass appends
# a line to $CALLS per run: its arguments, then `SSHPASS=<value>`; it exits with the given
# status when it runs scp (0 by default), and 255 for ssh, as a reboot that drops the
# connection does. Sets $STAND_INS, the PATH to run with.
stand_ins() {
	local dir="$BATS_TEST_TMPDIR/stand-ins"
	CALLS="$BATS_TEST_TMPDIR/calls"
	mkdir -p "$dir"
	cat >"$dir/sshpass" <<-EOF
		#!/bin/sh
		echo "\$* SSHPASS=\$SSHPASS" >>"$CALLS"
		[ "\$2" = scp ] || exit 255
		[ "${1:-0}" = 0 ] || echo "scp: connection refused" >&2
		exit ${1:-0}
	EOF
	printf '#!/bin/sh\nexit 0\n' >"$dir/scp"
	chmod +x "$dir/sshpass" "$dir/scp"
	STAND_INS="$dir:$PATH"
}

# `path_with_only <tool>...`: a PATH that has node and which, and of the others only the named
# tools: `scp` and `sshpass` are not found unless named.
path_with_only() {
	local dir="$BATS_TEST_TMPDIR/only" tool
	mkdir -p "$dir"
	for tool in node which "$@"; do
		ln -sf "$(command -v "$tool")" "$dir/$tool"
	done
	echo "$dir"
}

# Description: deploy of an overlay that was never built fails with a configuration error saying
# to build it first, and copies nothing.
# Steps:
#   1. Put the sshpass and scp stand-ins on PATH.
#   2. Run deploy, with --json; check it fails with exit 2, the error is on workfile and says the
#      .dtbo is not found, and the hint says to run build first.
#   3. Check the stand-ins were not called.
#   4. Run deploy in human mode; check it gives the same message and hint.
# bats test_tags=req:DEPLOY-01, id:L0102
@test "deploy of an overlay that was never built says to build it first" {
	stand_ins
	PATH="$STAND_INS" run_config_error deploy
	assert_json '.errors[0].field' workfile
	assert_json '.errors[0].message' "Compiled overlay $PROJECT/overlay.dtbo not found"
	assert_json '.hints[0]' "Run 'build' first."
	[ ! -e "$CALLS" ]
	PATH="$STAND_INS" run aa deploy
	assert_output --partial "Compiled overlay $PROJECT/overlay.dtbo not found"
	assert_output --partial "Run 'build' first."
}

# Description: deploy copies the built .dtbo to the device's /boot/overlays/ with scp through
# sshpass, then reboots the device over ssh.
# Steps:
#   1. Build the overlay and put the stand-ins on PATH.
#   2. Run deploy, with --json; check it succeeds (.ok true), says deployed and rebooted, with
#      host 10.0.0.5 and remote path /boot/overlays/.
#   3. Check the first call is scp of overlay.dtbo to pi@10.0.0.5:/boot/overlays/ and the second
#      ssh pi@10.0.0.5 sudo reboot, both with host key checks off and SSHPASS set.
# bats test_tags=req:DEPLOY-01, req:DEPLOY-03, req:SET-10-LNX, id:L0103
@test "deploy copies the .dtbo to the device's overlay directory, then reboots it" {
	aa build >/dev/null
	stand_ins
	PATH="$STAND_INS" run_json deploy
	assert_success
	assert_json '.ok' true
	assert_json '.message' 'Deployed and rebooted'
	assert_json '.host' 10.0.0.5
	assert_json '.remote_path' /boot/overlays/
	run cat "$CALLS"
	assert_line --index 0 "-e scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $PROJECT/overlay.dtbo pi@10.0.0.5:/boot/overlays/ SSHPASS=secret"
	assert_line --index 1 "-e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null pi@10.0.0.5 sudo reboot SSHPASS=secret"
}

# Description: in human mode, deploy says which file it copied to which device and directory,
# and that it rebooted.
# Steps:
#   1. Build the overlay and put the stand-ins on PATH.
#   2. Run deploy.
#   3. Check it succeeds and the output names the .dtbo, pi@10.0.0.5:/boot/overlays/ and the
#      reboot.
# bats test_tags=req:DEPLOY-03, id:L0104
@test "deploy in human mode says what it copied where" {
	aa build >/dev/null
	stand_ins
	PATH="$STAND_INS" run aa deploy
	assert_success
	assert_output "Deployed $PROJECT/overlay.dtbo to pi@10.0.0.5:/boot/overlays/ and rebooted"
}

# Description: deploy passes the password to sshpass in the environment, never on the command
# line.
# Steps:
#   1. Build the overlay and put the stand-ins on PATH.
#   2. Run deploy, with --json; check it succeeds (.ok true).
#   3. Check the password shows in both recorded calls, and only as the SSHPASS value, not among
#      the arguments.
# bats test_tags=req:DEPLOY-03, req:SET-10-LNX, id:L0105
@test "deploy passes the password in the environment, not on the command line" {
	aa build >/dev/null
	stand_ins
	PATH="$STAND_INS" run_json deploy
	assert_json '.ok' true
	run grep -c 'secret' "$CALLS"
	assert_output 2
	# Only as SSHPASS: the arguments don't carry it.
	run grep -c 'secret.*SSHPASS' "$CALLS"
	assert_output 0
}

# Description: deploy uses the deploy settings as they are set at the time.
# Steps:
#   1. Build the overlay and set deploy-ip board.local, deploy-user root, deploy-password other.
#   2. Put the stand-ins on PATH and run deploy, with --json.
#   3. Check the host is board.local and the copy goes to root@board.local with SSHPASS other.
# bats test_tags=req:DEPLOY-03, req:SET-10-LNX, id:L0106
@test "deploy uses the deploy settings as they are set" {
	aa build >/dev/null
	aa config deploy-ip board.local >/dev/null
	aa config deploy-user root >/dev/null
	aa config deploy-password other >/dev/null
	stand_ins
	PATH="$STAND_INS" run_json deploy
	assert_json '.host' board.local
	run cat "$CALLS"
	assert_line --index 0 --partial "root@board.local:/boot/overlays/ SSHPASS=other"
}

# Description: a failed copy shows scp's messages, says the deploy failed, and does not reboot
# the device.
# Steps:
#   1. Build the overlay and put on PATH stand-ins whose scp fails.
#   2. Run deploy; check it is refused (exit 0) and the output starts with Deploy failed (scp)
#      and shows scp's message.
#   3. Run deploy, with --json; check .ok is false and the message holds scp's message.
#   4. Check no reboot was run.
# bats test_tags=req:DEPLOY-03, id:L0107
@test "a failed copy shows scp's messages, says the deploy failed and doesn't reboot" {
	aa build >/dev/null
	stand_ins 1
	PATH="$STAND_INS" run aa deploy
	assert_success  # a refusal: the command ran (GEN-09)
	assert_line --index 0 "Deploy failed (scp):"
	assert_output --partial "scp: connection refused"
	PATH="$STAND_INS" run_json deploy
	assert_json '.ok' false
	assert_json '.message == "Deploy failed (scp):\nscp: connection refused\n"' true
	# Two copies, no reboot.
	run grep -c 'sudo reboot' "$CALLS"
	assert_output 0
}

# Description: deploy fails with a configuration error naming the missing tools when scp or
# sshpass is not on PATH.
# Steps:
#   1. Build the overlay.
#   2. Run deploy, with --json, on a PATH with neither scp nor sshpass; check it fails with
#      exit 2 and the error, on deploy, names both tools.
#   3. Run it again on a PATH with scp only; check the error names sshpass alone.
# bats test_tags=req:DEPLOY-03, id:L0108
@test "deploy reports scp and sshpass missing" {
	aa build >/dev/null
	local path
	# bats itself needs the usual PATH: only the CLI runs with the other one.
	path=$(path_with_only)
	run --separate-stderr env PATH="$path" node "$CLI_DIR/dist/cli.js" --json deploy
	assert_failure 2
	output=$stderr
	assert_json '.errors[0].field' deploy
	assert_json '.errors[0].message' 'scp, sshpass not found on PATH (needed to deploy)'
	path=$(path_with_only scp)
	run --separate-stderr env PATH="$path" node "$CLI_DIR/dist/cli.js" --json deploy
	output=$stderr
	assert_json '.errors[0].message' 'sshpass not found on PATH (needed to deploy)'
}

# Gap: the errors name the deploy settings but not how to set them (setting_hint gives no
# deploy-* a hint).
# Description: deploy with no device address or password fails with a configuration error naming
# the missing settings and how to set them, and copies nothing.
# Steps:
#   1. Build the overlay and drop the deploy-ip and deploy-password settings.
#   2. Put the stand-ins on PATH and run deploy, with --json; check it fails with exit 2 and the
#      errors name deploy-ip and deploy-password.
#   3. Check the stand-ins were not called.
#   4. Run deploy in human mode; check it says both settings are missing.
#   5. Check both runs say how to set them with config: the first JSON error's hint, and the
#      human output for each.
# bats test_tags=req:GEN-13, req:SET-10-LNX, gap, id:L0109
@test "deploy with no device set names the settings, and copies nothing" {
	aa build >/dev/null
	drop_setting deploy-ip deploy-password
	stand_ins
	PATH="$STAND_INS" run_config_error deploy
	assert_json '[.errors[].field] | join(",")' 'deploy-ip,deploy-password'
	assert_json '.errors[0].message' 'Missing config field deploy-ip'
	local json=$output
	[ ! -e "$CALLS" ]
	PATH="$STAND_INS" run aa deploy
	assert_output --partial "Missing config field deploy-ip"
	assert_output --partial "Missing config field deploy-password"
	# The gap: last, so the checks above hold while it is open.
	jq -e '.errors[0].hint // "" | test("analog-attach config deploy-ip")' <<<"$json" >/dev/null ||
		fail "no hint saying how to set deploy-ip in: $json"
	assert_output --partial "analog-attach config deploy-ip"
	assert_output --partial "analog-attach config deploy-password"
}

# Description: deploy changes no file of the project.
# Steps:
#   1. Build the overlay and put the stand-ins on PATH.
#   2. Take the checksums of every file in the project.
#   3. Run deploy, with --json; check it succeeds (.ok true).
#   4. Check every file's checksum is the same.
# bats test_tags=req:DEPLOY-01, id:L0110
@test "deploy changes no file of the project" {
	aa build >/dev/null
	stand_ins
	local before
	before=$(cd "$PROJECT" && find . -type f -print0 | sort -z | xargs -0 sha256sum)
	PATH="$STAND_INS" run_json deploy
	assert_json '.ok' true
	[ "$(cd "$PROJECT" && find . -type f -print0 | sort -z | xargs -0 sha256sum)" = "$before" ]
}

# Description: deploy puts the built overlay on a real device and reboots it; skipped unless
# AA_DEPLOY_IP is set.
# Steps:
#   1. Skip without AA_DEPLOY_IP, or without scp and sshpass.
#   2. Set deploy-ip, deploy-user and deploy-password from the environment, and build the overlay.
#   3. Run deploy.
#   4. Check it succeeds and says it deployed the .dtbo to the device's /boot/overlays/ and
#      rebooted it.
# bats test_tags=req:DEPLOY-01, req:DEPLOY-03, needs:board, id:L0111
@test "deploy puts the built overlay on a real device and reboots it" {
	[ -n "${AA_DEPLOY_IP:-}" ] || skip "copies to a device and reboots it (set AA_DEPLOY_IP, AA_DEPLOY_USER, AA_DEPLOY_PASSWORD)"
	need scp sshpass
	aa config deploy-ip "$AA_DEPLOY_IP" >/dev/null
	aa config deploy-user "${AA_DEPLOY_USER:-pi}" >/dev/null
	aa config deploy-password "${AA_DEPLOY_PASSWORD:-raspberry}" >/dev/null
	aa build >/dev/null
	run aa deploy
	assert_success
	assert_output "Deployed $PROJECT/overlay.dtbo to ${AA_DEPLOY_USER:-pi}@$AA_DEPLOY_IP:/boot/overlays/ and rebooted"
}
