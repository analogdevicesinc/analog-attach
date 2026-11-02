# init where the backend is linux.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
}

# `run_config_error <words>`: run_json for a configuration error, which is JSON on standard
# error (exit 2): $output is that JSON.
run_config_error() {
	run_json "$@"
	assert_failure 2
	output=$stderr
}

# The empty overlay init writes.
EMPTY_OVERLAY=$'/dts-v1/;\n/plugin/;\n\n/ {\n};'

# bats test_tags=req:INIT-01
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

# bats test_tags=req:INIT-01-LNX
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

# bats test_tags=req:INIT-02
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

# bats test_tags=req:INIT-02
@test "init in human mode says the workfile was kept" {
	echo 'not even a device tree' >"$WORKFILE"
	run aa init
	assert_success
	assert_output --partial "Overlay:     $WORKFILE (kept)"
	run cat "$WORKFILE"
	assert_output 'not even a device tree'
}

# bats test_tags=req:INIT-01, req:INIT-02
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

# bats test_tags=req:INIT-03
@test "init with no Linux tree or base names the settings and points to config and the guided setup" {
	drop_setting linux devicetree
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'linux,devicetree'
	assert_json '.errors[0].message' 'Missing config field linux'
	assert_json '.hints[0]' "Run 'analog-attach' on a terminal, or 'analog-attach config linux <path>' and 'config devicetree <path>', to set up a workspace."
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:INIT-03
@test "init with no workfile setting names it, in human mode" {
	drop_setting workfile
	run aa init
	assert_output --partial "Missing config field workfile"
	assert_output --partial "'analog-attach config workfile <name>'"
	assert_output --partial "Run 'analog-attach' on a terminal"
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:INIT-04
@test "init on a terminal asks nothing" {
	tty_run -- init
	assert_success
	assert_output --partial "Workspace ready"
	refute_output --partial "?"
	[ -f "$WORKFILE" ]
}

# bats test_tags=req:INIT-04
@test "init on a terminal with a setting missing refuses without asking" {
	drop_setting devicetree
	tty_run -- init
	# tty_run exits 124 when init waits for an answer.
	[ "$status" -ne 124 ] || fail "init waited for input: $output"
	assert_output --partial "Missing config field devicetree"
	refute_output --partial "?"
	[ ! -e "$WORKFILE" ]
}

# bats test_tags=req:INIT-05
@test "init reports the absolute path of the workfile and that it created it" {
	new_project linux workfile=w.dtso
	run_json init
	assert_success
	assert_json '.path' "$PROJECT/w.dtso"
	assert_json '.created' true
	assert_json '.message' "Workspace ready: linux $LINUX_TREE, devicetree $LINUX_BASE, overlay $PROJECT/w.dtso (created)"
}

# bats test_tags=req:INIT-05
@test "init in human mode writes what it created and where" {
	run aa init
	assert_success
	assert_line --index 0 'Workspace ready'
	assert_line "  Linux:       $LINUX_TREE"
	assert_line "  Devicetree:  $LINUX_BASE"
	assert_line "  Overlay:     $WORKFILE (created)"
}

# bats test_tags=req:INIT-06
@test "init with no binding caches says how to build them, and creates nothing" {
	rm "$PROJECT/.analog-attach/linux/"*.json
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'compat-index,validation.json'
	assert_json '.hints[0]' "Run 'analog-attach config --reload' to build the binding caches."
	[ ! -e "$WORKFILE" ]
	run aa init
	assert_output --partial "Run 'analog-attach config --reload' to build the binding caches."
}

# bats test_tags=req:INIT-06
@test "init with one cache missing names it" {
	rm "$PROJECT/.analog-attach/linux/validation.json"
	run_config_error init
	assert_json '[.errors[].field] | join(",")' 'validation.json'
	assert_json '.errors[0].message' "validation.json not found or unreadable in $PROJECT/.analog-attach/linux"
}
