# read where the backend is linux: the overlay, a node of the base and the overlay together,
# a property.

# bats file_tags=eco:linux

# Every test starts from one overlay: an AD7124-8 on spi1 (label ad7124_8, node
# adi,ad7124-8@0) with an interrupt, a supply and one channel. The first test of the file makes
# it, the others copy it.
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

# bats test_tags=req:READ-01
@test "read with no arguments writes the whole overlay as it is saved" {
	run aa read
	assert_success
	# The file's content, then the empty line that ends the output.
	assert_equal "$output" "$(cat "$WORKFILE")"
}

# bats test_tags=req:READ-01
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

# bats test_tags=req:READ-02
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

# bats test_tags=req:READ-02
@test "read <node> shows the required properties the node still lacks" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run aa read adxl345
	assert_success
	assert_line "Missing required: interrupt-parent, interrupts"
	# A node that lacks nothing has no such line.
	run aa read ad7124_8
	refute_output --partial "Missing required"
}

# bats test_tags=req:READ-02-LNX
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

# bats test_tags=req:READ-02
@test "read of a node the tree doesn't have is refused" {
	run_json read no_such_node
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: no_such_node"
	run aa read ad7124_8/reg
	assert_output "Not found: ad7124_8/reg (the property is a separate argument: <path> <property>)"
}

# bats test_tags=req:READ-03
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

# bats test_tags=req:READ-03
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
# bats test_tags=req:READ-03, gap
@test "read --json <node> <property> gives the binding's type and its allowed values" {
	aa update ad7124_8/channel@0 adi,reference-select 3 >/dev/null
	run_json read ad7124_8/channel@0 adi,reference-select
	assert_success
	assert_json '.type.kind' enum
	assert_json '[.type.options[].value | tostring] | join(" ")' "0 1 3"
}

# bats test_tags=req:READ-03
@test "read <node> <property> of a property the node lacks is refused" {
	run_json read ad7124_8 refin1-supply
	assert_success
	assert_json '.ok' false
	assert_json '.message' "Not found: refin1-supply on ad7124_8"
}

# bats test_tags=req:READ-04
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

# bats test_tags=req:READ-04
@test "read <node> <property> gives empty suggestions when there are none" {
	run_json read ad7124_8 interrupts
	assert_success
	assert_json '.suggestions.values // [] | length' 0
	assert_json '.suggestions.can_create // [] | length' 0
	run aa read ad7124_8 interrupts
	refute_output --partial "Suggestions"
	refute_output --partial "Or add your own"
}

# bats test_tags=req:READ-05
@test "read --quiet <node> <property> prints the value alone" {
	run aa read --quiet ad7124_8 avdd-supply
	assert_success
	assert_output "avdd-supply = <&vdd_3v3_reg>;"
	run_json read --quiet ad7124_8 avdd-supply
	assert_json 'has("description") or has("suggestions") or has("required")' false
	assert_json '.value' "&vdd_3v3_reg"
}

# bats test_tags=req:READ-05
@test "read --quiet of a flag prints true" {
	aa update ad7124_8 spi-cpha >/dev/null
	run aa read --quiet ad7124_8 spi-cpha
	assert_success
	assert_output "true"
}

# bats test_tags=req:READ-05
@test "read --quiet <node> leaves out the missing required properties" {
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run aa read --quiet adxl345
	assert_success
	refute_output --partial "Missing required"
	assert_line '    compatible = "adi,adxl345";'
}

# bats test_tags=req:READ-06
@test "read of a base node shows it with what the overlay adds, base values marked" {
	run aa read spi1
	assert_success
	assert_line --index 0 --regexp '^spi1: spi@7e215080 \{$'
	assert_line --regexp '^    compatible = "brcm,bcm2835-aux-spi";   // base$'
	# The overlay's child is read in full, without the mark.
	assert_line '    ad7124_8: adi,ad7124-8@0 {'
	assert_line '        compatible = "adi,ad7124-8";'
}

# bats test_tags=req:READ-06
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

# bats test_tags=req:READ-06
@test "read of a base node collapses the base children the overlay doesn't reach" {
	run aa read spi0
	assert_success
	assert_line '    spidev0: spidev@0 { … };   // base'
	run_json read spi0
	assert_json '.children[] | select(.key == "spidev@0") | .origin' base
	assert_json '.children[] | select(.key == "spidev@0") | .properties | length' 0
}

# bats test_tags=req:READ-06
@test "read --quiet keeps the base marks of a node, and drops that of a property" {
	run aa read --quiet spi0
	assert_line --regexp '^    compatible = "brcm,bcm2835-spi";   // base$'
	run aa read --quiet spi0 compatible
	assert_output 'compatible = "brcm,bcm2835-spi";'
}

# bats test_tags=req:READ-07
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
# bats test_tags=req:READ-07, gap
@test "read --json says a node of the overlay is internal and one of the base external" {
	run_json read ad7124_8
	assert_json '.origin' internal
	run_json read spi0
	assert_json '.origin' external
}
