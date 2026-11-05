# init where the backend is linux.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base, its binding caches
# built, workfile overlay.dtso set but not created yet.
setup() {
	load ../helpers
	new_project linux
}

# `run_config_error <words>`: run_json for a configuration error, a refusal with its errors and
# hints (COM-071): exit 0, nothing on standard error, .ok false.
run_config_error() {
	run_json "$@"
	assert_success
	[ -z "$stderr" ] || fail "standard error: $stderr"
	assert_json '.ok' false
}

# The empty overlay init writes.
EMPTY_OVERLAY=$'/dts-v1/;\n/plugin/;\n\n/ {\n};'

# Description: init creates an empty overlay at the path the workfile setting names, and nowhere
# else.
# Steps:
#   1. Make designs/sub in the project and set the workfile to designs/sub/mine.dtso.
#   2. Run init, with --json; check it succeeds (.ok true, .created true).
#   3. Check designs/sub/mine.dtso exists and overlay.dtso does not.
#   4. Check the new file is the empty overlay.
# bats test_tags=req:INIT-01, id:L0174
@test "init creates an empty workfile at the path the workfile setting names" {
	mkdir -p "$PROJECT/designs/sub"
	new_project linux workfile=designs/sub/mine.dtso
	run_json init
	assert_success
	assert_json '.ok' true
	assert_json '.created' true
	[ -f "$PROJECT/designs/sub/mine.dtso" ]
	[ ! -e "$PROJECT/overlay.dtso" ]
	run cat "$PROJECT/designs/sub/mine.dtso"
	assert_output "$EMPTY_OVERLAY"
}

# Description: init makes an empty overlay for the base the devicetree setting names, so added
# nodes land on that base's buses.
# Steps:
#   1. Run init, with --json; check it succeeds and reports the configured base and tree.
#   2. Check the workfile is the empty overlay.
#   3. Add adi,adxl345 under spi0, with --json; check it succeeds and the node's path is under
#      the base's spi@7e204000.
# bats test_tags=req:INIT-01-LNX, id:L0175
@test "init makes an empty overlay for the base the devicetree setting names" {
	run_json init
	assert_success
	assert_json '.devicetree' "$LINUX_BASE"
	assert_json '.linux' "$LINUX_TREE"
	run cat "$WORKFILE"
	assert_output "$EMPTY_OVERLAY"
	# The overlay applies to that base: a node added to it lands on one of the base's buses.
	run_json add adi,adxl345 --parent spi0
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/spi@7e204000/adi,adxl345@2'
}

# Description: init leaves an existing workfile as it is and says it was kept.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 under spi0.
#   2. Snapshot the workfile.
#   3. Run init, with --json; check it succeeds (.ok true, .created false) and the message ends
#      with (kept).
#   4. Check the workfile is unchanged.
# bats test_tags=req:INIT-02, id:L0176
@test "init leaves an existing workfile as it is and says so" {
	with_overlay
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1
	snapshot
	run_json init
	assert_success
	assert_json '.ok' true
	assert_json '.created' false
	assert_json '.message | endswith("(kept)")' true
	assert_unchanged
}

# Description: in human mode, init says the workfile was kept, and does not touch it even when it
# is no devicetree.
# Steps:
#   1. Write a line of plain text as the workfile.
#   2. Run init; check it succeeds and says the overlay was kept.
#   3. Check the workfile still holds that line.
# bats test_tags=req:INIT-02, id:L0177
@test "init in human mode says the workfile was kept" {
	echo 'not even a device tree' >"$WORKFILE"
	run aa init
	assert_success
	assert_output --partial "Overlay:     $WORKFILE (kept)"
	run cat "$WORKFILE"
	assert_output 'not even a device tree'
}

# Description: init refuses a workfile path whose folder does not exist, or that is a folder,
# pointing to config workfile.
# Steps:
#   1. Set the workfile to gone/x.dtso and run init, with --json.
#   2. Check it is refused (exit 0, .ok false), the message says gone is not a directory and
#      points to config workfile; check gone was not created.
#   3. Reset the project, make a directory at the workfile's path, and run init, with --json.
#   4. Check it is refused (.ok false) and the message says the path is not a file.
# bats test_tags=req:INIT-01, req:INIT-02, id:L0178
@test "init refuses a workfile path whose folder doesn't exist, or that is a folder" {
	new_project linux workfile=gone/x.dtso
	run_json init
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Cannot create the workfile: $PROJECT/gone is not a directory. Configure another with 'analog-attach config workfile <name>'."
	[ ! -e "$PROJECT/gone" ]
	new_project linux
	mkdir "$WORKFILE"
	run_json init
	assert_json '.ok' false
	assert_json '.message' "Cannot create the workfile: $WORKFILE is not a file. Configure another with 'analog-attach config workfile <name>'."
}

# Description: init with no Linux tree or base fails with a configuration error naming both
# settings, pointing to config and the guided setup.
# Steps:
#   1. Drop the linux and devicetree settings.
#   2. Run init, with --json; check it is refused, with the errors in the result.
#   3. Check the errors name linux and devicetree, the first says linux is missing, and the
#      hint points to the guided setup and config linux and config devicetree.
#   4. Check no workfile was created.
# bats test_tags=req:INIT-03, id:L0179
@test "init with no Linux tree or base names the settings and points to config and the guided setup" {
	drop_setting linux devicetree
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'linux,devicetree'
	assert_json '.errors[0].message' 'Missing config field linux'
	assert_json '.hints[0]' "Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>' and 'config devicetree <path>', to set up a workspace."
	[ ! -e "$WORKFILE" ]
}

# Description: in human mode, init with no workfile setting names the missing setting and how to
# set it.
# Steps:
#   1. Drop the workfile setting.
#   2. Run init.
#   3. Check the output says workfile is missing and points to config workfile and the guided
#      setup.
#   4. Check no workfile was created.
# bats test_tags=req:INIT-03, id:L0180
@test "init with no workfile setting names it, in human mode" {
	drop_setting workfile
	run aa init
	assert_output --partial "Missing config field workfile"
	assert_output --partial "'analog-attach config workfile <name>'"
	assert_output --partial "Run 'analog-attach' on a terminal"
	[ ! -e "$WORKFILE" ]
}

# Description: init on a terminal asks nothing and creates the workfile.
# Steps:
#   1. Run init on a terminal.
#   2. Check it succeeds, says the workspace is ready, and shows no question.
#   3. Check the workfile was created.
# bats test_tags=req:INIT-04, id:L0181
@test "init on a terminal asks nothing" {
	tty_run -- init
	assert_success
	assert_output --partial "Workspace ready"
	refute_output --partial "?"
	[ -f "$WORKFILE" ]
}

# Description: init on a terminal with a setting missing refuses at once, without asking for it.
# Steps:
#   1. Drop the devicetree setting.
#   2. Run init on a terminal.
#   3. Check it did not wait for input (no timeout) and says devicetree is missing.
#   4. Check it shows no question and created no workfile.
# bats test_tags=req:INIT-04, id:L0182
@test "init on a terminal with a setting missing refuses without asking" {
	drop_setting devicetree
	tty_run -- init
	# tty_run exits 124 when init waits for an answer.
	[ "$status" -ne 124 ] || fail "init waited for input: $output"
	assert_output --partial "Missing config field devicetree"
	refute_output --partial "?"
	[ ! -e "$WORKFILE" ]
}

# Description: init reports the workfile's absolute path, that it created it, and the workspace's
# settings.
# Steps:
#   1. Set the workfile to w.dtso, a relative path.
#   2. Run init, with --json; check it succeeds.
#   3. Check the path is the absolute path of w.dtso, .created is true, and the message gives
#      the tree, the base and the overlay, created.
# bats test_tags=req:INIT-05, id:L0183
@test "init reports the absolute path of the workfile and that it created it" {
	new_project linux workfile=w.dtso
	run_json init
	assert_success
	assert_json '.path' "$PROJECT/w.dtso"
	assert_json '.created' true
	assert_json '.message' "Workspace ready: linux $LINUX_TREE, devicetree $LINUX_BASE, overlay $PROJECT/w.dtso (created)"
}

# Description: in human mode, init writes the tree, the base and the overlay it created.
# Steps:
#   1. Run init.
#   2. Check it succeeds and prints Workspace ready, then the Linux, Devicetree and Overlay
#      lines, the overlay marked created.
# bats test_tags=req:INIT-05, id:L0184
@test "init in human mode writes what it created and where" {
	run aa init
	assert_success
	assert_line --index 0 'Workspace ready'
	assert_line "  Linux:       $LINUX_TREE"
	assert_line "  Devicetree:  $LINUX_BASE"
	assert_line "  Overlay:     $WORKFILE (created)"
}

# Description: init with no binding caches fails with a configuration error, says how to build
# them, and creates nothing.
# Steps:
#   1. Remove the project's binding caches.
#   2. Run init, with --json; check it is refused and the errors name compat-index and
#      validation.json.
#   3. Check the hint points to config --reload, and no workfile was created.
#   4. Run init in human mode; check it points to config --reload too.
# bats test_tags=req:INIT-06, id:L0185
@test "init with no binding caches says how to build them, and creates nothing" {
	rm "$PROJECT/.analog-attach/linux/"*.json
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'compat-index,validation.json'
	assert_json '.hints[0]' "Run 'analog-attach config --reload' to build the binding caches."
	[ ! -e "$WORKFILE" ]
	run aa init
	assert_output --partial "Run 'analog-attach config --reload' to build the binding caches."
}

# Description: init with one binding cache missing names that cache and where it was looked for.
# Steps:
#   1. Remove validation.json from the project's caches.
#   2. Run init, with --json; check it is refused.
#   3. Check the only error is on validation.json and says it is not found in the project's
#      linux state directory.
# bats test_tags=req:INIT-06, id:L0186
@test "init with one cache missing names it" {
	rm "$PROJECT/.analog-attach/linux/validation.json"
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'validation.json'
	assert_json '.errors[0].message' "validation.json not found or unreadable in $PROJECT/.analog-attach/linux"
}
