# End to end, where the backend is linux: an AD7124-8 on the auxiliary SPI bus of a Raspberry
# Pi 4, from an empty overlay to a built and deployed .dtbo. It runs from a clock the overlay
# adds, and its channels are numbered in decimal.
#
# Not run by default, nor in CI (run.sh runs noos/, linux/ and conformity/): run it with
#   test/functional/run.sh e2e/linux-ad7124-8-rpi4.bats
# With AA_DEPLOY_IP (and AA_DEPLOY_USER, AA_DEPLOY_PASSWORD) it deploys to that Raspberry Pi and
# reboots it; otherwise a stand-in deploy-command shows the step. AA_E2E_UPDATE=1 rewrites the
# fixture from the run, when the bindings or the output change on purpose.

# bats file_tags=eco:linux, e2e

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
setup() {
	load ../helpers
	load linux-helpers
	FIXTURE="$FUNCTIONAL_DIR/e2e/fixtures/ad7124-8-rpi4.dtso"
	new_project linux
}

# Description: an AD7124-8 on the RPi 4's spi1 goes from an empty overlay to a deployed .dtbo:
# found, added, given a fixed clock the overlay adds, its interrupt, reference and cells set,
# the bus enabled, two differential channels added (channel@10 with reg 10), a property deleted,
# validated, built and deployed; the overlay is the fixture's, and the fixture imported in a new
# project builds the same .dtbo.
# Steps:
#   1. Run init, then list devices ad7124 and list overlay adi,ad7124-8; check they offer
#      adi,ad7124-8 and the tree's rpi-ad7124-8-all-diff-overlay.dts.
#   2. Add adi,ad7124-8 --parent spi1, with --json; check it adds adi,ad7124-8@0 under
#      spi@7e215080 and lists interrupt-parent and interrupts as missing.
#   3. Add fixed-clock, with --json; check it goes under /clocks and lists #clock-cells and
#      clock-frequency as missing; set them to 0 and 614400.
#   4. Check list value ad7124_8 clocks offers fixed_clock first; set clocks to it and
#      clock-names to mclk.
#   5. Set interrupt-parent to gpio, interrupts to 25 IRQ_TYPE_EDGE_FALLING, #address-cells to
#      1, #size-cells to 0 and refin1-supply to vdd_3v3_reg; enable spi1.
#   6. Update ad7124_8 channel@0 and channel@10; check each is added and lists diff-channels as
#      missing. Set their diff-channels to 0 1 and 2 3, and channel@0's bipolar and
#      adi,reference-select 0.
#   7. Check read ad7124_8/channel@10 gives reg 10 and diff-channels [2, 3].
#   8. Delete channel@0's adi,reference-select; check read no longer has it.
#   9. Check validate finds no error and no warning.
#   10. Check the overlay is the fixture's (AA_E2E_UPDATE=1 rewrites the fixture instead).
#   11. Build, with --json; check it writes build/overlay.dtbo with the adi,ad7124-8 and
#       fixed-clock nodes.
#   12. Deploy: with AA_DEPLOY_IP to that Raspberry Pi, else through a stand-in deploy-command;
#       check it succeeds.
#   13. In a new project, import the fixture; check it validates and builds the same .dtbo.
# bats test_tags=e2e, id:L0363
@test "end to end: an AD7124-8 on a Raspberry Pi 4's aux SPI, with its own clock, to a deployed overlay" {
	aa init >/dev/null
	run_json list devices ad7124
	assert_json '[.devices[].key] | index("adi,ad7124-8") != null' true
	run_json list overlay adi,ad7124-8
	assert_json '[.overlays[].name] | index("rpi-ad7124-8-all-diff-overlay.dts") != null' true

	run_json add adi,ad7124-8 --parent spi1
	assert_success
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/spi@7e215080/adi,ad7124-8@0'
	assert_json '.missing_required | map(.property) | join(",")' 'interrupt-parent,interrupts'

	run_json add fixed-clock
	assert_success
	assert_json '.path | join("/")' 'clocks/fixed-clock'
	assert_json '.missing_required | map(.property) | join(",")' '#clock-cells,clock-frequency'
	aa update fixed_clock '#clock-cells' 0 >/dev/null
	aa update fixed_clock clock-frequency 614400 >/dev/null

	run_json list value ad7124_8 clocks
	assert_json '.suggestions[0].value' fixed_clock
	aa update ad7124_8 clocks fixed_clock >/dev/null
	aa update ad7124_8 clock-names mclk >/dev/null
	aa update ad7124_8 interrupt-parent gpio >/dev/null
	aa update ad7124_8 interrupts 25 IRQ_TYPE_EDGE_FALLING >/dev/null
	aa update ad7124_8 '#address-cells' 1 >/dev/null
	aa update ad7124_8 '#size-cells' 0 >/dev/null
	aa update ad7124_8 refin1-supply vdd_3v3_reg >/dev/null
	aa enable spi1 >/dev/null

	local channel
	for channel in channel@0 channel@10; do
		run_json update ad7124_8 "$channel"
		assert_success
		assert_json '.ok' true
		assert_json '.missing_required | map(.property) | join(",")' diff-channels
	done
	aa update ad7124_8/channel@0 diff-channels 0 1 >/dev/null
	aa update ad7124_8/channel@0 bipolar >/dev/null
	aa update ad7124_8/channel@0 adi,reference-select 0 >/dev/null
	aa update ad7124_8/channel@10 diff-channels 2 3 >/dev/null
	run_json read ad7124_8/channel@10
	assert_json '.properties | map("\(.key)=\(.value)") | join(" ")' 'reg=10 diff-channels=[2,3]'

	aa delete ad7124_8/channel@0 adi,reference-select >/dev/null
	run_json read ad7124_8/channel@0
	assert_json '.properties | map(.key) | join(",")' 'reg,diff-channels,bipolar'

	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0

	same_as_fixture
	builds_into_dtbo adi,ad7124-8 fixed-clock
	deploys
	fixture_builds_again
}
