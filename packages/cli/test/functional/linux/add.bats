# add where the backend is linux: the RPi 4 base of the ADI tree, and its bindings.

# bats file_tags=eco:linux

setup() {
	load ../helpers
	new_project linux
}

# bats test_tags=req:ADD-01
@test "add a compatible adds a node of that binding and reports its name" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1
	assert_success
	assert_json '.ok' true
	assert_json '.key' 'adi,adxl345@0'
	assert_json '.path | join("/")' 'soc/i2c@7e804000/adi,adxl345@0'
	assert_json '.template' required
	run cat "$WORKFILE"
	assert_output --partial 'adxl345: adi,adxl345@0 {'
	assert_output --partial 'compatible = "adi,adxl345";'
}

# bats test_tags=req:ADD-01
@test "add in human mode writes the name, the label and the workfile" {
	with_overlay
	run --separate-stderr aa add adi,adxl345 --parent i2c1
	assert_success
	assert_line --index 0 "Added adi,adxl345@0 (label: adxl345) to $WORKFILE"
}

# bats test_tags=req:ADD-01
@test "add needs a workfile, and creates none" {
	run_json add adi,adxl345 --parent i2c1
	assert_failure 2
	local error="$stderr"
	run jq -r '.errors[0].field' <<<"$error"
	assert_output workfile
	run jq -r '.hints[0]' <<<"$error"
	assert_output --partial "Run 'analog-attach init' to create it"
	[ ! -e "$WORKFILE" ] || fail "add created the workfile"
}

# Gap: an unknown compatible is refused with `Failed to find binding for <compatible>`, naming no
# close compatible (adi,adxl345, adi,adxl346 for adi,adxl34).
# bats test_tags=req:ADD-02, gap
@test "an unknown compatible is refused, naming the closest ones" {
	with_overlay
	snapshot
	run_json add adi,adxl34
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("adi,adxl345")' true
	assert_unchanged
}

# bats test_tags=req:ADD-03
@test "--name names the new node, its unit address giving reg" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --name accel@53
	assert_success
	assert_json '.key' accel@53
	run cat "$WORKFILE"
	assert_output --partial 'adxl345: accel@53 {'
	assert_output --partial 'reg = <83>;'
}

# bats test_tags=req:ADD-03
@test "without --name the name picked is one not taken" {
	with_overlay
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1
	run_json add adi,adxl345 --parent i2c1
	assert_success
	assert_json '.key' 'adi,adxl345@1'
	run cat "$WORKFILE"
	assert_output --partial 'adi,adxl345@0 {'
	assert_output --partial 'adi,adxl345@1 {'
}

# bats test_tags=req:ADD-03
@test "a taken name is refused, and nothing is written" {
	with_overlay
	aa add adi,adxl345 --parent i2c1 --name accel@53 >/dev/null 2>&1
	snapshot
	run_json add adi,adxl345 --parent i2c1 --name accel@53
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'i2c1 already has a child named accel@53'
	assert_unchanged
}

# bats test_tags=req:ADD-03
@test "a name with an empty unit address is refused" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --parent i2c1 --name accel@
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'Empty unit address (name@ is invalid)'
	assert_unchanged
}

# Gap: a name that isn't a valid node name (`bad name`) is accepted and written as `bad name@0`,
# after which the workfile no longer parses.
# bats test_tags=req:ADD-03, gap
@test "an invalid name is refused" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --parent i2c1 --name 'bad name'
	assert_success
	assert_json '.ok' false
	assert_unchanged
}

# bats test_tags=req:ADD-03-LNX
@test "the default name is the compatible with its unit address" {
	with_overlay
	run_json add adi,ad7124-8 --parent spi0
	assert_success
	# Chip selects 0 and 1 are the base's spidev nodes.
	assert_json '.key' 'adi,ad7124-8@2'
	run --separate-stderr aa add adi,ad7124-8 --parent spi0
	assert_success
	assert_output --partial 'Added adi,ad7124-8@3'
	[[ "$stderr" == *'Picked chip select 3 (taken: 0 by spidev@0, 1 by spidev@1, 2 by adi,ad7124-8@2).'* ]] ||
		fail "no note on the picked chip select: $stderr"
}

# bats test_tags=req:ADD-06
@test "--parent places the device under that node" {
	with_overlay
	run_json add adi,adxl345 --parent spi1
	assert_success
	assert_json '.path | join("/")' 'soc/spi@7e215080/adi,adxl345@0'
	run cat "$WORKFILE"
	assert_output --partial 'target = <&spi1>;'
}

# bats test_tags=req:ADD-06
@test "without --parent the device goes under the first valid parent, with a note saying which" {
	with_overlay
	run --separate-stderr aa add adi,adxl345
	assert_success
	[[ "$stderr" == *'Parent: spi (use --parent to choose another)'* ]] || fail "no parent note: $stderr"
	run aa list parent adi,adxl345
	assert_line --index 0 'spi  /soc/spi@7e204000'
	run_json read spi0/adi,adxl345@2
	assert_success
	assert_json '.alias[0]' adxl345
}

# bats test_tags=req:ADD-06
@test "a parent that does not exist is refused, and nothing is written" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --parent nosuch
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'Parent node nosuch not found'
	run aa add adi,adxl345 --parent nosuch
	assert_output "Couldn't find parent node nosuch in $LINUX_BASE or $WORKFILE"
	assert_unchanged
}

# bats test_tags=req:ADD-07
@test "on a terminal, add first asks for the parent, offering the valid ones" {
	with_overlay
	tty_run 'parent [a]: ' $'i\r' 'interrupt-parent [a]: ' $'\x03' -- add adi,adxl345
	assert_success
	assert_output --partial 'Where does adi,adxl345 go? (Enter takes a, a letter picks, or type a label or path, Ctrl-D stops)'
	assert_output --partial '  a) spi  /soc/spi@7e204000'
	assert_output --partial '  i) i2c1  /soc/i2c@7e804000'
	run cat "$WORKFILE"
	assert_output --partial 'target = <&i2c_arm>;'
	assert_output --partial 'adxl345: adi,adxl345@'
}

# bats test_tags=req:ADD-07
@test "on a terminal, Enter takes the first valid parent" {
	with_overlay
	tty_run 'parent [a]: ' $'\r' 'interrupt-parent [a]: ' $'\x03' -- add adi,adxl345
	assert_success
	run cat "$WORKFILE"
	assert_output --partial 'target = <&spi0>;'
}

# bats test_tags=req:ADD-07, req:GEN-06
@test "stopping the parent question adds nothing" {
	with_overlay
	snapshot
	tty_run 'parent [a]: ' $'\x03' -- add adi,adxl345
	assert_failure 130
	assert_output --partial 'No parent chosen; nothing added.'
	assert_unchanged
}

# bats test_tags=req:ADD-08
@test "--label sets the new node's label" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --label myaccel
	assert_success
	assert_json '.message' 'Added adi,adxl345@0 (label: myaccel)'
	run cat "$WORKFILE"
	assert_output --partial 'myaccel: adi,adxl345@0 {'
}

# bats test_tags=req:ADD-08
@test "without --label a label is made from the compatible, one not taken" {
	with_overlay
	run_json add adi,ad7124-8 --parent spi0
	assert_json '.message' 'Added adi,ad7124-8@2 (label: ad7124_8)'
	run_json add adi,ad7124-8 --parent spi0
	assert_json '.message' 'Added adi,ad7124-8@3 (label: ad7124_8_1)'
}

# bats test_tags=req:ADD-08
@test "an invalid label, or one the base or the overlay uses, is refused" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --parent i2c1 --label 1bad
	assert_json '.ok' false
	assert_json '.message' 'Invalid label: 1bad (must match [A-Za-z_][A-Za-z0-9_]*)'
	run_json add adi,adxl345 --parent i2c1 --label spi0
	assert_json '.ok' false
	assert_json '.message' 'Label spi0 is already used by /soc/spi@7e204000'
	assert_unchanged
}

# bats test_tags=req:ADD-09
@test "--template example:N starts the node from that example of the binding" {
	with_overlay
	run --separate-stderr aa add adi,adxl345 --template example:1
	assert_success
	assert_output --partial 'Added accelerometer@2a (label: adxl345)'
	[[ "$stderr" == *'Copied example 1 of adi,adxl345.yaml (i2c)'* ]] || fail "no copy note: $stderr"
	run cat "$WORKFILE"
	assert_output --partial 'reg = <0x2a>;'
	assert_output --partial 'interrupts = <0 4>;'
	# The example is on I2C: the first I2C bus.
	assert_output --partial 'target = <&i2c0if>;'
}

# bats test_tags=req:ADD-09
@test "--template overlay:name starts the node from an overlay of the Linux tree" {
	with_overlay
	run_json add adi,adxl345 --template overlay:rpi-adxl345
	assert_success
	assert_json '.template' overlay:rpi-adxl345
	assert_json '.key' adxl345@0
	run cat "$WORKFILE"
	assert_output --partial 'target = <&spi0>;'
	assert_output --partial 'spi-max-frequency = <1000000>;'
	assert_output --partial 'interrupts = <19 4>;'
}

# bats test_tags=req:ADD-09
@test "an example the binding does not have is refused, naming those it has" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --template example:9
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'There is no example 9: adi,adxl345.yaml has 2 examples; use example:1 (I2C), example:2 (SPI)'
	assert_unchanged
}

# bats test_tags=req:ADD-09
@test "an unknown template is a usage error" {
	with_overlay
	run --separate-stderr aa add adi,adxl345 --template bogus
	assert_failure 2
	[[ "$stderr" == *'Unknown --template bogus (use required, example:<N> or overlay:<name>)'* ]] ||
		fail "stderr: $stderr"
}

# bats test_tags=req:ADD-11
@test "on a terminal, add asks for what is left, offering the values, and saves the answers" {
	with_overlay
	tty_run 'parent [a]: ' $'i\r' 'interrupt-parent [a]: ' $'b\r' 'interrupts 1/2 (number)' $'17\r' \
		'interrupts 2/2 [a]: ' $'\r' -- add adi,adxl345
	assert_success
	assert_output --partial '2 required properties to set'
	assert_output --partial '[1/2] interrupt-parent'
	assert_output --partial '  b) gpio — interrupt controller, #interrupt-cells = <2>'
	assert_output --partial '  b) IRQ_TYPE_EDGE_RISING'
	assert_output --partial 'All required properties are set.'
	run cat "$WORKFILE"
	assert_output --partial 'interrupt-parent = <&gpio>;'
	assert_output --partial 'interrupts = <17 0>;'
}

# bats test_tags=req:ADD-11, req:GEN-06
@test "on a terminal, each answer is saved at once, even when the interview is stopped" {
	with_overlay
	tty_run 'parent [a]: ' $'i\r' 'interrupt-parent [a]: ' $'b\r' 'interrupts 1/2 (number)' $'\x03' \
		-- add adi,adxl345
	assert_success
	assert_output --partial 'Missing required: interrupts'
	run cat "$WORKFILE"
	assert_output --partial 'interrupt-parent = <&gpio>;'
	refute_output --partial 'interrupts ='
}

# bats test_tags=req:ADD-11
@test "on a terminal, add fills from the binding's example for the bus without asking" {
	with_overlay
	tty_run 'parent [a]: ' $'i\r' 'interrupt-parent [a]: ' $'\x03' -- add adi,adxl345
	assert_success
	# The I2C example's address; the SPI example's frequency on SPI.
	assert_output --partial 'Set reg = <0x2a> (from example 1); renamed to adi,adxl345@2a'
	run cat "$WORKFILE"
	assert_output --partial 'reg = <0x2a>;'
}

# bats test_tags=req:ADD-12
@test "with --quiet, add on a terminal asks nothing and lists what is missing" {
	with_overlay
	tty_run -- add adi,adxl345 --quiet
	assert_success
	refute_output --partial 'Where does adi,adxl345 go?'
	refute_output --partial 'required properties to set'
	assert_output --partial 'Missing required: interrupt-parent, interrupts'
	assert_output --partial 'Set them with: update adxl345 <property> <value>'
}

# bats test_tags=req:ADD-12
@test "with --json, add lists the missing values with their suggestions" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --quiet
	assert_success
	assert_json '[.missing_required[].property] | join(",")' 'interrupt-parent,interrupts'
	assert_json '[.missing_required[0].suggestions[].value] | index("gpio") != null' true
}

# bats test_tags=req:ADD-13
@test "add completes the compatibles" {
	with_overlay
	run aa __complete -- add adi,adxl34
	assert_success
	assert_line adi,adxl345
	assert_line adi,adxl346
}

# bats test_tags=req:ADD-13
@test "add completes its flags" {
	with_overlay
	run aa __complete -- add adi,adxl345 --
	assert_success
	assert_line --regexp $'^--parent\t'
	assert_line --regexp $'^--label\t'
	assert_line --regexp $'^--template\t'
	assert_line --regexp $'^--name\t'
	assert_line --regexp $'^--quiet\t'
}

# bats test_tags=req:ADD-13
@test "add completes the values of --parent, segment by segment" {
	with_overlay
	run aa __complete -- add adi,adxl345 --parent ""
	assert_success
	assert_line --regexp $'^spi1/\t/soc/spi@7e215080$'
	assert_line --regexp $'^i2c1/\t/soc/i2c@7e804000$'
	run aa __complete -- add adi,adxl345 --parent spi0/
	assert_success
	assert_line spi0/spidev@0
}

# bats test_tags=req:ADD-13
@test "add completes the values of --template" {
	with_overlay
	run aa __complete -- add adi,adxl345 --template ""
	assert_success
	assert_line --regexp $'^required\t'
	assert_line --regexp $'^example:1\tI2C$'
	assert_line --regexp $'^example:2\tSPI$'
	assert_line --regexp $'^overlay:rpi-adxl345-overlay.dts\t'
}
