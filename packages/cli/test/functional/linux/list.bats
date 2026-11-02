# list where the backend is linux: the devices, a node's properties and values, the parents a
# device can go under and the overlays of the Linux tree that have it.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
}

# `with_adc`: an overlay with an AD7124-8 on spi1 (label ad7124_8, node adi,ad7124-8@0).
with_adc() {
	with_overlay
	aa add adi,ad7124-8 --parent spi1 >/dev/null 2>&1 || fail "add adi,ad7124-8 failed"
}

# --- list devices ---

# Gap: piped, the output stops at 64 KB (about 3400 of the tree's compatibles, or JSON cut
# mid-string): the CLI exits before standard output drains.
# bats test_tags=req:LIST-01, gap
@test "list devices lists every compatible of the Linux tree" {
	local count
	count=$(jq '.entries | length' "$PROJECT/.analog-attach/linux/compat-index.json")
	run_json list devices
	assert_success
	# Checked quietly: the output is too long to show.
	jq -e --argjson count "$count" '.devices | length == $count' <<<"$output" >/dev/null 2>&1 ||
		fail "list devices --json: not $count devices (${#output} bytes of output)"
	run aa list devices
	assert_success
	[ "${#lines[@]}" -eq "$count" ] || fail "list devices: $count lines expected, got ${#lines[@]}"
}

# bats test_tags=req:LIST-01
@test "list devices gives each device the key add takes" {
	run_json list devices adxl34
	assert_success
	assert_json '[.devices[].key] | sort | join(" ")' "adi,adxl345 adi,adxl346"
	with_overlay
	run_json add adi,adxl346 --parent i2c1
	assert_success
	assert_json '.ok' true
	run_json add adi,adxl345 --parent i2c1
	assert_success
	assert_json '.ok' true
}

# bats test_tags=req:LIST-01
@test "list devices needs no workfile" {
	[ ! -e "$WORKFILE" ]
	run_json list devices adxl34
	assert_success
	assert_json '.devices | length' 2
}

# bats test_tags=req:LIST-02
@test "list devices with a filter keeps the compatibles that contain it" {
	run_json list devices adxl34
	assert_success
	assert_json '.message' "Found 2 devices"
	run aa list devices adxl34
	assert_success
	assert_line "adi,adxl345"
	assert_line "adi,adxl346"
	[ "${#lines[@]}" -eq 2 ]
}

# bats test_tags=req:LIST-02
@test "list devices with a filter that matches nothing is no refusal" {
	run_json list devices zzz-no-such-part
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Found 0 devices"
	assert_json '.devices | length' 0
}

# bats test_tags=req:LIST-02
@test "list devices with a filter only one compatible has describes that device" {
	run_json list devices ad7124-8
	assert_success
	assert_json '.device.compatible' adi,ad7124-8
	assert_json '.device.binding | endswith("iio/adc/adi,ad7124.yaml")' true
	run aa list devices ad7124-8
	assert_success
	assert_line --index 0 "adi,ad7124-8"
	assert_line --regexp '^  binding: .*/iio/adc/adi,ad7124\.yaml$'
	assert_line --regexp '^  [0-9]+ properties, 1 child node patterns$'
}

# Gap: the compatibles come one per line in the compat index's order, with no category (the
# binding's folder, iio/adc, iio/accel), as text and in JSON.
# bats test_tags=req:LIST-04-LNX, gap
@test "list devices groups the compatibles by category" {
	run_json list devices adxl34
	assert_success
	assert_json '[.devices[] | .category] | unique | join(" ")' "iio/accel"
	run aa list devices adi,ad7124
	assert_success
	assert_line --partial "iio/adc"
}

# --- list context ---

# Gap: `list context is not supported by the linux backend`, exit 2.
# bats test_tags=req:LIST-05, req:LIST-05-LNX, gap
@test "list context lists the .dts files of the Linux tree" {
	run_json list context
	assert_success
	assert_json '.ok' true
	assert_json "[.. | strings | select(endswith(\"broadcom/bcm2711-rpi-4-b.dts\"))] | length > 0" true
}

# Gap: as above, list context is not supported.
# bats test_tags=req:LIST-05-LNX, gap
@test "every target list context names is one the devicetree setting takes" {
	run_json list context
	assert_success
	local target
	target=$(jq -r '[.. | strings | select(endswith(".dts"))][0]' <<<"$output")
	[ -n "$target" ] && [ "$target" != null ] || fail "no .dts in: $output"
	run aa config devicetree "$target"
	assert_success
}

# Gap: as above, list context is not supported.
# bats test_tags=req:LIST-06, gap
@test "list context says how to select a target" {
	run aa list context
	assert_success
	assert_output --partial "config devicetree"
}

# --- list property ---

# Gap: the path is required: `Missing: path (list property <path> [property])`, exit 2.
# bats test_tags=req:LIST-07, gap
@test "list property with no node lists the overlay's nodes" {
	with_adc
	run_json list property
	assert_success
	assert_json '.ok' true
	assert_output --partial "adi,ad7124-8@0"
}

# bats test_tags=req:LIST-07
@test "list property of a node marks what is required and what is set" {
	with_adc
	run aa list property ad7124_8
	assert_success
	assert_line "compatible (set, required)"
	assert_line "reg (set, required)"
	assert_line "interrupts (required)"
	assert_line "avdd-supply"
	aa update ad7124_8 avdd-supply vdd_3v3_reg >/dev/null
	run aa list property ad7124_8
	assert_line "avdd-supply (set)"
}

# bats test_tags=req:LIST-07
@test "list property of a node lists its child node patterns by the names they match" {
	with_adc
	run aa list property ad7124_8
	assert_success
	assert_line 'channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$; present: none)'
	aa update ad7124_8 channel@0 >/dev/null 2>&1
	run aa list property ad7124_8
	assert_line 'channel@0 … channel@15 (child node ^channel@([0-9]|1[0-5])$; present: channel@0)'
	run_json list property ad7124_8
	assert_json '.names | index("^channel@([0-9]|1[0-5])$") != null' true
}

# Gap: a node's listing gives each property's name and marks, not its type; the type is only in
# `list property <path> <property>`.
# bats test_tags=req:LIST-07, gap
@test "list property of a node gives each property's type" {
	with_adc
	run aa list property ad7124_8
	assert_success
	assert_line --regexp '^reg .*number'
	run_json list property ad7124_8
	assert_json '.properties[] | select(.name == "reg") | .display' "number[]"
}

# bats test_tags=req:LIST-07
@test "list property of a base node lists its binding's properties" {
	with_overlay
	run_json list property spi0
	assert_success
	assert_json '.names | index("cs-gpios") != null' true
	run aa list property spi0
	assert_line "compatible (set, required)"
}

# bats test_tags=req:LIST-07
@test "list property <node> <property> gives its type, whether it is required and set" {
	with_adc
	run_json list property ad7124_8 reg
	assert_success
	assert_json '.property.name' reg
	assert_json '.property.display' "number[]"
	assert_json '.property.required' true
	assert_json '.property.set' true
	run aa list property ad7124_8 reg
	assert_line --index 0 "reg (required): number[]"
	assert_line --index 1 "  SPI chip select number for the device"
}

# bats test_tags=req:LIST-07
@test "list property of a node the tree doesn't have is refused" {
	with_overlay
	run_json list property no_such_node
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Node no_such_node not found"
	run aa list property no_such_node
	assert_output --partial "Node not found: no_such_node"
}

# --- list value ---

# bats test_tags=req:LIST-08
@test "list value gives the options of an enum" {
	with_adc
	run aa list value ad7124_8 spi-rx-bus-width
	assert_success
	assert_line --regexp $'^0\t'
	assert_line --regexp $'^8\t'
	run_json list value ad7124_8 spi-rx-bus-width
	assert_json '[.suggestions[].value] | join(" ")' "0 1 2 4 8"
}

# bats test_tags=req:LIST-08
@test "list value gives the default of an enum first" {
	with_adc
	aa update ad7124_8 channel@0 >/dev/null 2>&1
	aa add adi,ad4130 --parent spi0 >/dev/null 2>&1
	aa update ad4130 channel@0 >/dev/null 2>&1
	run_json list value ad4130/channel@0 adi,reference-select
	assert_success
	assert_json '[.suggestions[].value] | join(" ")' "0 1 2 3"
	assert_json '.suggestions[0].display_string' "0 — the binding's default"
}

# bats test_tags=req:LIST-08
@test "list value gives the nodes a phandle can name" {
	with_adc
	run_json list value ad7124_8 avdd-supply
	assert_success
	assert_json '[.suggestions[].value] | index("vdd_3v3_reg") != null' true
	run_json list value ad7124_8 interrupt-parent
	assert_json '[.suggestions[].value] | join(" ")' "gicv2 gpio"
	assert_json '.suggestions[0].display_string | contains("inherited from /")' true
}

# bats test_tags=req:LIST-08
@test "list value puts the regulators the overlay adds first for a supply" {
	with_adc
	aa add regulator-fixed --name vref >/dev/null 2>&1
	run_json list value ad7124_8 avdd-supply
	assert_success
	local label
	label=$(grep -o '[a-z0-9_]*: vref' "$WORKFILE" | cut -d: -f1)
	[ -n "$label" ] || fail "no label for the regulator in $(cat "$WORKFILE")"
	assert_json '.suggestions[0].value' "$label"
}

# Gap: list value gives the values the tree has, never the providers a user can add
# (regulator-fixed for a supply), which read gives as `can_create`.
# bats test_tags=req:LIST-08, gap
@test "list value says a new regulator can be added to fill a supply" {
	with_adc
	run_json list value ad7124_8 avdd-supply
	assert_success
	assert_json '[.can_create[].value] | join(" ")' regulator-fixed
}

# bats test_tags=req:LIST-08
@test "list value of a property with no values is no refusal" {
	with_adc
	run_json list value ad7124_8 no-such-property
	assert_success
	assert_json '.ok' true
	assert_json '.message' "No values for no-such-property"
	assert_json '.suggestions | length' 0
}

# --- list parent ---

# bats test_tags=req:LIST-09
@test "list parent lists the SPI buses, then the I2C buses, of the base" {
	run_json list parent adi,adxl345
	assert_success
	assert_json '.suggestions[0].value' spi
	assert_json '.suggestions[0].display_string' /soc/spi@7e204000
	assert_json '[.suggestions[].value] | index("i2c1") > index("spi6")' true
	run aa list parent adi,adxl345
	assert_line --index 0 "spi  /soc/spi@7e204000"
	assert_line "i2c1  /soc/i2c@7e804000"
}

# bats test_tags=req:LIST-09
@test "list parent of an SPI-only device lists only SPI buses" {
	run_json list parent adi,ad7124-8
	assert_success
	assert_json '[.suggestions[].display_string | test("/spi@")] | all' true
}

# bats test_tags=req:LIST-09
@test "list parent of a fixed regulator is the root" {
	run_json list parent regulator-fixed
	assert_success
	assert_json '[.suggestions[].value] | join(" ")' /
}

# bats test_tags=req:LIST-09
@test "list parent of a compatible no binding has says so" {
	run_json list parent adi,no-such-part
	assert_success
	assert_json '.message' "No binding found for adi,no-such-part"
	assert_json '.suggestions | length' 0
	run aa list parent adi,no-such-part
	assert_output "Failed to find binding for adi,no-such-part"
}

# --- list overlay ---

# bats test_tags=req:LIST-10
@test "list overlay lists the Linux tree's overlays that have the device, and their fit" {
	run_json list overlay adi,adxl345
	assert_success
	assert_json '.overlays[] | select(.name == "rpi-adxl345-overlay.dts") | .fit' compatible
	assert_json '.overlays[] | select(.name == "rpi-adxl345-overlay.dts") | .path' \
		"$LINUX_TREE/arch/arm/boot/dts/overlays/rpi-adxl345-overlay.dts"
	assert_json '.overlays[] | select(.name == "rpi-adxl345-overlay.dts") | .reason' \
		"family: brcm,bcm2835 → raspberrypi"
	run aa list overlay adi,adxl345
	assert_line --regexp '^rpi-adxl345-overlay\.dts +compatible \(family: brcm,bcm2835 → raspberrypi\)$'
}

# bats test_tags=req:LIST-10
@test "list overlay also lists the overlays of another compatible of the binding, after" {
	run_json list overlay adi,adxl345
	assert_success
	assert_json '.overlays[-1].name' rpi-adxl375-overlay.dts
	assert_json '.overlays[-1].matched' adi,adxl375
	assert_json '[.overlays[] | select(.name == "rpi-adxl345-overlay.dts") | has("matched")] | .[0]' false
	run aa list overlay adi,adxl345
	assert_line --regexp '^rpi-adxl375-overlay\.dts .*  via adi,adxl375$'
}

# bats test_tags=req:LIST-10
@test "list overlay puts the overlays that fit the board first" {
	run_json list overlay pwm-backlight
	assert_success
	assert_json '[.overlays[].fit] | unique | join(" ")' "compatible incompatible unknown"
	assert_json '[.overlays[].fit] == ([.overlays[].fit] | sort_by({compatible: 0, unknown: 1, incompatible: 2}[.]))' true
	assert_json '.overlays[] | select(.name == "pivision-overlay.dts") | .reason' \
		"overlay: brcm,bcm2712; base: raspberrypi,4-model-b, brcm,bcm2711"
}

# bats test_tags=req:LIST-10
@test "list overlay of a device no overlay has says so" {
	run_json list overlay adi,no-such-part
	assert_success
	assert_json '.overlays | length' 0
	run aa list overlay adi,no-such-part
	assert_output "No overlay in $LINUX_TREE has adi,no-such-part"
}

# --- kinds ---

# Gap: an unknown kind gives "No command registered for `nosuch`", naming no kind.
# bats test_tags=req:LIST-11-LNX, gap
@test "an unknown list kind is refused, naming parent and overlay among the kinds" {
	run aa list nosuch
	assert_failure 2
	assert_output --partial "Unknown kind: nosuch."
	assert_output --regexp 'The kinds: .*parent'
	assert_output --regexp 'The kinds: .*overlay'
}

# Gap: an unknown kind gives "No command registered for `nosuch`", naming no kind (and the
# linux backend has no context).
# bats test_tags=req:LIST-11, gap
@test "an unknown list kind is refused, naming devices, context, property and value" {
	run aa list nosuch
	assert_failure 2
	assert_output --partial "Unknown kind: nosuch."
	local kind
	for kind in devices context property value; do
		assert_output --regexp "The kinds: .*$kind"
	done
}

# bats test_tags=req:LIST-11
@test "a mistyped list kind names the closest one" {
	run aa list devics
	assert_failure 2
	assert_output --regexp '[Dd]id you mean `?devices`?\?'
}
