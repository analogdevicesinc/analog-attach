# End to end, where the backend is linux: an ADXL367 on the SPI bus of a Raspberry Pi 4, from an
# empty overlay to a built and deployed .dtbo. It takes the chip select of the base's spidev,
# which it disables, and enables the bus.
#
# Not run by default, nor in CI (run.sh runs noos/, linux/ and conformity/): run it with
#   test/functional/run.sh e2e/linux-adxl367-rpi4.bats
# With AA_DEPLOY_IP (and AA_DEPLOY_USER, AA_DEPLOY_PASSWORD) it deploys to that Raspberry Pi and
# reboots it; otherwise a stand-in deploy-command shows the step. AA_E2E_UPDATE=1 rewrites the
# fixture from the run, when the bindings or the output change on purpose.

# bats file_tags=eco:linux, e2e

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
setup() {
	load ../helpers
	load linux-helpers
	FIXTURE="$FUNCTIONAL_DIR/e2e/fixtures/adxl367-rpi4.dtso"
	new_project linux
}

# Description: an ADXL367 on the RPi 4's spi0 goes from an empty overlay to a deployed .dtbo:
# found, added on the free chip select, moved to chip select 0 in place of the base's spidev0,
# its interrupt, supplies and clock rate set, the bus enabled, renamed, validated, built and
# deployed; the overlay is the fixture's, and the fixture imported in a new project builds the
# same .dtbo.
# Steps:
#   1. Run init, then list devices adxl367 and list overlay adi,adxl367; check they offer
#      adi,adxl367 and the tree's rpi-adxl367-overlay.dts.
#   2. Add adi,adxl367 --parent spi, with --json; check it adds adi,adxl367@2 under
#      spi@7e204000, says it picked chip select 2 past spidev@0 and spidev@1, and warns that
#      spi0's cs-gpios has no entry for it; check it lists interrupt-parent and interrupts as
#      missing.
#   3. Disable spi/spidev@0, then update reg to 0; check the node is renamed adi,adxl367@0.
#   4. Check list value adxl367 vdd-supply offers vdd_3v3_reg; set vdd-supply and vddio-supply to
#      it, interrupt-parent to gpio, interrupts to 25 IRQ_TYPE_EDGE_RISING and spi-max-frequency
#      to 1000000; check read gives back spi-max-frequency.
#   5. Enable spi; check read spi status --quiet gives okay.
#   6. Rename adxl367 accel; check validate finds no error and no warning.
#   7. Check the overlay is the fixture's (AA_E2E_UPDATE=1 rewrites the fixture instead).
#   8. Build, with --json; check it writes build/overlay.dtbo with the adi,adxl367 node.
#   9. Deploy: with AA_DEPLOY_IP to that Raspberry Pi, else through a stand-in deploy-command;
#      check it succeeds.
#   10. In a new project, import the fixture; check it validates and builds the same .dtbo.
# bats test_tags=e2e, id:L0361
@test "end to end: an ADXL367 on a Raspberry Pi 4's SPI, in place of spidev0, to a deployed overlay" {
	aa init >/dev/null
	run_json list devices adxl367
	assert_json '[.devices[].key] | index("adi,adxl367") != null' true
	run_json list overlay adi,adxl367
	assert_json '[.overlays[].name] | index("rpi-adxl367-overlay.dts") != null' true

	run_json add adi,adxl367 --parent spi
	assert_success
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/spi@7e204000/adi,adxl367@2'
	assert_json '.missing_required | map(.property) | join(",")' 'interrupt-parent,interrupts'
	[[ "$stderr" == *"Picked chip select 2 (taken: 0 by spidev@0, 1 by spidev@1)."* ]] ||
		fail "no chip select note: $stderr"
	[[ "$stderr" == *"chip select 2 has no cs-gpios entry"* ]] || fail "no cs-gpios warning: $stderr"

	aa disable spi/spidev@0 >/dev/null
	run aa update adxl367 reg 0
	assert_success
	assert_output 'Set reg on adxl367; renamed to adi,adxl367@0'

	run_json list value adxl367 vdd-supply
	assert_json '[.suggestions[].value] | index("vdd_3v3_reg") != null' true
	aa update adxl367 vdd-supply vdd_3v3_reg >/dev/null
	aa update adxl367 vddio-supply vdd_3v3_reg >/dev/null
	aa update adxl367 interrupt-parent gpio >/dev/null
	aa update adxl367 interrupts 25 IRQ_TYPE_EDGE_RISING >/dev/null
	aa update adxl367 spi-max-frequency 1000000 >/dev/null
	run aa read adxl367 spi-max-frequency --quiet
	assert_output 'spi-max-frequency = <1000000>;'

	aa enable spi >/dev/null
	run aa read spi status --quiet
	assert_output 'status = "okay";'

	aa rename adxl367 accel >/dev/null
	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0

	same_as_fixture
	builds_into_dtbo adi,adxl367
	deploys
	fixture_builds_again
}
