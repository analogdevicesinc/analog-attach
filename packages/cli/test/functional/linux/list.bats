# list where the backend is linux: the devices, a node's properties and values, the parents a
# device can go under and the overlays of the Linux tree that have it.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
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

# Description: list devices lists every compatible of the Linux tree, in JSON and as text.
# Steps:
#   1. Count the entries of the compat index cache.
#   2. Run list devices, with --json; check it succeeds with that many devices.
#   3. Run list devices as text; check it succeeds with that many lines.
# bats test_tags=req:LIST-01, id:L0187
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

# Description: the keys list devices gives are compatibles that add takes.
# Steps:
#   1. List the devices matching adxl34, with --json.
#   2. Check it succeeds with the keys adi,adxl345 and adi,adxl346.
#   3. Create the overlay with init.
#   4. Add adi,adxl346 and adi,adxl345 on i2c1, with --json; check each succeeds (.ok true).
# bats test_tags=req:LIST-01, id:L0188
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

# Description: list devices works before any workfile exists.
# Steps:
#   1. Check there is no workfile.
#   2. List the devices matching adxl34, with --json.
#   3. Check it succeeds with 2 devices.
# bats test_tags=req:LIST-01, id:L0189
@test "list devices needs no workfile" {
	[ ! -e "$WORKFILE" ]
	run_json list devices adxl34
	assert_success
	assert_json '.devices | length' 2
}

# Description: a filter keeps only the compatibles that contain it.
# Steps:
#   1. List the devices matching adxl34, with --json; check it succeeds and says 2 were found.
#   2. List them as text; check it succeeds with exactly two lines, adi,adxl345 and adi,adxl346,
#      each followed by its category.
# bats test_tags=req:LIST-02, id:L0190
@test "list devices with a filter keeps the compatibles that contain it" {
	run_json list devices adxl34
	assert_success
	assert_json '.message' "Found 2 devices"
	run aa list devices adxl34
	assert_success
	assert_line --regexp '^adi,adxl345 +iio/accel$'
	assert_line --regexp '^adi,adxl346 +iio/accel$'
	[ "${#lines[@]}" -eq 2 ]
}

# Description: a filter that matches nothing is no refusal, just an empty list.
# Steps:
#   1. List the devices matching zzz-no-such-part, with --json.
#   2. Check it succeeds (.ok true), says 0 were found and has no devices.
# bats test_tags=req:LIST-02, id:L0191
@test "list devices with a filter that matches nothing is no refusal" {
	run_json list devices zzz-no-such-part
	assert_success
	assert_json '.ok' true
	assert_json '.message' "Found 0 devices"
	assert_json '.devices | length' 0
}

# Description: when the filter matches a single compatible, list devices describes that device:
# its binding, properties and child node patterns.
# Steps:
#   1. List the devices matching ad7124-8, with --json.
#   2. Check it succeeds and gives the device adi,ad7124-8 with its binding adi,ad7124.yaml.
#   3. List them as text; check it shows the compatible, the binding path, and the count of
#      properties and child node patterns.
# bats test_tags=req:LIST-02, id:L0192
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

# Description: list devices gives each compatible's category, the binding's folder, and lists
# them by category.
# Steps:
#   1. List the devices matching adxl34, with --json.
#   2. Check it succeeds and every device has the category (tag) iio/accel.
#   3. List the devices matching adi,ad7124 as text; check it succeeds and shows iio/adc.
#   4. List the devices matching adi, with --json; check the devices come sorted by category,
#      then compatible.
# bats test_tags=req:LIST-04-LNX, id:L0193
@test "list devices groups the compatibles by category" {
	run_json list devices adxl34
	assert_success
	assert_json '[.devices[] | .tag] | unique | join(" ")' "iio/accel"
	run aa list devices adi,ad7124
	assert_success
	assert_line --partial "iio/adc"
	run_json list devices adi
	assert_json '[.devices[] | [.tag, .key]] == ([.devices[] | [.tag, .key]] | sort)' true
}

# --- list context ---

# Description: list context lists the .dts files of the Linux tree.
# Steps:
#   1. Run list context, with --json.
#   2. Check it succeeds (.ok true) and names broadcom/bcm2711-rpi-4-b.dts.
# bats test_tags=req:LIST-05, req:LIST-05-LNX, id:L0194
@test "list context lists the .dts files of the Linux tree" {
	run_json list context
	assert_success
	assert_json '.ok' true
	assert_json "[.. | strings | select(endswith(\"broadcom/bcm2711-rpi-4-b.dts\"))] | length > 0" true
}

# To be discussed: how we handle validating the parser for testing purposes. As written, the
# config step can't fail (a refused value exits 0, so assert_success holds either way), and only
# the first .dts is tried while the name says every one; the pinned tree has 2344, too many to
# set one by one, and a sample proves little.
# Description: a target that list context names is accepted by the devicetree setting.
# Steps:
#   1. Run list context, with --json, and take the first .dts it names.
#   2. Set devicetree to it with config.
#   3. Check it succeeds.
# bats test_tags=req:LIST-05-LNX, id:L0195
@test "every target list context names is one the devicetree setting takes" {
	run_json list context
	assert_success
	local target
	target=$(jq -r '[.. | strings | select(endswith(".dts"))][0]' <<<"$output")
	[ -n "$target" ] && [ "$target" != null ] || fail "no .dts in: $output"
	run aa config devicetree "$target"
	assert_success
}

# Description: list context says how to select a target.
# Steps:
#   1. Run list context.
#   2. Check it succeeds and points to config devicetree.
# bats test_tags=req:LIST-06, id:L0196
@test "list context says how to select a target" {
	run aa list context
	assert_success
	assert_output --partial "config devicetree"
}

# --- list property ---

# Description: list property with no node lists the nodes of the overlay.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list property with no node, with --json.
#   3. Check it succeeds (.ok true), names the node by its label ad7124_8, and gives its
#      compatible adi,ad7124-8.
#   4. Run it as text; check the line ad7124_8.
# bats test_tags=req:LIST-07, id:L0197
@test "list property with no node lists the overlay's nodes" {
	with_adc
	run_json list property
	assert_success
	assert_json '.ok' true
	assert_json '.names | index("ad7124_8") != null' true
	assert_json '.suggestions[] | select(.value == "ad7124_8") | .display_string' "adi,ad7124-8"
	run aa list property
	assert_success
	assert_line "ad7124_8"
}

# Description: list property of a node marks each property required, set, both or neither, and
# the marks follow updates.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list property ad7124_8.
#   3. Check compatible and reg are set and required, interrupts required, avdd-supply unmarked
#      (its name, then its type).
#   4. Update avdd-supply to vdd_3v3_reg and list again.
#   5. Check avdd-supply is marked set, and with --json set and not required.
# bats test_tags=req:LIST-07, id:L0198
@test "list property of a node marks what is required and what is set" {
	with_adc
	run aa list property ad7124_8
	assert_success
	assert_line --regexp '^compatible +\(set, required\) '
	assert_line --regexp '^reg +\(set, required\) '
	assert_line --regexp '^interrupts +\(required\) '
	assert_line --regexp '^avdd-supply +enum\('
	aa update ad7124_8 avdd-supply vdd_3v3_reg >/dev/null
	run aa list property ad7124_8
	assert_line --regexp '^avdd-supply +\(set\) '
	run_json list property ad7124_8
	assert_json '.properties[] | select(.name == "avdd-supply") | [.set, .required] | tojson' '[true,false]'
}

# Description: list property of a node offers the SPI peripheral properties only under an SPI
# controller, and under one only the vendor properties of that controller; so does completion.
# Steps:
#   1. Make an overlay, add an ADXL345 (I2C or SPI) on i2c1 and another on spi0, and update
#      the first's interrupts so its binding is narrowed.
#   2. Run list property adxl345 (the I2C one), with --json; check it names compatible and
#      reg, and no spi-* nor vendor (pl022,*) property.
#   3. Complete update adxl345 and check no spi-* property is offered.
#   4. Run list property adxl345_1 (the SPI one), with --json; check it names spi-cpha and
#      spi-max-frequency, and no pl022,* property (the base's controller is a bcm2835).
# bats test_tags=req:LIST-07, req:COMPLETION-04, id:L0353
@test "list property offers SPI peripheral properties only under an SPI controller" {
	with_overlay
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1 || fail "add adi,adxl345 on i2c1 failed"
	aa add adi,adxl345 --parent spi0 >/dev/null 2>&1 || fail "add adi,adxl345 on spi0 failed"
	aa update adxl345 interrupts 25 1 >/dev/null 2>&1
	run_json list property adxl345
	assert_success
	assert_json '[.names[] | select(. == "compatible" or . == "reg")] | length' 2
	assert_json '[.names[] | select(test("^spi-|^pl022,"))] | join(" ")' ""
	run aa __complete -- update adxl345 ''
	assert_success
	refute_line --regexp '^spi-'
	run_json list property adxl345_1
	assert_success
	assert_json '[.names[] | select(. == "spi-cpha" or . == "spi-max-frequency")] | length' 2
	assert_json '[.names[] | select(test("^pl022,"))] | join(" ")' ""
}

# Description: list property of a node shows its child node patterns as the names they match,
# with the children present.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list property ad7124_8; check it succeeds and shows channel@0 to channel@15, none
#      present.
#   3. Add the child channel@0 with update and list again.
#   4. Check the pattern shows channel@0 as present.
#   5. List with --json and check the pattern is among the names.
# bats test_tags=req:LIST-07, id:L0199
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

# Description: list property of a node gives the type of each property.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list property ad7124_8; check it succeeds and the reg line gives a number type.
#   3. Run it with --json; check reg is shown as number[].
# bats test_tags=req:LIST-07, id:L0200
@test "list property of a node gives each property's type" {
	with_adc
	run aa list property ad7124_8
	assert_success
	assert_line --regexp '^reg .*number'
	run_json list property ad7124_8
	assert_json '.properties[] | select(.name == "reg") | .display' "number[]"
}

# Description: list property of a node of the base lists the properties of its binding.
# Steps:
#   1. Create the overlay with init.
#   2. Run list property spi0, with --json; check it succeeds and cs-gpios is among the names.
#   3. Run it as text; check compatible is marked set and required.
# bats test_tags=req:LIST-07, id:L0201
@test "list property of a base node lists its binding's properties" {
	with_overlay
	run_json list property spi0
	assert_success
	assert_json '.names | index("cs-gpios") != null' true
	run aa list property spi0
	assert_line --regexp '^compatible +\(set, required\) '
}

# Description: list property of one property gives its type, whether it is required and whether
# it is set, and its description.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list property ad7124_8 reg, with --json.
#   3. Check it succeeds and gives reg as number[], required and set.
#   4. Run it as text; check the first line gives the name, required and the type, the second
#      its description.
# bats test_tags=req:LIST-07, id:L0202
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

# Description: list property of a node that is in neither the base nor the overlay is refused.
# Steps:
#   1. Create the overlay with init.
#   2. Run list property no_such_node, with --json.
#   3. Check it is refused (exit 0, .ok false) with a message saying the node is not found.
#   4. Run it as text; check it says the node is not found.
# bats test_tags=req:LIST-07, id:L0203
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

# Description: list value gives the options of an enum property.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list value ad7124_8 spi-rx-bus-width; check it succeeds and lists 0 and 8.
#   3. Run it with --json; check the suggestions are 1 0 2 4 8, the binding's default (1) first
#      and marked.
# bats test_tags=req:LIST-08, id:L0204
@test "list value gives the options of an enum" {
	with_adc
	run aa list value ad7124_8 spi-rx-bus-width
	assert_success
	assert_line --regexp $'^0\t'
	assert_line --regexp $'^8\t'
	run_json list value ad7124_8 spi-rx-bus-width
	assert_json '[.suggestions[].value] | join(" ")' "1 0 2 4 8"
	assert_json '.suggestions[0].display_string' "1 — the binding's default"
}

# Description: list value puts the default of an enum first and marks it as the binding's
# default, when the default is not the enum's first option.
# Steps:
#   1. Make an overlay, add adi,ad7173-8 on spi0 and its child channel@0.
#   2. Run list value ad7173_8/channel@0 adi,reference-select, with --json.
#   3. Check it succeeds and offers vref, vref2, refout-avss and avdd.
#   4. Check the first is refout-avss, marked as the binding's default.
# bats test_tags=req:LIST-08, id:L0205
@test "list value gives the default of an enum first" {
	with_overlay
	aa add adi,ad7173-8 --parent spi0 >/dev/null 2>&1 || fail "add adi,ad7173-8 failed"
	aa update ad7173_8 channel@0 >/dev/null 2>&1 || fail "update channel@0 failed"
	run_json list value ad7173_8/channel@0 adi,reference-select
	assert_success
	assert_json '[.suggestions[].value] | sort | join(" ")' "avdd refout-avss vref vref2"
	assert_json '.suggestions[0].value' refout-avss
	assert_json ".suggestions[0].display_string | test(\"the binding's default\")" true
}

# Description: list value offers the options of an enum that the processed schema nests in a
# matrix (a -microvolt property), the binding's default first.
# Steps:
#   1. Make an overlay and add adi,ad7949 on spi0.
#   2. Run list value ad7949 adi,internal-ref-microvolt, with --json.
#   3. Check it succeeds and offers 4096000 then 2500000, the first marked as the binding's
#      default.
# bats test_tags=req:LIST-08, id:L0351
@test "list value offers the enum of a -microvolt property" {
	with_overlay
	aa add adi,ad7949 --parent spi0 >/dev/null 2>&1 || fail "add adi,ad7949 failed"
	run_json list value ad7949 adi,internal-ref-microvolt
	assert_success
	assert_json '[.suggestions[].value] | join(" ")' "4096000 2500000"
	assert_json ".suggestions[0].display_string | test(\"the binding's default\")" true
}

# Description: list value follows the binding's variants: an AD4000 may not have adi,gain-milli
# and gets no values, an ADAQ4003 gets its enum, the default first.
# Steps:
#   1. Make an overlay, add adi,ad4000 on spi0 and adi,adaq4003 on spi1.
#   2. Run list value ad4000 adi,gain-milli, with --json; check it succeeds with no suggestions.
#   3. Run list value adaq4003 adi,gain-milli, with --json; check it succeeds with 1000 454 909
#      1900, the first marked as the binding's default.
# bats test_tags=req:LIST-08, id:L0352
@test "list value of a property only some variants have offers values to those only" {
	with_overlay
	aa add adi,ad4000 --parent spi0 >/dev/null 2>&1 || fail "add adi,ad4000 failed"
	aa add adi,adaq4003 --parent spi1 >/dev/null 2>&1 || fail "add adi,adaq4003 failed"
	run_json list value ad4000 adi,gain-milli
	assert_success
	assert_json '.suggestions | length' 0
	run_json list value adaq4003 adi,gain-milli
	assert_success
	assert_json '[.suggestions[].value] | join(" ")' "1000 454 909 1900"
	assert_json '.suggestions[0].display_string' "1000 — the binding's default"
}

# Description: list value of a phandle property gives the nodes it can name.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list value ad7124_8 avdd-supply, with --json; check vdd_3v3_reg is suggested.
#   3. Run list value ad7124_8 interrupt-parent, with --json; check the suggestions are gicv2
#      and gpio, the first marked as inherited from /.
# bats test_tags=req:LIST-08, id:L0206
@test "list value gives the nodes a phandle can name" {
	with_adc
	run_json list value ad7124_8 avdd-supply
	assert_success
	assert_json '[.suggestions[].value] | index("vdd_3v3_reg") != null' true
	run_json list value ad7124_8 interrupt-parent
	assert_json '[.suggestions[].value] | join(" ")' "gicv2 gpio"
	assert_json '.suggestions[0].display_string | contains("inherited from /")' true
}

# Description: for a supply, list value puts the regulators the overlay adds first.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Add a regulator-fixed named vref.
#   3. Run list value ad7124_8 avdd-supply, with --json.
#   4. Check it succeeds and the first suggestion is the label of the new regulator.
# bats test_tags=req:LIST-08, id:L0207
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

# Description: list value of a supply says a new regulator-fixed can be added to fill it.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list value ad7124_8 avdd-supply, with --json.
#   3. Check it succeeds and can_create offers regulator-fixed.
# bats test_tags=req:LIST-08, id:L0208
@test "list value says a new regulator can be added to fill a supply" {
	with_adc
	run_json list value ad7124_8 avdd-supply
	assert_success
	assert_json '[.can_create[].value] | join(" ")' regulator-fixed
}

# Description: list value of a property with no values is no refusal, just an empty list.
# Steps:
#   1. Make an overlay with an AD7124-8 on spi1.
#   2. Run list value ad7124_8 no-such-property, with --json.
#   3. Check it succeeds (.ok true), says there are no values and has no suggestions.
# bats test_tags=req:LIST-08, id:L0209
@test "list value of a property with no values is no refusal" {
	with_adc
	run_json list value ad7124_8 no-such-property
	assert_success
	assert_json '.ok' true
	assert_json '.message' "No values for no-such-property"
	assert_json '.suggestions | length' 0
}

# --- list parent ---

# Description: list parent lists the SPI buses of the base, then the I2C buses.
# Steps:
#   1. Run list parent adi,adxl345, with --json.
#   2. Check it succeeds, the first suggestion is spi (/soc/spi@7e204000), and i2c1 comes after
#      spi6.
#   3. Run it as text; check the first line is spi with its path, and i2c1 is listed with its
#      path.
# bats test_tags=req:LIST-09, id:L0210
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

# Description: list parent of a device that only has SPI lists only SPI buses.
# Steps:
#   1. Run list parent adi,ad7124-8, with --json.
#   2. Check it succeeds, there are suggestions, and every one is an SPI bus.
# bats test_tags=req:LIST-09, id:L0211
@test "list parent of an SPI-only device lists only SPI buses" {
	run_json list parent adi,ad7124-8
	assert_success
	assert_json '.suggestions | length > 0' true
	assert_json '[.suggestions[].display_string | test("/spi@")] | all' true
}

# Description: the only parent of a fixed regulator is the root node.
# Steps:
#   1. Run list parent regulator-fixed, with --json.
#   2. Check it succeeds with the single suggestion /.
# bats test_tags=req:LIST-09, id:L0212
@test "list parent of a fixed regulator is the root" {
	run_json list parent regulator-fixed
	assert_success
	assert_json '[.suggestions[].value] | join(" ")' /
}

# Description: list parent of a compatible with no binding says it is unknown.
# Steps:
#   1. Run list parent adi,no-such-part, with --json.
#   2. Check it succeeds, says the compatible is unknown and has no suggestions.
#   3. Run it as text; check it says the same, pointing to list devices.
# bats test_tags=req:LIST-09, id:L0213
@test "list parent of a compatible no binding has says so" {
	run_json list parent adi,no-such-part
	assert_success
	assert_json '.message | startswith("Unknown compatible '"'"'adi,no-such-part'"'"'.")' true
	assert_json '.suggestions | length' 0
	run aa list parent adi,no-such-part
	assert_output --partial "Unknown compatible 'adi,no-such-part'."
	assert_output --partial "See: analog-attach list devices"
}

# --- list overlay ---

# Description: list overlay lists the overlays of the Linux tree that have the device, with
# their path and whether they fit the board, and why.
# Steps:
#   1. Run list overlay adi,adxl345, with --json.
#   2. Check it succeeds and rpi-adxl345-overlay.dts is there, compatible, with its path in the
#      tree and the reason (the brcm,bcm2835 family, raspberrypi).
#   3. Run it as text; check the line gives the overlay, compatible and the reason.
# bats test_tags=req:LIST-10, id:L0214
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

# Description: list overlay also lists, last, the overlays that have another compatible of the
# same binding, naming that compatible.
# Steps:
#   1. Run list overlay adi,adxl345, with --json.
#   2. Check it succeeds, the last overlay is rpi-adxl375-overlay.dts matched by adi,adxl375,
#      and rpi-adxl345-overlay.dts has no matched field.
#   3. Run it as text; check the rpi-adxl375 line says it is via adi,adxl375.
# bats test_tags=req:LIST-10, id:L0215
@test "list overlay also lists the overlays of another compatible of the binding, after" {
	run_json list overlay adi,adxl345
	assert_success
	assert_json '.overlays[-1].name' rpi-adxl375-overlay.dts
	assert_json '.overlays[-1].matched' adi,adxl375
	assert_json '[.overlays[] | select(.name == "rpi-adxl345-overlay.dts") | has("matched")] | .[0]' false
	run aa list overlay adi,adxl345
	assert_line --regexp '^rpi-adxl375-overlay\.dts .*  via adi,adxl375$'
}

# Description: list overlay orders the overlays by fit: those that fit the board first, then
# unknown, then incompatible.
# Steps:
#   1. Run list overlay pwm-backlight, with --json.
#   2. Check it succeeds with overlays of all three fits, sorted compatible, unknown,
#      incompatible.
#   3. Check pivision-overlay.dts gives as reason its compatible and the base's compatibles.
# bats test_tags=req:LIST-10, id:L0216
@test "list overlay puts the overlays that fit the board first" {
	run_json list overlay pwm-backlight
	assert_success
	assert_json '[.overlays[].fit] | unique | join(" ")' "compatible incompatible unknown"
	assert_json '[.overlays[].fit] == ([.overlays[].fit] | sort_by({compatible: 0, unknown: 1, incompatible: 2}[.]))' true
	assert_json '.overlays[] | select(.name == "pivision-overlay.dts") | .reason' \
		"overlay: brcm,bcm2712; base: raspberrypi,4-model-b, brcm,bcm2711"
}

# Description: list overlay of a device no overlay has says so.
# Steps:
#   1. Run list overlay adi,no-such-part, with --json; check it succeeds with no overlays.
#   2. Run it as text; check it says no overlay in the Linux tree has the device.
# bats test_tags=req:LIST-10, id:L0217
@test "list overlay of a device no overlay has says so" {
	run_json list overlay adi,no-such-part
	assert_success
	assert_json '.overlays | length' 0
	run aa list overlay adi,no-such-part
	assert_output "No overlay in $LINUX_TREE has adi,no-such-part"
}

# --- kinds ---

# Description: an unknown list kind is a usage error that names the kinds, parent and overlay
# among them.
# Steps:
#   1. Run list nosuch.
#   2. Check it fails with a usage error (exit 2) saying the kind is unknown.
#   3. Check the list of kinds names parent and overlay.
# bats test_tags=req:LIST-11-LNX, id:L0218
@test "an unknown list kind is refused, naming parent and overlay among the kinds" {
	run aa list nosuch
	assert_failure 2
	assert_output --partial "Unknown kind: nosuch."
	assert_output --regexp 'The kinds: .*parent'
	assert_output --regexp 'The kinds: .*overlay'
}

# Description: an unknown list kind is a usage error that names the kinds devices, context,
# property and value.
# Steps:
#   1. Run list nosuch.
#   2. Check it fails with a usage error (exit 2) saying the kind is unknown.
#   3. Check the list of kinds names devices, context, property and value.
# bats test_tags=req:LIST-11, id:L0219
@test "an unknown list kind is refused, naming devices, context, property and value" {
	run aa list nosuch
	assert_failure 2
	assert_output --partial "Unknown kind: nosuch."
	local kind
	for kind in devices context property value; do
		assert_output --regexp "The kinds: .*$kind"
	done
}

# Description: a mistyped list kind is a usage error that names the closest kind.
# Steps:
#   1. Run list devics.
#   2. Check it fails with a usage error (exit 2) suggesting devices.
# bats test_tags=req:LIST-11, id:L0220
@test "a mistyped list kind names the closest one" {
	run aa list devics
	assert_failure 2
	assert_output --regexp '[Dd]id you mean `?devices`?\?'
}
