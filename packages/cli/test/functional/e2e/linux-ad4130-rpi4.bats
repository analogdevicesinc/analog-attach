# End to end, where the backend is linux: an AD4130 on the SPI bus of a Raspberry Pi 4, from an
# empty overlay to a built and deployed .dtbo. It starts from the tree's RPi overlay for the
# part, and adds an excitation channel of its own.
#
# Not run by default, nor in CI (run.sh runs noos/, linux/ and conformity/): run it with
#   test/functional/run.sh e2e/linux-ad4130-rpi4.bats
# With AA_DEPLOY_IP (and AA_DEPLOY_USER, AA_DEPLOY_PASSWORD) it deploys to that Raspberry Pi and
# reboots it; otherwise a stand-in deploy-command shows the step. AA_E2E_UPDATE=1 rewrites the
# fixture from the run, when the bindings or the output change on purpose.

# bats file_tags=eco:linux, e2e

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
setup() {
	load ../helpers
	load linux-helpers
	FIXTURE="$FUNCTIONAL_DIR/e2e/fixtures/ad4130-rpi4.dtso"
	new_project linux
}

# Description: an AD4130 on the RPi 4's spi0 goes from an empty overlay to a deployed .dtbo:
# found, copied from the tree's rpi-ad4130 overlay with its five channels, the base's spidev0
# disabled for its chip select, the bus enabled, a channel deleted, a channel added with an
# excitation current that validate first refuses and then accepts, validated, built and
# deployed; the overlay is the fixture's, and the fixture imported in a new project builds the
# same .dtbo.
# Steps:
#   1. Run init, then list devices ad4130 and list overlay adi,ad4130; check they offer
#      adi,ad4130 and the tree's rpi-ad4130-overlay.dts.
#   2. Add adi,ad4130 --template overlay:rpi-ad4130, with --json; check it adds ad4130@0 under
#      spi@7e204000 with channel@0 to channel@4, nothing unresolved, and warns that chip
#      select 0 is spidev@0's.
#   3. Check validate gives that warning, with the hint to disable spidev@0, and no error.
#   4. Disable spi/spidev@0 and enable spi; check validate gives no warning.
#   5. Delete ad4130/channel@4; check read ad4130 has channel@0 to channel@3.
#   6. Update ad4130 channel@a; check it is added with reg 10 and lists diff-channels as
#      missing. Set diff-channels to 2 3, adi,excitation-pin-0 to 0, adi,reference-select to 1
#      and adi,excitation-current-0-nanoamp to 12345; check that update warns 12345 is not one
#      of the binding's currents.
#   7. Check validate finds one error, the excitation current; check list value
#      ad4130/channel@a adi,excitation-current-0-nanoamp offers 100000, and set it.
#   8. Check validate finds no error and no warning.
#   9. Check the overlay is the fixture's (AA_E2E_UPDATE=1 rewrites the fixture instead).
#   10. Build, with --json; check it writes build/overlay.dtbo with the adi,ad4130 node.
#   11. Deploy: with AA_DEPLOY_IP to that Raspberry Pi, else through a stand-in deploy-command;
#       check it succeeds.
#   12. In a new project, import the fixture; check it validates and builds the same .dtbo.
# bats test_tags=e2e, id:L0364
@test "end to end: an AD4130 on a Raspberry Pi 4's SPI, from the tree's overlay to a deployed overlay" {
	aa init >/dev/null
	run_json list devices ad4130
	assert_json '[.devices[].key] | index("adi,ad4130") != null' true
	run_json list overlay adi,ad4130
	assert_json '[.overlays[].name] | index("rpi-ad4130-overlay.dts") != null' true

	run_json add adi,ad4130 --template overlay:rpi-ad4130
	assert_success
	assert_json '.ok' true
	assert_json '.path | join("/")' 'soc/spi@7e204000/ad4130@0'
	assert_json '.unresolved | length' 0
	[[ "$stderr" == *"chip select 0 is already used by spidev@0"* ]] || fail "no chip select warning: $stderr"
	run_json read ad4130
	assert_json '.children | map(.key) | join(",")' 'channel@0,channel@1,channel@2,channel@3,channel@4'

	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 1
	assert_json '.warnings[0].message' \
		'chip select 0 is already used by spidev@0; If ad4130@0 replaces it: disable /soc/spi@7e204000/spidev@0'

	aa disable spi/spidev@0 >/dev/null
	aa enable spi >/dev/null
	run_json validate
	assert_json '.warnings | length' 0

	aa delete ad4130/channel@4 >/dev/null
	run_json read ad4130
	assert_json '.children | map(.key) | join(",")' 'channel@0,channel@1,channel@2,channel@3'

	run_json update ad4130 channel@a
	assert_success
	assert_json '.ok' true
	assert_json '.missing_required | map(.property) | join(",")' diff-channels
	run aa read ad4130/channel@a reg --quiet
	assert_output 'reg = <10>;'
	aa update ad4130/channel@a diff-channels 2 3 >/dev/null
	aa update ad4130/channel@a adi,excitation-pin-0 0 >/dev/null
	aa update ad4130/channel@a adi,reference-select 1 >/dev/null
	run_json update ad4130/channel@a adi,excitation-current-0-nanoamp 12345
	assert_success
	[[ "$stderr" == *"adi,excitation-current-0-nanoamp takes one of 0, 100, 10000, 20000, 50000, 100000, 150000, 200000, got 12345"* ]] ||
		fail "no warning about the current: $stderr"

	run_json validate
	assert_json '.errors | length' 1
	assert_json '.errors[0].message | test("12345 is not one of")' true
	run_json list value ad4130/channel@a adi,excitation-current-0-nanoamp
	assert_json '[.suggestions[].value] | index("100000") != null' true
	aa update ad4130/channel@a adi,excitation-current-0-nanoamp 100000 >/dev/null

	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0

	same_as_fixture
	builds_into_dtbo adi,ad4130
	deploys
	fixture_builds_again
}
