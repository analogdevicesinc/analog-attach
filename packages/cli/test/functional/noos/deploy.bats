# deploy where the backend is noos: the generated project flashed through a debug probe.
#
# Nothing here flashes a board unless AA_DEPLOY=1 (with a board attached, and the real trees
# of build.bats: AA_CAPI_PATH, AA_MODULE_PATHS, AA_TARGET). The other tests stop before the
# flash step, or replace it with the deploy-command setting.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures, target otherboard, and a
# workfile with the eval-testpart board added (with_sensor), valid; no project generated yet.
setup() {
	load ../helpers
	new_project noos
	with_sensor
}

# `fake_flash`: the deploy-command setting in place of the flash step: it records that it ran.
fake_flash() {
	aa config deploy-command 'echo flashed >deployed.txt' >/dev/null
}

# Description: deploy with no generated project is refused and says to run generate first.
# Steps:
#   1. Deploy, with --json.
#   2. Check it is refused (.ok false), the message pointing to generate.
#   3. Check no out directory was made.
# bats test_tags=req:DEPLOY-01, id:N0088
@test "deploy with no generated project says what to run first" {
	run_json deploy
	assert_json '.ok' false
	assert_json '.message | test("Run: analog-attach generate")' true
	[ ! -e "$PROJECT/out" ]
}

# Description: deploy of a generated project that was never built is refused, says to build it,
# and doesn't flash.
# Steps:
#   1. Generate, and set deploy-command to a stand-in that records it ran (fake_flash).
#   2. Deploy, with --json.
#   3. Check it is refused (.ok false), the message mentioning the build.
#   4. Check the stand-in flash step didn't run.
# bats test_tags=req:DEPLOY-01, id:N0089
@test "deploy of a project that was never built says to build it first" {
	aa generate >/dev/null
	fake_flash
	run_json deploy
	assert_json '.ok' false
	assert_json '.message | test("build")' true
	[ ! -e "$PROJECT/out/project/deployed.txt" ]
}

# Description: an unknown --probe is refused, the message naming the supported probes.
# Steps:
#   1. Deploy --probe nope.
#   2. Check it is refused (exit 0), saying the probe is unknown and openocd and jlink are
#      supported.
# bats test_tags=req:DEPLOY-02, id:N0090
@test "deploy refuses an unknown --probe, naming openocd and jlink" {
	run aa deploy --probe nope
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "Unknown probe 'nope'. Supported: openocd, jlink"
}

# Description: an unknown --probe is refused before any other step, so nothing is flashed.
# Steps:
#   1. Generate, and set deploy-command to a stand-in that records it ran (fake_flash).
#   2. Deploy --probe nope.
#   3. Check it is refused (exit 0), and the stand-in flash step didn't run.
# bats test_tags=req:DEPLOY-02, id:N0091
@test "deploy refuses an unknown --probe before anything else" {
	aa generate >/dev/null
	fake_flash
	run aa deploy --probe nope
	assert_success  # a refused value: the command ran (GEN-09)
	[ ! -e "$PROJECT/out/project/deployed.txt" ]
}

# Description: deploy accepts openocd and jlink as --probe.
# Steps:
#   1. Generate, set deploy-command to a stand-in that records it ran (fake_flash), and set
#      build-command to true.
#   2. For each of openocd and jlink: deploy --probe <probe>, with --json.
#   3. Check each succeeds (.ok true) and the stand-in flash step ran.
# bats test_tags=req:DEPLOY-02, id:N0092
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

# Description: the probe setting accepts jlink and refuses another value, keeping the one it had.
# Steps:
#   1. Set probe to jlink with config, and check it succeeds.
#   2. Set probe to nope with config, and check it is refused (exit 0).
#   3. Read the probe setting, with --json, and check it is still jlink.
# bats test_tags=req:DEPLOY-02, id:N0093
@test "the probe setting takes openocd or jlink only" {
	run aa config probe jlink
	assert_success
	run aa config probe nope
	assert_success  # a refused value: the command ran (GEN-09)
	run_json config probe
	assert_json '.configs[0].value' jlink
}

# Description: on a real board, deploy flashes the built image through the probe given by --probe,
# which overrides the probe setting.
# Steps:
#   1. Skip unless AA_DEPLOY=1 and the real trees are configured (real_project).
#   2. Make a new workfile with adxl355 and a capi_gpio_pin cs_pin as its chip select, generate and
#      build.
#   3. Set probe to jlink with config.
#   4. Deploy --probe openocd.
#   5. Check it succeeds, saying it went via openocd and the deploy completed.
# bats test_tags=req:DEPLOY-01, req:DEPLOY-02, needs:toolchain, needs:board, id:N0094
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
