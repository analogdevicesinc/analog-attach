# End to end, where the backend is linux: an AD5593R on the I2C bus of a Raspberry Pi 4, from an
# empty overlay to a built and deployed .dtbo. Its channels are child nodes, each with its own
# mode.
#
# Not run by default, nor in CI (run.sh runs noos/, linux/ and conformity/): run it with
#   test/functional/run.sh e2e/linux-ad5593r-rpi4.bats
# With AA_DEPLOY_IP (and AA_DEPLOY_USER, AA_DEPLOY_PASSWORD) it deploys to that Raspberry Pi and
# reboots it; otherwise a stand-in deploy-command shows the step. AA_E2E_UPDATE=1 rewrites the
# fixture from the run, when the bindings or the output change on purpose.

# bats file_tags=eco:linux, e2e

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
setup() {
	load ../helpers
	load linux-helpers
	FIXTURE="$FUNCTIONAL_DIR/e2e/fixtures/ad5593r-rpi4.dtso"
	new_project linux
}

# Description: an AD5593R on the RPi 4's i2c1 goes from an empty overlay to a deployed .dtbo:
# found (it shares the AD5592R's binding), added, moved to its I2C address, given its cells and
# reference, two channels added and set, one moved to another channel number, validated, built
# and deployed; the overlay is the fixture's, and the fixture imported in a new project builds
# the same .dtbo.
# Steps:
#   1. Run init, then list devices ad5593r and list overlay adi,ad5593r; check they offer
#      adi,ad5593r and the tree's rpi-ad5593r-overlay.dts.
#   2. Add adi,ad5593r --parent i2c1, with --json; check it adds adi,ad5593r@0 under
#      i2c@7e804000 and lists #address-cells and #size-cells as missing.
#   3. Update reg to 0x10; check the node is renamed adi,ad5593r@10.
#   4. Check list value ad5593r #address-cells offers 1; set #address-cells to 1, #size-cells to
#      0 and vref-supply to vdd_3v3_reg.
#   5. Update ad5593r channel@0 and channel@1; check each is added and lists adi,mode as missing.
#   6. Check validate finds the two channels' missing adi,mode.
#   7. Check list value ad5593r/channel@0 adi,mode offers 1; set channel@0's adi,mode to 1 (DAC),
#      channel@1's to 2 (ADC) and its adi,off-state to 0.
#   8. Rename ad5593r/channel@1 channel@3; check read gives back its reg 3.
#   9. Check validate finds no error and no warning.
#   10. Check the overlay is the fixture's (AA_E2E_UPDATE=1 rewrites the fixture instead).
#   11. Build, with --json; check it writes build/overlay.dtbo with the adi,ad5593r node.
#   12. Deploy: with AA_DEPLOY_IP to that Raspberry Pi, else through a stand-in deploy-command;
#       check it succeeds.
#   13. In a new project, import the fixture; check it validates and builds the same .dtbo.
# bats test_tags=e2e, id:L0362
@test "end to end: an AD5593R on a Raspberry Pi 4's I2C, with its channels, to a deployed overlay" {
	aa init >/dev/null
	run_json list devices ad5593r
	assert_json '[.devices[].key] | index("adi,ad5593r") != null' true
	run_json list overlay adi,ad5593r
	assert_json '[.overlays[].name] | index("rpi-ad5593r-overlay.dts") != null' true

	run_json add adi,ad5593r --parent i2c1
	assert_success
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/i2c@7e804000/adi,ad5593r@0'
	assert_json '.missing_required | map(.property) | join(",")' '#address-cells,#size-cells'

	run aa update ad5593r reg 0x10
	assert_success
	assert_output 'Set reg on ad5593r; renamed to adi,ad5593r@10'

	run_json list value ad5593r '#address-cells'
	assert_json '[.suggestions[].value] | index("1") != null' true
	aa update ad5593r '#address-cells' 1 >/dev/null
	aa update ad5593r '#size-cells' 0 >/dev/null
	aa update ad5593r vref-supply vdd_3v3_reg >/dev/null

	local channel
	for channel in channel@0 channel@1; do
		run_json update ad5593r "$channel"
		assert_success
		assert_json '.ok' true
		assert_json '.missing_required | map(.property) | join(",")' 'adi,mode'
	done

	run_json validate
	assert_json '[.errors[].message | select(test("adi,mode"))] | length' 2

	run_json list value ad5593r/channel@0 adi,mode
	assert_json '[.suggestions[].value] | index("1") != null' true
	aa update ad5593r/channel@0 adi,mode 1 >/dev/null
	aa update ad5593r/channel@1 adi,mode 2 >/dev/null
	aa update ad5593r/channel@1 adi,off-state 0 >/dev/null

	run aa rename ad5593r/channel@1 channel@3
	assert_success
	run aa read ad5593r/channel@3 reg --quiet
	assert_output 'reg = <3>;'

	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0

	same_as_fixture
	builds_into_dtbo adi,ad5593r
	deploys
	fixture_builds_again
}
