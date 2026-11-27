// The starter scripts `init` writes at the project root (spec init.md INIT-100 to INIT-106):
// `aa_build.sh` does what `build` did with dtc, `aa_deploy.sh` copies to a Raspberry Pi running
// Kuiper and reboots it. They are the user's from then on; `init --restore <build|deploy>`
// writes one again. POSIX sh, so they run wherever `/bin/sh` does. Each has the project
// variables it uses (`STARTER_VARIABLES`), which init sets with it when the project has none of
// that name (INIT-107 to INIT-110).

import * as fs from "node:fs";
import path from "node:path";

import type { ProjectVariable, SettingsView } from "../../../../interface/backend-interface";
import { SCRIPTS, type ScriptCommand } from "../../config/workspace";

export const BUILD_STARTER = `#!/bin/sh
# aa_build.sh: what 'analog-attach build' runs, here at the project root, while AA_BUILD is
# ./aa_build.sh, its default ('analog-attach config var AA_BUILD <command>' runs another).
# Edit it as you need; 'analog-attach init --restore build' writes this starter again.
#
# It gets, among others (analog-attach config lists them all):
#   AA_OUTPUT     overlay or devicetree (the output setting)
#   AA_DTSO       the workfile, as it is on disk
#   AA_DTBO       output overlay: the .dtbo to write
#   AA_DTS        output devicetree: the full devicetree, preprocessed, that build wrote first
#   AA_DTB        output devicetree: the .dtb to write
#   AA_BUILD_DIR  the build folder
#   AA_DTC        the dtc on PATH, when there is one
# and every project variable (analog-attach config var <NAME> <value>).
set -e

fail() {
	echo "aa_build.sh: $*" >&2
	exit 1
}

case "$AA_OUTPUT" in
	devicetree)
		input=$AA_DTS
		output=$AA_DTB
		;;
	*)
		input=$AA_DTSO
		output=$AA_DTBO
		;;
esac

[ -n "$AA_DTC" ] || fail "dtc 1.6.0 or later is not on PATH: install it (the device-tree-compiler package)"
[ -f "$input" ] || fail "$input not found"

mkdir -p "$AA_BUILD_DIR"
echo "dtc -@ -I dts -O dtb -o $output $input"
"$AA_DTC" -@ -I dts -O dtb -o "$output" "$input"
`;

export const DEPLOY_STARTER = `#!/bin/sh
# aa_deploy.sh: what 'analog-attach deploy' runs, here at the project root, while AA_DEPLOY is
# ./aa_deploy.sh, its default ('analog-attach config var AA_DEPLOY <command>' runs another).
# Edit it as you need; 'analog-attach init --restore deploy' writes this starter again.
#
# It copies what aa_build.sh compiled to a Raspberry Pi running Kuiper, over SSH, and reboots it:
# an overlay into the boot folder's overlays/, with dtoverlay=<name> added to config.txt when
# it isn't there; with output devicetree, the .dtb over <boot folder>/devicetree.dtb.
#
# The board is three project variables, which 'analog-attach init' set when it wrote this
# script, to Kuiper's defaults (a variable the project had already was kept):
#   BOARD_IP        analog.local, the board's hostname over mDNS
#   BOARD_USER      analog
#   BOARD_PASSWORD  a secret: only its name is stored
# 'analog-attach config var' lists them; change one for your board:
#   analog-attach config var BOARD_IP 192.168.2.10
#   analog-attach config var BOARD_USER root
# The password is never stored: deploy takes it from the environment it runs in
# (BOARD_PASSWORD=... analog-attach deploy), or asks for it on a terminal. This script passes
# it to sshpass and sudo on their standard input or environment, never on a command line.
#
# It needs ssh, scp and sshpass on PATH.
set -e

fail() {
	echo "aa_deploy.sh: $*" >&2
	exit 1
}

[ -n "$BOARD_IP" ] || fail "BOARD_IP is not set: analog-attach config var BOARD_IP <address>"
[ -n "$BOARD_USER" ] || fail "BOARD_USER is not set: analog-attach config var BOARD_USER <user>"
[ -n "$BOARD_PASSWORD" ] || fail "BOARD_PASSWORD is not set: analog-attach config var BOARD_PASSWORD --secret"

case "$AA_OUTPUT" in
	devicetree) file=$AA_DTB ;;
	*) file=$AA_DTBO ;;
esac
[ -f "$file" ] || fail "$file not found: run analog-attach build first"

for tool in ssh scp sshpass; do
	command -v "$tool" >/dev/null 2>&1 || fail "$tool is not on PATH"
done

# sshpass reads the password from SSHPASS (-e).
SSHPASS=$BOARD_PASSWORD
export SSHPASS
OPTIONS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o LogLevel=ERROR"
board="$BOARD_USER@$BOARD_IP"

remote() {
	# shellcheck disable=SC2086
	sshpass -e ssh $OPTIONS "$board" "$1"
}

# A command as root on the board: sudo reads the password from its standard input.
as_root() {
	if [ "$BOARD_USER" = root ]; then
		remote "sh -c '$1'"
	else
		printf '%s\\n' "$BOARD_PASSWORD" | remote "sudo -S -p '' sh -c '$1'"
	fi
}

echo "Checking $board"
status=0
remote true || status=$?
case $status in
	0) ;;
	5) fail "$board refused the password" ;;
	*) fail "$board does not answer over SSH (exit status $status)" ;;
esac

name=$(basename "$file")
if [ "$AA_OUTPUT" = devicetree ]; then
	target=/boot/devicetree.dtb
else
	# Kuiper's boot folder: /boot/firmware on newer releases, /boot on older ones.
	if remote "test -d /boot/firmware/overlays"; then
		boot=/boot/firmware
	elif remote "test -d /boot/overlays"; then
		boot=/boot
	else
		fail "no /boot/firmware/overlays or /boot/overlays on $board: is it a Raspberry Pi running Kuiper?"
	fi
	target="$boot/overlays/$name"
fi

temporary="/tmp/analog-attach-$name"
echo "Copying $name to $board:$target"
# shellcheck disable=SC2086
sshpass -e scp $OPTIONS "$file" "$board:$temporary"
as_root "cp $temporary $target && rm -f $temporary"

if [ "$AA_OUTPUT" != devicetree ]; then
	overlay=\${name%.dtbo}
	config="$boot/config.txt"
	remote "test -f $config" || fail "$config not found on $board"
	if remote "grep -Eq '^[[:space:]]*dtoverlay=$overlay([,:]|\\$)' $config"; then
		echo "$config already has dtoverlay=$overlay"
	else
		as_root "printf \\"\\\\n[all]\\\\ndtoverlay=%s\\\\n\\" $overlay >> $config"
		echo "Added dtoverlay=$overlay to $config"
	fi
fi

echo "Rebooting $board"
# In the background, so the SSH session ends before the board goes down.
as_root "nohup sh -c \\"sleep 1; reboot\\" </dev/null >/dev/null 2>&1 &"
`;

/** The starter of each command's script. */
export const STARTERS: Readonly<Record<ScriptCommand, string>> = { build: BUILD_STARTER, deploy: DEPLOY_STARTER };

/**
 * The project variables each starter uses, set when `init` writes it (INIT-107): Kuiper's
 * default user and hostname, and the password a secret, its name alone. `aa_build.sh` uses none.
 */
export const STARTER_VARIABLES: Readonly<Record<ScriptCommand, readonly ProjectVariable[]>> = {
	build: [],
	deploy: [
		{ name: "BOARD_IP", secret: false, value: "analog.local" },
		{ name: "BOARD_USER", secret: false, value: "analog" },
		{ name: "BOARD_PASSWORD", secret: true },
	],
};

/** The variables a starter's write set, and the warning for each it couldn't. */
export interface StarterVariables {
	set: ProjectVariable[];
	problems: string[];
}

/**
 * Set `command`'s starter variables (`STARTER_VARIABLES`) the project doesn't have (INIT-107,
 * INIT-108): one it has is kept as it is, whatever its value or kind. One that can't be written
 * is a warning (INIT-109).
 */
export function set_starter_variables(command: ScriptCommand, settings: Pick<SettingsView, "variables" | "set_variable">): StarterVariables {
	const had = new Set(settings.variables().map(variable => variable.name));
	const result: StarterVariables = { set: [], problems: [] };
	for (const variable of STARTER_VARIABLES[command]) {
		if (had.has(variable.name)) { continue; }
		const written = settings.set_variable(variable.name, variable.secret ? { secret: true } : variable.value);
		if (written.ok) {
			result.set.push(variable);
		} else {
			result.problems.push(`warning: the variable ${variable.name} of ${SCRIPTS[command]} was not set: ${written.message}`);
		}
	}
	return result;
}

/** How a variable a starter's write set reads: `BOARD_IP = analog.local`, `BOARD_PASSWORD as a secret`, as `config var` says it. */
export function variable_text(variable: ProjectVariable): string {
	return variable.secret ? `${variable.name} as a secret` : `${variable.name} = ${variable.value}`;
}

/** A script written, kept, or why it couldn't be. */
export type StarterWrite = { ok: true; path: string; created: boolean } | { ok: false; path: string; problem: string };

/**
 * Write `command`'s starter at `root`, executable (0755). An existing file is kept unless
 * `replace` (`init --restore`); a directory there is never written over.
 */
export function write_starter(command: ScriptCommand, root: string, replace: boolean): StarterWrite {
	const file = path.join(root, SCRIPTS[command]);
	const stat = fs.statSync(file, { throwIfNoEntry: false });
	if (stat !== undefined && !stat.isFile()) { return { ok: false, path: file, problem: `${file} is not a file` }; }
	if (stat !== undefined && !replace) { return { ok: true, path: file, created: false }; }
	try {
		fs.writeFileSync(file, STARTERS[command], { mode: 0o755 });
		// A file that was there keeps its mode through writeFileSync.
		fs.chmodSync(file, 0o755);
	} catch (error) {
		return { ok: false, path: file, problem: `${file}: ${error instanceof Error ? error.message : String(error)}` };
	}
	return { ok: true, path: file, created: stat === undefined };
}

if (import.meta.vitest) {
	const { test, expect, beforeEach, afterEach } = import.meta.vitest;
	const os = await import("node:os");
	const { execFileSync } = await import("node:child_process");

	let root: string;
	beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "aa-starters-")); });
	afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

	test("write_starter - writes it executable, keeps an existing one unless replacing, never a directory", () => {
		expect(write_starter("build", root, false)).toEqual({ ok: true, path: path.join(root, "aa_build.sh"), created: true });
		expect(fs.statSync(path.join(root, "aa_build.sh")).mode & 0o777).toBe(0o755);
		fs.writeFileSync(path.join(root, "aa_build.sh"), "mine", { mode: 0o600 });
		expect(write_starter("build", root, false)).toMatchObject({ ok: true, created: false });
		expect(fs.readFileSync(path.join(root, "aa_build.sh"), "utf8")).toBe("mine");
		expect(write_starter("build", root, true)).toMatchObject({ ok: true, created: false });
		expect(fs.readFileSync(path.join(root, "aa_build.sh"), "utf8")).toBe(BUILD_STARTER);
		expect(fs.statSync(path.join(root, "aa_build.sh")).mode & 0o777).toBe(0o755);
		fs.mkdirSync(path.join(root, "aa_deploy.sh"));
		expect(write_starter("deploy", root, true)).toEqual({ ok: false, path: path.join(root, "aa_deploy.sh"), problem: `${path.join(root, "aa_deploy.sh")} is not a file` });
	});

	/** A view over `stored`, the project's variables; a name in `refused` can't be written. */
	const view = (stored: ProjectVariable[], refused: readonly string[] = []): Pick<SettingsView, "variables" | "set_variable"> => ({
		variables: () => stored,
		set_variable(name, value) {
			if (refused.includes(name)) { return { ok: false, message: "config.json: EACCES" }; }
			stored.push(typeof value === "string" ? { name, secret: false, value } : { name, secret: true });
			return { ok: true, file: "config.json" };
		},
	});

	test("set_starter_variables - sets deploy's three, a secret by name; build has none", () => {
		const stored: ProjectVariable[] = [];
		expect(set_starter_variables("build", view(stored))).toEqual({ set: [], problems: [] });
		expect(stored).toEqual([]);
		const result = set_starter_variables("deploy", view(stored));
		expect(result).toEqual({ set: STARTER_VARIABLES.deploy, problems: [] });
		expect(stored).toEqual([
			{ name: "BOARD_IP", secret: false, value: "analog.local" },
			{ name: "BOARD_USER", secret: false, value: "analog" },
			{ name: "BOARD_PASSWORD", secret: true },
		]);
		expect(result.set.map(variable => variable_text(variable))).toEqual(["BOARD_IP = analog.local", "BOARD_USER = analog", "BOARD_PASSWORD as a secret"]);
		// Again: all three are there, so nothing is set.
		expect(set_starter_variables("deploy", view(stored))).toEqual({ set: [], problems: [] });
	});

	test("set_starter_variables - keeps what the project has, whatever its value or kind; a failed write is a warning", () => {
		const stored: ProjectVariable[] = [{ name: "BOARD_IP", secret: false, value: "10.0.0.5" }, { name: "BOARD_PASSWORD", secret: false, value: "plain" }];
		expect(set_starter_variables("deploy", view(stored))).toEqual({ set: [{ name: "BOARD_USER", secret: false, value: "analog" }], problems: [] });
		expect(stored).toEqual([
			{ name: "BOARD_IP", secret: false, value: "10.0.0.5" },
			{ name: "BOARD_PASSWORD", secret: false, value: "plain" },
			{ name: "BOARD_USER", secret: false, value: "analog" },
		]);
		expect(set_starter_variables("deploy", view([], ["BOARD_USER"]))).toEqual({
			set: [{ name: "BOARD_IP", secret: false, value: "analog.local" }, { name: "BOARD_PASSWORD", secret: true }],
			problems: ["warning: the variable BOARD_USER of aa_deploy.sh was not set: config.json: EACCES"],
		});
	});

	test("the starters are valid sh, and the deploy one has no password on a command line", () => {
		for (const text of [BUILD_STARTER, DEPLOY_STARTER]) {
			const file = path.join(root, "check.sh");
			fs.writeFileSync(file, text);
			expect(() => execFileSync("sh", ["-n", file])).not.toThrow();
		}
		// The password goes to sshpass through SSHPASS and to sudo on its standard input.
		expect(DEPLOY_STARTER).not.toMatch(/sshpass -p/);
		expect(DEPLOY_STARTER.match(/.*\$BOARD_PASSWORD.*/g)).toEqual([
			"[ -n \"$BOARD_PASSWORD\" ] || fail \"BOARD_PASSWORD is not set: analog-attach config var BOARD_PASSWORD --secret\"",
			"SSHPASS=$BOARD_PASSWORD",
			"\t\tprintf '%s\\n' \"$BOARD_PASSWORD\" | remote \"sudo -S -p '' sh -c '$1'\"",
		]);
	});
}
