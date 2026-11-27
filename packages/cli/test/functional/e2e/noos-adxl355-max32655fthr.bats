# End to end, where the backend is noos: an ADXL355 on a MAX32655FTHR, on the real CAPI trees,
# from an empty project to a built firmware image. An example for the end-to-end tests to come:
# one user story through many commands, checked against a workfile fixture.
#
# Not run by default, nor in CI (run.sh runs noos/ and linux/): run it with
#   AA_CAPI_PATH=~/aurel/capi AA_MODULE_PATHS=~/aurel/capi-maxim:~/aurel/capi-noos:~/aurel/capi-util \
#   test/functional/run.sh e2e
# It skips without the trees, cmake, ninja, arm-none-eabi-gcc or MAXIM_SDK_PATH. With AA_DEPLOY=1
# it flashes a MAX32655FTHR on the probe; otherwise a stand-in deploy-command shows the step.
# AA_E2E_UPDATE=1 rewrites the fixture from the run, when the definitions change on purpose.

# bats file_tags=eco:noos, e2e

# Preconditions: a noos project on the real CAPI trees (AA_CAPI_PATH, AA_MODULE_PATHS) with the
# toolchain (cmake, ninja, arm-none-eabi-gcc, MAXIM_SDK_PATH), target max32655fthr, interview
# off, no workfile yet.
setup() {
	load ../helpers
	FIXTURE="$FUNCTIONAL_DIR/e2e/fixtures/adxl355-max32655fthr.workfile.json"
	new_project noos
	real_project
	[ -n "${MAXIM_SDK_PATH:-}" ] || skip "needs MAXIM_SDK_PATH (a Maxim board)"
	aa config target max32655fthr >/dev/null
}

# `same_workfile <a> <b>`: the two workfiles hold the same JSON, whatever their key order.
same_workfile() {
	diff <(jq -S . "$1") <(jq -S . "$2") || fail "the workfiles differ: $1, $2"
}

# Description: an ADXL355 eval board on a MAX32655FTHR goes from an empty project to a built
# image: found, added and wired, read, changed, renamed, validated, generated, built and deployed;
# the workfile is the fixture's, and the fixture imported in a new project builds the same way.
# Steps:
#   1. Run init, then list devices adxl355; check it offers the eval board eval-adxl355-pmdz.
#   2. Add eval-adxl355-pmdz; check it adds the part and says how to wire it to the board.
#   3. Check validate finds the workfile valid, and read --quiet lists the part's nodes.
#   4. Check list value adxl355_ip dev_type offers ID_ADXL355.
#   5. Update adxl355_spi_dev max_speed_hz to 4000000 and check read gives it back.
#   6. Rename adxl355 to accel, and check validate still finds the workfile valid.
#   7. Check the workfile is the fixture's (AA_E2E_UPDATE=1 rewrites the fixture instead).
#   8. Generate, then build, with --json; check build gives the path of the image, which exists.
#   9. Deploy: with AA_DEPLOY=1 on the board, else through a stand-in deploy-command; check it
#      succeeds.
#   10. In a new project, import the fixture; check it validates, generates and builds an image.
# bats test_tags=e2e, id:N0279
@test "end to end: an ADXL355 on a MAX32655FTHR, from an empty project to a built image" {
	aa init >/dev/null
	run_json list devices adxl355
	assert_json '[.devices[] | select(.tag == "eval boards") | .key] | join(",")' eval-adxl355-pmdz

	run aa add eval-adxl355-pmdz
	assert_success
	assert_output --partial "Added 'adxl355' (capi_accel_sensor, for driver adxl355)"
	assert_output --partial "Wire eval-adxl355-pmdz to max32655fthr over SPI"

	run aa validate
	assert_success
	assert_output --partial "0 errors, 0 warnings"
	run aa read --quiet
	assert_line adxl355
	assert_line adxl355_spi_dev

	run aa list value adxl355_ip dev_type
	assert_line ID_ADXL355

	aa update adxl355_spi_dev max_speed_hz 4000000 >/dev/null
	run aa read adxl355_spi_dev max_speed_hz --quiet
	assert_output 4000000

	run aa rename adxl355 accel
	assert_success
	run_json validate
	assert_json '.errors | length' 0

	if [ "${AA_E2E_UPDATE:-}" = 1 ]; then
		jq . "$WORKFILE" >"$FIXTURE"
	fi
	same_workfile "$WORKFILE" "$FIXTURE"

	aa generate >/dev/null
	run_json build
	assert_json '.ok' true
	local image
	image=$(jq -r .path <<<"$output")
	[ -f "$image" ] || fail "build names $image, which doesn't exist"

	if [ "${AA_DEPLOY:-}" = 1 ]; then
		run aa deploy
	else
		aa config deploy-command 'echo flashed >deployed.txt' >/dev/null
		run aa deploy
		[ -f "$PROJECT/out/project/deployed.txt" ] || fail "the deploy-command didn't run"
	fi
	assert_success

	# The fixture, imported in a new project, builds too.
	mkdir -p "$BATS_TEST_TMPDIR/again/.analog-attach"
	cp "$PROJECT/.analog-attach/config.json" "$BATS_TEST_TMPDIR/again/.analog-attach/"
	cd "$BATS_TEST_TMPDIR/again"
	run aa import "$FIXTURE"
	assert_success
	run_json validate
	assert_json '.errors | length' 0
	aa generate >/dev/null
	run_json build
	assert_json '.ok' true
}
