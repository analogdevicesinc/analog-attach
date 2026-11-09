# End to end, where the backend is linux: an ADXL345 on the I2C bus of a Raspberry Pi 4, from an
# empty overlay to a built and deployed .dtbo. It starts from the binding's example and fixes
# what doesn't fit the board.
#
# Not run by default, nor in CI (run.sh runs noos/, linux/ and conformity/): run it with
#   test/functional/run.sh e2e/linux-adxl345-rpi4.bats
# With AA_DEPLOY_IP (and AA_DEPLOY_USER, AA_DEPLOY_PASSWORD) it deploys to that Raspberry Pi and
# reboots it; otherwise a stand-in deploy-command shows the step. AA_E2E_UPDATE=1 rewrites the
# fixture from the run, when the bindings or the output change on purpose.

# bats file_tags=eco:linux, e2e

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
setup() {
	load ../helpers
	load linux-helpers
	FIXTURE="$FUNCTIONAL_DIR/e2e/fixtures/adxl345-rpi4.dtso"
	new_project linux
}

# Description: an ADXL345 on the RPi 4's i2c1 goes from an empty overlay to a deployed .dtbo:
# found, copied from the binding's example, its interrupt wired to the board's GPIO controller,
# moved to its I2C address, renamed, validated, built and deployed; the overlay is the
# fixture's, and the fixture imported in a new project builds the same .dtbo.
# Steps:
#   1. Run init, then list devices adxl345 and list overlay adi,adxl345; check they offer
#      adi,adxl345 and the tree's rpi-adxl345-overlay.dts.
#   2. Add adi,adxl345 --template example:1 --parent i2c1, with --json; check it adds
#      accelerometer@2a under i2c@7e804000 and lists the example's interrupt-parent &gpio0 as
#      unresolved.
#   3. Check validate finds one error, in interrupts.
#   4. Check list value adxl345 interrupt-parent offers gpio; set it, and interrupts to 17
#      IRQ_TYPE_LEVEL_HIGH; check read gives back interrupts = <17 4>.
#   5. Update reg to 0x53; check the node is renamed accelerometer@53. Rename it accel; check
#      read gives the key accel@53, label adxl345.
#   6. Check validate finds no error and no warning.
#   7. Check the overlay is the fixture's (AA_E2E_UPDATE=1 rewrites the fixture instead).
#   8. Build, with --json; check it writes build/overlay.dtbo with the adi,adxl345 node.
#   9. Deploy: with AA_DEPLOY_IP to that Raspberry Pi, else through a stand-in deploy-command;
#      check it succeeds.
#   10. In a new project, import the fixture; check it validates and builds the same .dtbo.
# bats test_tags=e2e, id:L0360
@test "end to end: an ADXL345 on a Raspberry Pi 4's I2C, from the binding's example to a deployed overlay" {
	aa init >/dev/null
	run_json list devices adxl345
	assert_json '[.devices[].key] | index("adi,adxl345") != null' true
	run_json list overlay adi,adxl345
	assert_json '[.overlays[].name] | index("rpi-adxl345-overlay.dts") != null' true

	run_json add adi,adxl345 --template example:1 --parent i2c1
	assert_success
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/i2c@7e804000/accelerometer@2a'
	assert_json '.unresolved | map(.property + " " + .reference) | join(",")' 'interrupt-parent &gpio0'

	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].message | test("interrupts")' true

	run_json list value adxl345 interrupt-parent
	assert_json '[.suggestions[].value] | index("gpio") != null' true
	aa update adxl345 interrupt-parent gpio >/dev/null
	aa update adxl345 interrupts 17 IRQ_TYPE_LEVEL_HIGH >/dev/null
	run aa read adxl345 interrupts --quiet
	assert_output 'interrupts = <17 4>;'

	run aa update adxl345 reg 0x53
	assert_success
	assert_output 'Set reg on adxl345; renamed to accelerometer@53'
	run aa rename adxl345 accel
	assert_success
	run_json read adxl345
	assert_json '.key' accel@53
	assert_json '.alias | join(",")' adxl345

	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0

	same_as_fixture
	builds_into_dtbo adi,adxl345
	deploys
	fixture_builds_again
}
