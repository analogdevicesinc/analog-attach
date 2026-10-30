# deploy where the backend is noos: the generated project flashed through a debug probe.
#
# Nothing here flashes a board unless AA_DEPLOY=1 (with a board attached, and the real trees
# of build.bats: AA_CAPI_PATH, AA_MODULE_PATHS, AA_TARGET). The other tests stop before the
# flash step, or replace it with the deploy-command setting.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# `fake_flash`: the deploy-command setting in place of the flash step: it records that it ran.
fake_flash() {
	aa config deploy-command 'echo flashed >deployed.txt' >/dev/null
}

# bats test_tags=req:DEPLOY-01
@test "deploy with no generated project says what to run first" {
	run_json deploy
	assert_json '.ok' false
	assert_json '.message | test("Run: analog-attach generate")' true
	[ ! -e "$PROJECT/out" ]
}

# bats test_tags=req:DEPLOY-01
@test "deploy of a project that was never built says to build it first" {
	aa generate >/dev/null
	fake_flash
	run_json deploy
	assert_json '.ok' false
	assert_json '.message | test("build")' true
	[ ! -e "$PROJECT/out/project/deployed.txt" ]
}

# bats test_tags=req:DEPLOY-02
@test "deploy refuses an unknown --probe, naming openocd and jlink" {
	run aa deploy --probe nope
	assert_failure 2
	assert_output --partial "Unknown probe 'nope'. Supported: openocd, jlink"
}

# bats test_tags=req:DEPLOY-02
@test "deploy refuses an unknown --probe before anything else" {
	aa generate >/dev/null
	fake_flash
	run aa deploy --probe nope
	assert_failure 2
	[ ! -e "$PROJECT/out/project/deployed.txt" ]
}

# bats test_tags=req:DEPLOY-02
@test "deploy accepts --probe openocd and --probe jlink" {
	aa generate >/dev/null
	fake_flash
	# A build step of the user's own: deploy can't tell where it puts the image, so it doesn't
	# ask for one (the project here is never built).
	aa config build-command true >/dev/null
	local probe
	for probe in openocd jlink; do
		rm -f "$PROJECT/out/project/deployed.txt"
		run_json deploy --probe "$probe"
		assert_json '.ok' true
		[ -f "$PROJECT/out/project/deployed.txt" ]
	done
}

# bats test_tags=req:DEPLOY-02
@test "the probe setting takes openocd or jlink only" {
	run aa config probe jlink
	assert_success
	run aa config probe nope
	assert_failure 2
	run_json config probe
	assert_json '.configs[0].value' jlink
}

# bats test_tags=req:DEPLOY-01, req:DEPLOY-02, needs:toolchain, needs:board
@test "deploy flashes the built image through the probe, --probe overriding the setting" {
	[ "${AA_DEPLOY:-}" = 1 ] || skip "flashes a board (set AA_DEPLOY=1)"
	real_project
	rm "$PROJECT/workfile.json"
	aa init >/dev/null
	aa add adxl355 >/dev/null
	aa add capi_gpio_pin --name cs_pin >/dev/null
	aa update cs_pin port_handle bsp_gpio2_cfg_handle >/dev/null
	aa update cs_pin number 0 >/dev/null
	aa update adxl355_spi_dev cs_gpio cs_pin >/dev/null
	aa generate >/dev/null
	aa build >/dev/null 2>&1
	aa config probe jlink
	run aa deploy --probe openocd
	assert_success
	assert_output --partial "via openocd"
	assert_output --partial "Deploy completed successfully"
}
