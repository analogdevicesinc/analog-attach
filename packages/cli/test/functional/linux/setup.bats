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

# Description: the setup offers to create the configured workfile; declining creates none and
# points to init.
# Steps:
#   1. Run the setup and answer n to creating the workfile.
#   2. Check it succeeds and the output mentions analog-attach init.
#   3. Check no workfile was created.
# bats test_tags=req:SETUP-01, id:L0284
@test "the setup offers to create the workfile, and declining creates none" {
	tty_run "(Y/n)" $'n\r' --
	assert_success
	assert_output --partial "analog-attach init"
	[ ! -e "$WORKFILE" ]
}

# Description: the setup can name a new workfile, and refuses a name whose file already exists.
# Steps:
#   1. Create the overlay with init, then drop the workfile setting.
#   2. Run the setup and type overlay as the name.
#   3. When it says the file already exists, change the name to other.
#   4. Check it succeeds, the workfile setting is other.dtso, and both files exist.
# bats test_tags=req:SETUP-01, id:L0285
@test "the setup can name a new workfile, refusing a name whose file exists" {
	with_overlay
	drop_setting workfile
	tty_run "Overlay file name" $'overlay\r' \
		"already exists" $'\x7f\x7f\x7f\x7f\x7f\x7fther\r' --
	assert_success
	[ "$(setting workfile)" = "$PROJECT/other.dtso" ]
	[ -f "$PROJECT/other.dtso" ]
	[ -f "$WORKFILE" ]
}

# Description: the setup asks only for the settings that have no value: with only devicetree
# missing, it starts at the base, and the configured workfile is not asked for.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run the setup: choose to type the base's path, type it, and accept
#      creating the workfile.
#   3. Check it succeeds and never asked for the Linux tree or the overlay's name.
#   4. Check devicetree is the RPi 4 base and the tree setting is kept.
# bats test_tags=req:SETUP-02, id:L0286
@test "the setup asks only for the settings that have no value" {
	drop_setting devicetree
	tty_run "Choose how to select" $'\x1b[B\r' \
		"Path to .dts file" "$LINUX_BASE"$'\r' \
		"(Y/n)" $'\r' --
	assert_success
	refute_output --partial "? Linux source tree"
	refute_output --partial "Overlay file name"
	[ "$(setting devicetree)" = "$LINUX_BASE" ]
	[ "$(setting linux)" = "$LINUX_TREE" ]
}

# Description: with every setting set and the workfile created, the setup asks nothing and says
# the workspace is ready.
# Steps:
#   1. Create the overlay with init.
#   2. Run the setup, stopping it with Ctrl+C if it asks for the Linux tree.
#   3. Check it did not ask for the tree and says the workspace is ready.
# bats test_tags=req:SETUP-02, id:L0287
@test "a setup with everything set asks nothing" {
	with_overlay
	# Stops the setup if it asks for the tree.
	tty_run "Linux source tree" $'\x03' --
	refute_output --partial "? Linux source tree"
	assert_output --partial "Workspace ready"
}

# Description: a configured workfile whose file exists is kept, its content as it was.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Snapshot the workfile.
#   3. Run the setup, which asks nothing.
#   4. Check it succeeds, the screen says the overlay was kept, and the workfile is unchanged.
# bats test_tags=req:SETUP-01, id:L0288
@test "a configured workfile is kept, its content as it was" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	snapshot
	tty_run --
	assert_success
	[[ "$(screen)" == *"Overlay:     $WORKFILE (kept)"* ]]
	assert_unchanged
}

# Description: a setup stopped part way keeps the answers given so far, and the next run goes on
# from the first unanswered question.
# Steps:
#   1. Drop the linux, devicetree and workfile settings.
#   2. Run the setup, type the tree's path, and stop it with Ctrl+C at the base.
#   3. Check the tree setting is saved.
#   4. Run the setup again, stopping at the base, and check it did not ask for the tree.
# bats test_tags=req:SETUP-02, req:GEN-06, id:L0289
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

# Description: stopping the setup with Ctrl+C ends it with status 130, says what was answered is
# kept, and creates no workfile.
# Steps:
#   1. Drop the linux setting.
#   2. Run the setup and press Ctrl+C at the Linux tree question.
#   3. Check it fails with status 130 and says what was answered is saved.
#   4. Check no workfile was created.
# bats test_tags=req:GEN-06, id:L0290
@test "stopping the setup with Ctrl+C ends it with status 130" {
	drop_setting linux
	tty_run "Linux source tree" $'\x03' --
	assert_failure 130
	assert_output --partial "Stopped. What was answered is saved; run analog-attach again to go on."
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

# Description: a configured linux that is not a Linux tree is named, and the tree is asked for.
# Steps:
#   1. Make a tree skeleton under the home directory, and a directory that is not a tree.
#   2. Set linux to that directory in the project's settings file.
#   3. Run the setup and stop it at the Linux tree question.
#   4. Check it says the configured linux is not a Linux source tree, and offers the skeleton.
# bats test_tags=req:SETUP-03, id:L0292
@test "a configured linux that is not a tree is named and asked for again" {
	tree_skeleton "$HOME/src/linux-a"
	mkdir -p "$BATS_TEST_TMPDIR/not-a-tree"
	local file="$PROJECT/.analog-attach/config.json"
	jq --arg dir "$BATS_TEST_TMPDIR/not-a-tree" '.linux.linux = $dir' "$file" > "$file.new" && mv "$file.new" "$file"
	tty_run "Linux source tree" $'\x03' --
	[[ "$(screen)" == *"linux is $BATS_TEST_TMPDIR/not-a-tree, which is not a Linux source tree."* ]] || fail "not named: $output"
	[[ "$(screen)" == *"$HOME/src/linux-a"* ]] || fail "the trees are not offered: $output"
}

# Description: the setup offers the base devicetrees of the Linux tree, by architecture, to pick
# from.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run the setup, search the tree, take the first architecture, filter on bcm2711, and stop
#      when the list shows the boards.
#   3. Check arm64 was offered as an architecture.
#   4. Check the RPi 4 B and RPi 400 base files are listed.
# bats test_tags=req:SETUP-03, id:L0293
@test "the setup offers the base device trees of the Linux tree to pick from" {
	drop_setting devicetree
	tty_run "Choose how to select" $'\r' \
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

# Description: without a terminal, the bare run shows the help and names the required settings
# that are missing, and how to set them.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach alone with stdin from /dev/null.
#   3. Check it succeeds and shows the help.
#   4. Check it says devicetree is not set yet and points to the guided setup and config.
# bats test_tags=req:SETUP-04, id:L0295
@test "without a terminal, the bare run says which required settings are missing" {
	drop_setting devicetree
	run timeout 30 node "$CLI_DIR/dist/cli.js" </dev/null
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "Not set yet: devicetree. Run 'analog-attach' on a terminal for the guided setup, or 'analog-attach config devicetree <value>'."
}

# Description: with --quiet on a terminal, the bare run asks nothing, shows the help and names the
# missing settings.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach --quiet on a terminal.
#   3. Check it succeeds, shows the help and says devicetree is not set yet.
#   4. Check it does not ask for the Linux tree.
# bats test_tags=req:SETUP-04, id:L0296
@test "with --quiet, on a terminal, the bare run asks nothing and shows the help" {
	drop_setting devicetree
	tty_run -- --quiet
	assert_success
	assert_output --partial "USAGE"
	assert_output --partial "Not set yet: devicetree."
	refute_output --partial "Linux source tree"
}

# Description: with --json on a terminal, the bare run asks nothing and gives one JSON result
# naming the missing settings.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach --json on a terminal.
#   3. Check it exits 0 with ok true and devicetree as the only missing setting.
#   4. Check it does not ask for the Linux tree.
# bats test_tags=req:SETUP-04, id:L0297
@test "with --json, on a terminal, the bare run asks nothing and gives one JSON result" {
	drop_setting devicetree
	tty_run -- --json
	assert_success
	# The terminal merges the streams: the compact JSON, as text.
	assert_output --partial '"ok":true'
	assert_output --partial '"missing":["devicetree"]'
	refute_output --partial "Linux source tree"
}

# Description: with --json, the bare run names the required settings that are missing.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run analog-attach --json with stdin from /dev/null.
#   3. Check it exits 0 with one JSON result: ok true, the usage, and devicetree as the only
#      missing setting.
# bats test_tags=req:SETUP-04, id:L0298
@test "with --json, the bare run says which required settings are missing" {
	drop_setting devicetree
	run --separate-stderr timeout 30 node "$CLI_DIR/dist/cli.js" --json </dev/null
	assert_success
	assert_json '.ok' true
	assert_json '.missing | join(",")' devicetree
	assert_json '.usage | contains("USAGE")' true
}

# Description: when the binding caches are not built, the setup builds them, saying it takes
# time, before creating the workfile.
# Steps:
#   1. Remove the project's binding caches.
#   2. Run the setup, pressing Enter to create the workfile.
#   3. Check it succeeds and says it is indexing the bindings, then how many compatibles it
#      indexed.
#   4. Check compat-index.json and validation.json exist and the workfile was created.
# bats test_tags=req:CONFIG-08, id:L0299
@test "the setup builds the binding caches when they aren't built, saying that it takes time" {
	rm "$PROJECT/.analog-attach/linux/"*.json
	tty_run "(Y/n)" $'\r' --
	assert_success
	assert_output --partial "Indexing device bindings and compiling binding schemas..."
	assert_output --regexp "Indexed [0-9]+ compatibles from [0-9]+ bindings"
	[ -f "$PROJECT/.analog-attach/linux/compat-index.json" ]
	[ -f "$PROJECT/.analog-attach/linux/validation.json" ]
	[ -f "$WORKFILE" ]
}
