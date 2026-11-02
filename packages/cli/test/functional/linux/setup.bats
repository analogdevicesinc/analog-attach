# The guided setup (SETUP-*): `analog-attach` alone, where the backend is linux.
#
# The screen is 80 columns, so a long line wraps: `screen` gives the output with the line
# breaks taken out, for long paths.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base: the tree, base and
# workfile settings all set, the binding caches built, no workfile yet. "The setup" is
# analog-attach run alone on a terminal (tty_run with no words).
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

# Description: with no settings file, the setup asks the ecosystem, the Linux tree, the base and
# the workfile name, saves them, creates the workfile and shows the next steps.
# Steps:
#   1. Remove the project's settings file.
#   2. Run the setup: pick linux, type the tree's path, search the tree for the base, filter on
#      bcm2711-rpi-4-b and pick it, and take the default overlay name.
#   3. Check it succeeds and the ecosystems, the search and the count of .dts files were offered.
#   4. Check the backend, linux, devicetree and workfile settings are saved.
#   5. Check the workfile exists and the screen says it was created.
#   6. Check the next steps show list devices and add <compatible>.
# bats test_tags=req:SETUP-01, req:SETUP-03, req:SETUP-05, id:L0283
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
# Description: the setup offers to create the workfile; declining creates none and points to
# init.
# Steps:
#   1. Run the setup, keep the tree and base with Enter, and answer n to creating the workfile.
#   2. Check it succeeds and the output mentions analog-attach init.
#   3. Check no workfile was created.
# bats test_tags=req:SETUP-01, gap, id:L0284
@test "the setup offers to create the workfile, and declining creates none" {
	tty_run "Linux source tree" $'\r' "Choose how to select" $'\r' "Overlay:" $'\r' "(Y/n)" $'n\r' --
	assert_success
	assert_output --partial "analog-attach init"
	[ ! -e "$WORKFILE" ]
}

# Description: the setup can name a new workfile, and refuses a name whose file already exists.
# Steps:
#   1. Create the overlay with init.
#   2. Run the setup, keep the tree and base, decline the current overlay, and type overlay as
#      the name.
#   3. When it says the file already exists, change the name to other.
#   4. Check it succeeds, the workfile setting is other.dtso, and both files exist.
# bats test_tags=req:SETUP-01, id:L0285
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
# Description: the setup asks only for the settings that have no value: with only devicetree
# missing, it starts at the base.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run the setup with a 5 s timeout: choose to type the base's path, type it, and take the
#      default overlay name.
#   3. Check it succeeds and never asked for the Linux tree.
#   4. Check devicetree is the RPi 4 base and the tree setting is kept.
# bats test_tags=req:SETUP-02, gap, id:L0286
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
# Description: with every setting set and the workfile created, the setup asks nothing and says
# the workspace is ready.
# Steps:
#   1. Create the overlay with init.
#   2. Run the setup, stopping it with Ctrl+C if it asks for the Linux tree.
#   3. Check it did not ask for the tree and says the workspace is ready.
# bats test_tags=req:SETUP-02, gap, id:L0287
@test "a setup with everything set asks nothing" {
	with_overlay
	# Stops the setup if it asks for the tree.
	tty_run "Linux source tree" $'\x03' --
	refute_output --partial "? Linux source tree"
	assert_output --partial "Workspace ready"
}

# Description: keeping the configured workfile with Enter leaves its content as it was.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Snapshot the workfile.
#   3. Run the setup, pressing Enter at the tree, the base and the overlay.
#   4. Check it succeeds, the screen says the overlay was kept, and the workfile is unchanged.
# bats test_tags=req:SETUP-02, id:L0288
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
# Description: a setup stopped part way keeps the answers given so far, and the next run goes on
# from the first unanswered question.
# Steps:
#   1. Drop the linux, devicetree and workfile settings.
#   2. Run the setup, type the tree's path, and stop it with Ctrl+C at the base.
#   3. Check the tree setting is saved.
#   4. Run the setup again, stopping at the base, and check it did not ask for the tree.
# bats test_tags=req:SETUP-02, req:GEN-06, gap, id:L0289
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

# Description: stopping the setup with Ctrl+C ends it with status 130 and creates no workfile.
# Steps:
#   1. Run the setup and press Ctrl+C at the Linux tree question.
#   2. Check it fails with status 130 and says the setup was cancelled.
#   3. Check no workfile was created.
# bats test_tags=req:GEN-06, id:L0290
@test "stopping the setup with Ctrl+C ends it with status 130" {
	tty_run "Linux source tree" $'\x03' --
	assert_failure 130
	assert_output --partial "Setup cancelled."
	[ ! -e "$WORKFILE" ]
}

# Description: the setup offers the Linux trees it finds under the home directory, and only
# directories that look like a tree.
# Steps:
#   1. Drop the linux setting.
#   2. Make two tree skeletons under the home directory, and a directory with bindings but no
#      include/.
#   3. Run the setup and stop it at the Linux tree question.
#   4. Check both trees are offered, the directory without include/ is not, and typing a path is
#      offered.
# bats test_tags=req:SETUP-03, id:L0291
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

# Description: the setup offers the configured Linux tree first, marked current.
# Steps:
#   1. Make a tree skeleton under the home directory.
#   2. Run the setup and stop it at the Linux tree question.
#   3. Check the first, highlighted choice is the configured tree, marked (current).
# bats test_tags=req:SETUP-03, id:L0292
@test "the setup offers the configured tree first, marked current" {
	tree_skeleton "$HOME/src/linux-a"
	tty_run "Linux source tree" $'\x03' --
	[[ "$(screen)" == *"❯ $LINUX_TREE (current)"* ]] || fail "the configured tree is not first: $output"
}

# Description: the setup offers the base devicetrees of the Linux tree, by architecture, to pick
# from.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run the setup, keep the tree, search the tree, take the first architecture, filter on
#      bcm2711, and stop when the list shows the boards.
#   3. Check arm64 was offered as an architecture.
#   4. Check the RPi 4 B and RPi 400 base files are listed.
# bats test_tags=req:SETUP-03, id:L0293
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

# Description: without a terminal, the bare run asks nothing and shows the help.
# Steps:
#   1. Run analog-attach alone with stdin from /dev/null.
#   2. Check it succeeds and shows the help's usage and commands.
#   3. Check it does not mention analog-attach setup.
# bats test_tags=req:SETUP-04, id:L0294
@test "without a terminal, the bare run asks nothing and shows the help" {
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "COMMANDS"
	refute_output --partial "analog-attach setup"
}

# Gap: the bare run shows the help alone, naming no missing setting.
# Description: without a terminal, the bare run shows the help and names the required settings
# that are missing, and how to set them.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach alone with stdin from /dev/null.
#   3. Check it succeeds and shows the help.
#   4. Check it says devicetree is not set yet and points to the guided setup and config.
# bats test_tags=req:SETUP-04, gap, id:L0295
@test "without a terminal, the bare run says which required settings are missing" {
	drop_setting devicetree
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "Not set yet: devicetree. Run 'analog-attach' on a terminal for the guided setup, or 'analog-attach config devicetree <value>'."
}

# Gap: the bare run shows the help alone, naming no missing setting.
# Description: with --quiet on a terminal, the bare run asks nothing, shows the help and names the
# missing settings.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach --quiet on a terminal.
#   3. Check it succeeds, shows the help and says devicetree is not set yet.
#   4. Check it does not ask for the Linux tree.
# bats test_tags=req:SETUP-04, gap, id:L0296
@test "with --quiet, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting devicetree
	tty_run -- --quiet
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "Not set yet: devicetree."
	refute_output --partial "Linux source tree"
}

# Description: with --json on a terminal, the bare run asks nothing and shows the help.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach --json on a terminal.
#   3. Check it shows the help and does not ask for the Linux tree.
# bats test_tags=req:SETUP-04, id:L0297
@test "with --json, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting devicetree
	tty_run -- --json
	assert_output --partial "USAGE"
	refute_output --partial "Linux source tree"
}

# Gap: with --json the bare run shows the help only; the `Not set yet` line is human mode's.
# Description: with --json, the bare run names the required settings that are missing.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach --json with stdin from /dev/null.
#   3. Check the output shows the help and mentions devicetree.
# bats test_tags=req:SETUP-04, gap, id:L0298
@test "with --json, the bare run says which required settings are missing" {
	drop_setting devicetree
	run timeout 30 node "$CLI_DIR/dist/cli.js" --json </dev/null
	assert_output --partial "USAGE"
	assert_output --partial "devicetree"
}

# Description: when the binding caches are not built, the setup builds them, saying it takes
# time, before creating the workfile.
# Steps:
#   1. Remove the project's binding caches.
#   2. Run the setup, pressing Enter at the tree, the base and the overlay.
#   3. Check it succeeds and says it is indexing the bindings, then how many compatibles it
#      indexed.
#   4. Check compat-index.json and validation.json exist and the workfile was created.
# bats test_tags=req:CONFIG-08, id:L0299
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
