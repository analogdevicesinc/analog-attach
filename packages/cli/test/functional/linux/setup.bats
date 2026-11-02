# The guided setup (SETUP-*): `analog-attach` alone, where the backend is linux.
#
# The screen is 80 columns, so a long line wraps: `screen` gives the output with the line
# breaks taken out, for long paths.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
}

# `setting <key>`: the value of a linux setting in the project's file.
setting() {
	jq -r --arg key "$1" '.linux[$key]' "$PROJECT/.analog-attach/config.json"
}

# `screen`: $output without its line breaks.
screen() {
	printf '%s' "${output//$'\n'/}"
}

# `tree_skeleton <dir>`: a directory that looks like a Linux tree to the search (it has
# Documentation/devicetree/bindings/ and include/).
tree_skeleton() {
	mkdir -p "$1/Documentation/devicetree/bindings" "$1/include"
}

# The base of the search, one line on the screen: the RPi 4 board, highlighted, then the way
# back.
PICKED_BASE=$'❯ broadcom/bcm2711-rpi-4-b.dts\n  ← back to the architectures'

# bats test_tags=req:SETUP-01, req:SETUP-03, req:SETUP-05
@test "with nothing set, the setup asks the ecosystem, then the Linux tree, the base and the workfile, then creates it" {
	rm "$PROJECT/.analog-attach/config.json"
	tty_run "What does this project target?" $'\r' \
		"Linux source tree" $'\x1b[B\r' \
		"Linux source path" "$LINUX_TREE"$'\r' \
		"Choose how to select" $'\r' \
		"Architecture" $'\r' \
		"Filter" 'bcm2711-rpi-4-b' \
		"$PICKED_BASE" $'\r' \
		"Overlay file name" $'\r' --
	assert_success
	# The choices were offered, not typed.
	assert_output --partial "Linux device tree overlays (linux)"
	assert_output --partial "no-OS CAPI projects (noos)"
	assert_output --partial "Search in the Linux tree"
	assert_output --regexp "Found [0-9]+ .dts files."
	# Saved.
	[ "$(jq -r .backend "$PROJECT/.analog-attach/config.json")" = linux ]
	[ "$(setting linux)" = "$LINUX_TREE" ]
	[ "$(setting devicetree)" = "$LINUX_BASE" ]
	[ "$(setting workfile)" = "$WORKFILE" ]
	# The workfile was created (init).
	[ -f "$WORKFILE" ]
	assert_output --partial "Workspace ready"
	[[ "$(screen)" == *"Overlay:     $WORKFILE (created)"* ]]
	# Next steps: find a device and add it.
	assert_output --partial "Next steps:"
	assert_output --partial "analog-attach list devices"
	assert_output --partial "analog-attach add <compatible>"
}

# Gap: the Linux setup runs init at once, without offering to: the workfile is always created.
# bats test_tags=req:SETUP-01, gap
@test "the setup offers to create the workfile, and declining creates none" {
	tty_run "Linux source tree" $'\r' "Choose how to select" $'\r' "Overlay:" $'\r' "(Y/n)" $'n\r' --
	assert_success
	assert_output --partial "analog-attach init"
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:SETUP-01
@test "the setup can name a new workfile, refusing a name whose file exists" {
	with_overlay
	tty_run "Linux source tree" $'\r' "Choose how to select" $'\r' \
		"Overlay:" $'n\r' \
		"Overlay file name" $'overlay\r' \
		"already exists" $'\x7f\x7f\x7f\x7f\x7f\x7fther\r' --
	assert_success
	[ "$(setting workfile)" = "$PROJECT/other.dtso" ]
	[ -f "$PROJECT/other.dtso" ]
	[ -f "$WORKFILE" ]
}

# Gap: every step is asked again, with the configured value as the Enter default (the tree
# question comes first, so this waits until TTY_TIMEOUT).
# bats test_tags=req:SETUP-02, gap
@test "the setup asks only for the settings that have no value" {
	drop_setting devicetree
	TTY_TIMEOUT=5 tty_run "Choose how to select" $'\x1b[B\r' \
		"Path to .dts file" "$LINUX_BASE"$'\r' \
		"Overlay file name" $'\r' --
	assert_success
	refute_output --partial "? Linux source tree"
	[ "$(setting devicetree)" = "$LINUX_BASE" ]
	[ "$(setting linux)" = "$LINUX_TREE" ]
}

# Gap: with everything set, the setup asks all three steps again.
# bats test_tags=req:SETUP-02, gap
@test "a setup with everything set asks nothing" {
	with_overlay
	# Stops the setup if it asks for the tree.
	tty_run "Linux source tree" $'\x03' --
	refute_output --partial "? Linux source tree"
	assert_output --partial "Workspace ready"
}

# bats test_tags=req:SETUP-02
@test "a configured workfile is kept with Enter, its content as it was" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	snapshot
	tty_run "Linux source tree" $'\r' "Choose how to select" $'\r' "Overlay:" $'\r' --
	assert_success
	[[ "$(screen)" == *"Overlay:     $WORKFILE (kept)"* ]]
	assert_unchanged
}

# Gap: a stopped setup saves nothing (`Setup cancelled.`): the settings are written only
# after the last question.
# bats test_tags=req:SETUP-02, req:GEN-06, gap
@test "a stopped setup keeps each answer, and the next run goes on from there" {
	drop_setting linux devicetree workfile
	tty_run "Linux source tree" $'\x1b[B\r' \
		"Linux source path" "$LINUX_TREE"$'\r' \
		"Choose how to select" $'\x03' --
	[ "$(setting linux)" = "$LINUX_TREE" ]
	# The next run asks for the base, not for the tree.
	tty_run "Choose how to select" $'\x03' --
	refute_output --partial "? Linux source tree"
}

# bats test_tags=req:GEN-06
@test "stopping the setup with Ctrl+C ends it with status 130" {
	tty_run "Linux source tree" $'\x03' --
	assert_failure 130
	assert_output --partial "Setup cancelled."
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:SETUP-03
@test "the setup offers the Linux trees found under the home directory" {
	drop_setting linux
	tree_skeleton "$HOME/src/linux-a"
	tree_skeleton "$HOME/work/kernels/linux-b"
	mkdir -p "$HOME/notes/Documentation/devicetree/bindings"  # no include/: not a tree
	tty_run "Linux source tree" $'\x03' --
	[[ "$(screen)" == *"$HOME/src/linux-a"* ]] || fail "linux-a not offered: $output"
	[[ "$(screen)" == *"$HOME/work/kernels/linux-b"* ]] || fail "linux-b not offered: $output"
	[[ "$(screen)" != *"$HOME/notes"* ]] || fail "a directory with no include/ was offered: $output"
	assert_output --partial "Type a path"
}

# bats test_tags=req:SETUP-03
@test "the setup offers the configured tree first, marked current" {
	tree_skeleton "$HOME/src/linux-a"
	tty_run "Linux source tree" $'\x03' --
	[[ "$(screen)" == *"❯ $LINUX_TREE (current)"* ]] || fail "the configured tree is not first: $output"
}

# bats test_tags=req:SETUP-03
@test "the setup offers the base device trees of the Linux tree to pick from" {
	drop_setting devicetree
	tty_run "Linux source tree" $'\r' \
		"Choose how to select" $'\r' \
		"Architecture" $'\r' \
		"Filter" 'bcm2711' \
		"bcm2711-rpi-cm4s.dts" $'\x03' --
	assert_output --partial "  arm64"
	assert_output --partial "broadcom/bcm2711-rpi-4-b.dts"
	assert_output --partial "broadcom/bcm2711-rpi-400.dts"
}

# bats test_tags=req:SETUP-04
@test "without a terminal, the bare run asks nothing and shows the help" {
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "COMMANDS"
	refute_output --partial "analog-attach setup"
}

# Gap: the bare run shows the help alone, naming no missing setting.
# bats test_tags=req:SETUP-04, gap
@test "without a terminal, the bare run says which required settings are missing" {
	drop_setting devicetree
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "Not set yet: devicetree. Run 'analog-attach' on a terminal for the guided setup, or 'analog-attach config devicetree <value>'."
}

# Gap: the bare run shows the help alone, naming no missing setting.
# bats test_tags=req:SETUP-04, gap
@test "with --quiet, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting devicetree
	tty_run -- --quiet
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "Not set yet: devicetree."
	refute_output --partial "Linux source tree"
}

# bats test_tags=req:SETUP-04
@test "with --json, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting devicetree
	tty_run -- --json
	assert_output --partial "USAGE"
	refute_output --partial "Linux source tree"
}

# Gap: with --json the bare run shows the help only; the `Not set yet` line is human mode's.
# bats test_tags=req:SETUP-04, gap
@test "with --json, the bare run says which required settings are missing" {
	drop_setting devicetree
	run timeout 30 node "$CLI_DIR/dist/cli.js" --json </dev/null
	assert_output --partial "USAGE"
	assert_output --partial "devicetree"
}

# bats test_tags=req:CONFIG-08
@test "the setup builds the binding caches when they aren't built, saying that it takes time" {
	rm "$PROJECT/.analog-attach/linux/"*.json
	tty_run "Linux source tree" $'\r' "Choose how to select" $'\r' "Overlay:" $'\r' --
	assert_success
	assert_output --partial "Indexing device bindings and compiling binding schemas..."
	assert_output --regexp "Indexed [0-9]+ compatibles from [0-9]+ bindings"
	[ -f "$PROJECT/.analog-attach/linux/compat-index.json" ]
	[ -f "$PROJECT/.analog-attach/linux/validation.json" ]
	[ -f "$WORKFILE" ]
}
