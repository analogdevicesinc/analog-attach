# read where the backend is linux: the overlay, a node of the base and the overlay together,
# a property.

# bats file_tags=eco:linux

# Every test starts from one overlay: an AD7124-8 on spi1 (label ad7124_8, node
# adi,ad7124-8@0) with an interrupt, a supply and one channel. The first test of the file makes
# it, the others copy it.
# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree, and the
# overlay described above: AD7124-8 ad7124_8 (adi,ad7124-8@0) on spi1, its interrupt-parent gpio,
# interrupts 25 IRQ_TYPE_EDGE_FALLING, avdd-supply vdd_3v3_reg, and channel@0.
setup() {
	load ../helpers
	new_project linux
	local made="$BATS_FILE_TMPDIR/overlay.dtso"
	if [ -f "$made" ]; then
		cp "$made" "$WORKFILE"
		return
	fi
	with_overlay
	aa add adi,ad7124-8 --parent spi1 >/dev/null 2>&1 || fail "add adi,ad7124-8 failed"
	aa update ad7124_8 interrupt-parent gpio >/dev/null || fail "update interrupt-parent failed"
	aa update ad7124_8 interrupts 25 IRQ_TYPE_EDGE_FALLING >/dev/null || fail "update interrupts failed"
	aa update ad7124_8 avdd-supply vdd_3v3_reg >/dev/null || fail "update avdd-supply failed"
	aa update ad7124_8 channel@0 >/dev/null 2>&1 || fail "update channel@0 failed"
	cp "$WORKFILE" "$made"
}

# Description: read with no arguments prints the overlay file exactly as it is saved.
# Steps:
#   1. Run read.
#   2. Check it succeeds and its output is the workfile's content.
# bats test_tags=req:READ-01, id:L0230
@test "read with no arguments writes the whole overlay as it is saved" {
	run aa read
	assert_success
	# The file's content, then the empty line that ends the output.
	assert_equal "$output" "$(cat "$WORKFILE")"
}

# Description: read --json with no arguments gives the overlay as a tree of nodes, with their
# labels, properties and children.
# Steps:
#   1. Run read, with --json.
#   2. Check it succeeds and gives the root node /, its one child adi,ad7124-8@0.
#   3. Check that child has the label ad7124_8, a property avdd-supply and the child channel@0.
# bats test_tags=req:READ-01, id:L0231
@test "read --json with no arguments gives the overlay's nodes with their children" {
	run_json read
	assert_success
	assert_json '.kind' node
	assert_json '.key' /
	assert_json '[.children[].key] | join(" ")' adi,ad7124-8@0
	assert_json '.children[0].alias | join(" ")' ad7124_8
	assert_json '[.children[0].properties[].key] | index("avdd-supply") != null' true
	assert_json '.children[0].children[0].key' channel@0
}

# Description: read of a node shows it with its properties, in JSON and as devicetree text.
# Steps:
#   1. Run read ad7124_8, with --json.
#   2. Check it succeeds and gives the node adi,ad7124-8@0 with its compatible, interrupts 25 2
#      and avdd-supply &vdd_3v3_reg.
#   3. Run read ad7124_8 and check it starts with the labelled node and has the interrupts and
#      avdd-supply lines.
# bats test_tags=req:READ-02, id:L0232
@test "read <node> shows the node with its properties" {
	run_json read ad7124_8
	assert_success
	assert_json '.kind' node
	assert_json '.key' adi,ad7124-8@0
	assert_json '.properties[] | select(.key == "compatible") | .value' adi,ad7124-8
	assert_json '.properties[] | select(.key == "interrupts") | .value | map(tostring) | join(" ")' "25 2"
	assert_json '.properties[] | select(.key == "avdd-supply") | .value' "&vdd_3v3_reg"
	run aa read ad7124_8
	assert_line --index 0 "ad7124_8: adi,ad7124-8@0 {"
	assert_line '    interrupts = <25 2>;'
	assert_line '    avdd-supply = <&vdd_3v3_reg>;'
}

# Description: read of a node lists the required properties it still lacks, and has no such
# line when it lacks none.
# Steps:
#   1. Add adi,adxl345 on i2c1.
#   2. Run read adxl345.
#   3. Check it succeeds and lists interrupt-parent and interrupts as missing required.
#   4. Run read ad7124_8 and check it lists nothing missing.
# bats test_tags=req:READ-02, id:L0233
@test "read <node> shows the required properties the node still lacks" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run aa read adxl345
	assert_success
	assert_line "Missing required: interrupt-parent, interrupts"
	# A node that lacks nothing has no such line.
	run aa read ad7124_8
	refute_output --partial "Missing required"
}

# Description: read of a node shows its child nodes with their properties.
# Steps:
#   1. Set diff-channels 0 1 on ad7124_8/channel@0.
#   2. Run read ad7124_8.
#   3. Check it succeeds and shows channel@0 with diff-channels = <0 1>.
#   4. Run read ad7124_8, with --json, and check the first child is channel@0 with diff-channels
#      0 1.
# bats test_tags=req:READ-02-LNX, id:L0234
@test "read <node> shows the node's children" {
	aa update ad7124_8/channel@0 diff-channels 0 1 >/dev/null
	run aa read ad7124_8
	assert_success
	assert_line '    channel@0 {'
	assert_line '        diff-channels = <0 1>;'
	run_json read ad7124_8
	assert_json '.children[0].key' channel@0
	assert_json '.children[0].properties[] | select(.key == "diff-channels") | .value | map(tostring) | join(" ")' "0 1"
}

# Description: read of a node the tree does not have is refused, and a property given as a path
# segment gets a hint to give it as a separate argument.
# Steps:
#   1. Run read no_such_node, with --json.
#   2. Check it is refused (exit 0, .ok false), the message saying it is not found.
#   3. Run read ad7124_8/reg.
#   4. Check the message says it is not found and the property is a separate argument.
# bats test_tags=req:READ-02, id:L0235
@test "read of a node the tree doesn't have is refused" {
	run_json read no_such_node
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: no_such_node"
	run aa read ad7124_8/reg
	assert_output "Not found: ad7124_8/reg (the property is a separate argument: <path> <property>)"
}

# Description: read of a property gives its value, type, description, whether it is required,
# its binding file and where it is set.
# Steps:
#   1. Run read ad7124_8 reg, with --json.
#   2. Check it succeeds: a property reg, value 0, type number, the binding's description,
#      required, from adi,ad7124.yaml, source overlay.
#   3. Run read ad7124_8 reg and check the first line is reg = <0>; and the second the
#      description with the binding file.
# bats test_tags=req:READ-03, id:L0236
@test "read <node> <property> gives value, purpose, binding and who set it" {
	run_json read ad7124_8 reg
	assert_success
	assert_json '.kind' property
	assert_json '.key' reg
	assert_json '.value' 0
	assert_json '.type.kind' number
	assert_json '.description' "SPI chip select number for the device"
	assert_json '.required' true
	assert_json '.definition' adi,ad7124.yaml
	assert_json '.source' overlay
	run aa read ad7124_8 reg
	assert_line --index 0 "reg = <0>;"
	assert_line --index 1 "  SPI chip select number for the device   (adi,ad7124.yaml)"
}

# Description: read of a property gives the values its binding allows and its default.
# Steps:
#   1. Add adi,ad4130 on spi0, its channel@0, and set adi,reference-select 1 on that channel.
#   2. Run read ad4130/channel@0 adi,reference-select, with --json.
#   3. Check it succeeds with value 1, default 0, from adi,ad4130.yaml.
#   4. Run the same read as text and check it shows Allowed: 0 | 1 | 2 | 3 and Default: 0.
# bats test_tags=req:READ-03, id:L0237
@test "read <node> <property> gives the allowed values and the default" {
	aa add adi,ad4130 --parent spi0 >/dev/null 2>&1
	aa update ad4130 channel@0 >/dev/null 2>&1
	aa update ad4130/channel@0 adi,reference-select 1 >/dev/null
	run_json read ad4130/channel@0 adi,reference-select
	assert_success
	assert_json '.value' 1
	assert_json '.constraints.default' 0
	assert_json '.definition' adi,ad4130.yaml
	run aa read ad4130/channel@0 adi,reference-select
	assert_line "  Allowed: 0 | 1 | 2 | 3"
	assert_line "  Default: 0"
}

# Gap: in JSON the type is the one the value is written as (a number), not the binding's (an
# enum of 0, 1, 3), and the options aren't given; only the text has them (`Allowed:`).
# Description: read --json of a property gives the binding's type, an enum, and its options.
# Steps:
#   1. Set adi,reference-select 3 on ad7124_8/channel@0.
#   2. Run read ad7124_8/channel@0 adi,reference-select, with --json.
#   3. Check it succeeds with type kind enum and the options 0, 1 and 3.
# bats test_tags=req:READ-03, gap, id:L0238
@test "read --json <node> <property> gives the binding's type and its allowed values" {
	aa update ad7124_8/channel@0 adi,reference-select 3 >/dev/null
	run_json read ad7124_8/channel@0 adi,reference-select
	assert_success
	assert_json '.type.kind' enum
	assert_json '[.type.options[].value | tostring] | join(" ")' "0 1 3"
}

# Description: read of a property the node does not have is refused.
# Steps:
#   1. Run read ad7124_8 refin1-supply, with --json.
#   2. Check it is refused (exit 0, .ok false), the message saying refin1-supply is not found on
#      ad7124_8.
# bats test_tags=req:READ-03, id:L0239
@test "read <node> <property> of a property the node lacks is refused" {
	run_json read ad7124_8 refin1-supply
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: refin1-supply on ad7124_8"
}

# Description: read of a property gives the values it could take and the device types that can
# be added to give one.
# Steps:
#   1. Run read ad7124_8 avdd-supply, with --json.
#   2. Check it succeeds, the suggested values include vdd_3v3_reg and regulator-fixed can be
#      created.
#   3. Run the same read as text.
#   4. Check it shows the suggestions, vdd_3v3_reg described as the 3.3 V regulator, and the add
#      regulator-fixed command.
# bats test_tags=req:READ-04, id:L0240
@test "read <node> <property> gives the suggested values and what can be added" {
	run_json read ad7124_8 avdd-supply
	assert_success
	assert_json '[.suggestions.values[].value] | index("vdd_3v3_reg") != null' true
	assert_json '[.suggestions.can_create[].value] | join(" ")' regulator-fixed
	run aa read ad7124_8 avdd-supply
	assert_line "  Suggestions:"
	assert_line --regexp '^    vdd_3v3_reg — regulator "3v3", 3\.3 V'
	assert_line "  Or add your own: analog-attach add regulator-fixed"
}

# Description: read of a property with nothing to suggest gives empty suggestions, and the text
# has no suggestion lines.
# Steps:
#   1. Run read ad7124_8 interrupts, with --json.
#   2. Check it succeeds with no suggested values and nothing to create.
#   3. Run the same read as text and check it has no suggestions and no add hint.
# bats test_tags=req:READ-04, id:L0241
@test "read <node> <property> gives empty suggestions when there are none" {
	run_json read ad7124_8 interrupts
	assert_success
	assert_json '.suggestions.values // [] | length' 0
	assert_json '.suggestions.can_create // [] | length' 0
	run aa read ad7124_8 interrupts
	refute_output --partial "Suggestions"
	refute_output --partial "Or add your own"
}

# Description: read --quiet of a property prints its value alone, and in JSON leaves out the
# description, suggestions and required.
# Steps:
#   1. Run read --quiet ad7124_8 avdd-supply.
#   2. Check it succeeds and prints only avdd-supply = <&vdd_3v3_reg>;.
#   3. Run the same read with --json.
#   4. Check it has no description, suggestions or required, and the value &vdd_3v3_reg.
# bats test_tags=req:READ-05, id:L0242
@test "read --quiet <node> <property> prints the value alone" {
	run aa read --quiet ad7124_8 avdd-supply
	assert_success
	assert_output "avdd-supply = <&vdd_3v3_reg>;"
	run_json read --quiet ad7124_8 avdd-supply
	assert_json 'has("description") or has("suggestions") or has("required")' false
	assert_json '.value' "&vdd_3v3_reg"
}

# Description: read --quiet of a flag property prints true.
# Steps:
#   1. Set the flag spi-cpha on ad7124_8.
#   2. Run read --quiet ad7124_8 spi-cpha.
#   3. Check it succeeds and prints only true.
# bats test_tags=req:READ-05, id:L0243
@test "read --quiet of a flag prints true" {
	aa update ad7124_8 spi-cpha >/dev/null
	run aa read --quiet ad7124_8 spi-cpha
	assert_success
	assert_output "true"
}

# Description: read --quiet of a node shows the node without the missing required properties
# line.
# Steps:
#   1. Add adi,adxl345 on i2c1.
#   2. Run read --quiet adxl345.
#   3. Check it succeeds, has no missing required line, and shows the node's compatible.
# bats test_tags=req:READ-05, id:L0244
@test "read --quiet <node> leaves out the missing required properties" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run aa read --quiet adxl345
	assert_success
	refute_output --partial "Missing required"
	assert_line '    compatible = "adi,adxl345";'
}

# Description: read of a base node shows it with what the overlay adds, the base's properties
# marked as base and the overlay's child shown in full without the mark.
# Steps:
#   1. Run read spi1.
#   2. Check it succeeds and starts with spi1: spi@7e215080 {.
#   3. Check its compatible line ends with a // base mark.
#   4. Check the overlay's AD7124-8 node and its compatible are shown, unmarked.
# bats test_tags=req:READ-06, id:L0245
@test "read of a base node shows it with what the overlay adds, base values marked" {
	run aa read spi1
	assert_success
	assert_line --index 0 --regexp '^spi1: spi@7e215080 \{$'
	assert_line --regexp '^    compatible = "brcm,bcm2835-aux-spi";   // base$'
	# The overlay's child is read in full, without the mark.
	assert_line '    ad7124_8: adi,ad7124-8@0 {'
	assert_line '        compatible = "adi,ad7124-8";'
}

# Description: read --json gives each property's source, base or overlay, and the text marks only
# the base values.
# Steps:
#   1. Run enable spi1.
#   2. Run read spi1, with --json.
#   3. Check it succeeds, compatible comes from base, and status okay from overlay.
#   4. Run read spi1 status and check its status line has no base mark.
#   5. Run read spi0 status and check it is disabled, marked base.
# bats test_tags=req:READ-06, id:L0246
@test "read --json gives each property's source, base or overlay" {
	aa enable spi1 >/dev/null
	run_json read spi1
	assert_success
	assert_json '.properties[] | select(.key == "compatible") | .source' base
	assert_json '.properties[] | select(.key == "status") | .source' overlay
	assert_json '.properties[] | select(.key == "status") | .value' okay
	run aa read spi1 status
	assert_line --index 0 'status = "okay";'
	run aa read spi0 status
	assert_line --index 0 'status = "disabled";   // base'
}

# Description: read of a base node collapses the base child nodes the overlay does not touch to
# one line, marked base.
# Steps:
#   1. Run read spi0.
#   2. Check it succeeds and shows spidev0: spidev@0 collapsed on one line, marked base.
#   3. Run read spi0, with --json, and check spidev@0 has origin base and no properties.
# bats test_tags=req:READ-06, id:L0247
@test "read of a base node collapses the base children the overlay doesn't reach" {
	run aa read spi0
	assert_success
	assert_line '    spidev0: spidev@0 { … };   // base'
	run_json read spi0
	assert_json '.children[] | select(.key == "spidev@0") | .origin' base
	assert_json '.children[] | select(.key == "spidev@0") | .properties | length' 0
}

# Description: read --quiet of a base node keeps the base marks, while read --quiet of one
# property prints it without the mark.
# Steps:
#   1. Run read --quiet spi0 and check its compatible line is marked base.
#   2. Run read --quiet spi0 compatible and check it prints only the compatible line, unmarked.
# bats test_tags=req:READ-06, id:L0248
@test "read --quiet keeps the base marks of a node, and drops that of a property" {
	run aa read --quiet spi0
	assert_line --regexp '^    compatible = "brcm,bcm2835-spi";   // base$'
	run aa read --quiet spi0 compatible
	assert_output 'compatible = "brcm,bcm2835-spi";'
}

# Description: read --json lists a node's labels, its other names.
# Steps:
#   1. Run read spi0, with --json, and check it succeeds with the labels spi0 and spi.
#   2. Run read ad7124_8, with --json, and check its labels are ad7124_8 and its channel has none.
# bats test_tags=req:READ-07, id:L0249
@test "read --json lists a node's other names, its labels" {
	run_json read spi0
	assert_success
	assert_json '.alias | join(" ")' "spi0 spi"
	run_json read ad7124_8
	assert_json '.alias | join(" ")' ad7124_8
	assert_json '.children[0].alias | length' 0
}

# Gap: `origin` is `overlay`, `base` or `both` (a base node the overlay changes), not `internal`
# or `external` as in noos.
# Description: read --json gives a node of the overlay the origin internal and a node of the base
# the origin external.
# Steps:
#   1. Run read ad7124_8, with --json, and check .origin is internal.
#   2. Run read spi0, with --json, and check .origin is external.
# bats test_tags=req:READ-07, gap, id:L0250
@test "read --json says a node of the overlay is internal and one of the base external" {
	run_json read ad7124_8
	assert_json '.origin' internal
	run_json read spi0
	assert_json '.origin' external
}
