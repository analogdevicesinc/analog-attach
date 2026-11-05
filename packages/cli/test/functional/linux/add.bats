# add where the backend is linux: the RPi 4 base of the ADI tree, and its bindings.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree and its binding
# caches, the workfile overlay.dtso not created yet.
setup() {
	load ../helpers
	new_project linux
}

# Description: adding a compatible adds a node of its binding and reports the node's name and
# path.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent i2c1, with --json.
#   3. Check it succeeds (.ok true) and reports the key adi,adxl345@0, its path under
#      /soc/i2c@7e804000 and the template required.
#   4. Check the workfile has the node, labelled adxl345, with its compatible.
# bats test_tags=req:ADD-01, id:L0001
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

# Description: in human mode, add says which node it added, with its label and the workfile.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent i2c1.
#   3. Check it succeeds and the first line names adi,adxl345@0, the label adxl345 and the
#      workfile.
# bats test_tags=req:ADD-01, id:L0002
@test "add in human mode writes the name, the label and the workfile" {
	with_overlay
	run --separate-stderr aa add adi,adxl345 --parent i2c1
	assert_success
	assert_line --index 0 "Added adi,adxl345@0 (label: adxl345) to $WORKFILE"
}

# Description: add refuses to run without a workfile, says how to create one, and creates none.
# Steps:
#   1. Add adi,adxl345 --parent i2c1, with --json, before any init.
#   2. Check it fails (exit 2) with an error on standard error naming the workfile field.
#   3. Check its hint points to init.
#   4. Check no workfile was created.
# bats test_tags=req:ADD-01, id:L0003
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

# Description: an unknown compatible is refused, naming the closest compatibles.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl34, with --json.
#   3. Check it is refused (exit 0, .ok false) and the message names adi,adxl345.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-02, id:L0004
@test "an unknown compatible is refused, naming the closest ones" {
	with_overlay
	snapshot
	run_json add adi,adxl34
	assert_success
	assert_json '.ok' false
	assert_json '.message | test("adi,adxl345")' true
	assert_unchanged
}

# Description: --name gives the new node its name, and the unit address of the name sets reg.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent i2c1 --name accel@53, with --json.
#   3. Check it succeeds with the key accel@53.
#   4. Check the workfile has the node accel@53 with reg 83 (0x53).
# bats test_tags=req:ADD-03, id:L0005
@test "--name names the new node, its unit address giving reg" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --name accel@53
	assert_success
	assert_json '.key' accel@53
	run cat "$WORKFILE"
	assert_output --partial 'adxl345: accel@53 {'
	assert_output --partial 'reg = <83>;'
}

# Description: without --name, add picks a name that no other node there has.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 on i2c1.
#   2. Add adi,adxl345 on i2c1 again, with --json.
#   3. Check it succeeds with the key adi,adxl345@1.
#   4. Check the workfile has both adi,adxl345@0 and adi,adxl345@1.
# bats test_tags=req:ADD-03, id:L0006
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

# Description: a name another child of the parent has is refused, and nothing is written.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 on i2c1 named accel@53.
#   2. Snapshot the workfile.
#   3. Add adi,adxl345 on i2c1 named accel@53 again, with --json.
#   4. Check it is refused (exit 0, .ok false), saying i2c1 already has a child of that name.
#   5. Check the workfile is unchanged.
# bats test_tags=req:ADD-03, id:L0007
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

# Description: a name with an empty unit address is refused, and nothing is written.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --parent i2c1 --name accel@, with --json.
#   3. Check it is refused (exit 0, .ok false), saying the unit address is empty.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-03, id:L0008
@test "a name with an empty unit address is refused" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --parent i2c1 --name accel@
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'Empty unit address (name@ is invalid)'
	assert_unchanged
}

# Description: a name that is not a valid node name is refused, and nothing is written.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --parent i2c1 --name 'bad name', with --json.
#   3. Check it is refused (exit 0, .ok false).
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-03, id:L0009
@test "an invalid name is refused" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --parent i2c1 --name 'bad name'
	assert_success
	assert_json '.ok' false
	assert_unchanged
}

# Description: the default name is the compatible with a unit address, the first free chip
# select on SPI, with a note on the choice.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,ad7124-8 --parent spi0, with --json; check the key is adi,ad7124-8@2 (0 and 1 are
#      the base's spidev nodes).
#   3. Add it again in human mode; check it adds adi,ad7124-8@3.
#   4. Check standard error notes chip select 3 was picked, naming the nodes on 0, 1 and 2.
# bats test_tags=req:ADD-03-LNX, id:L0010
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

# Description: --parent places the device under that node.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent spi1, with --json.
#   3. Check it succeeds with a path under /soc/spi@7e215080.
#   4. Check the workfile has a fragment targeting spi1.
# bats test_tags=req:ADD-06, id:L0011
@test "--parent places the device under that node" {
	with_overlay
	run_json add adi,adxl345 --parent spi1
	assert_success
	assert_json '.path | join("/")' 'soc/spi@7e215080/adi,adxl345@0'
	run cat "$WORKFILE"
	assert_output --partial 'target = <&spi1>;'
}

# Description: without --parent, the device goes under the first parent list parent gives, with
# a note naming it.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 with no --parent.
#   3. Check it succeeds and standard error says the parent is spi and --parent chooses another.
#   4. Check list parent gives spi (/soc/spi@7e204000) first.
#   5. Read spi0/adi,adxl345@2, with --json; check it succeeds with the label adxl345.
# bats test_tags=req:ADD-06, id:L0012
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

# Description: a parent that does not exist is refused, and nothing is written.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --parent nosuch, with --json.
#   3. Check it is refused (exit 0, .ok false), saying the parent node is not found.
#   4. Run it in human mode; check it says the parent is in neither the base nor the workfile.
#   5. Check the workfile is unchanged.
# bats test_tags=req:ADD-06, id:L0013
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

# Description: on a terminal, add first asks for the parent, offering the valid ones, and uses
# the one picked.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: pick i2c1 (i), then Ctrl+C at the interrupt-parent
#      question.
#   3. Check it succeeds and the question was shown, with spi as a and i2c1 as i.
#   4. Check the workfile has a fragment targeting i2c_arm with the adxl345 node.
# bats test_tags=req:ADD-07, id:L0014
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

# Description: on a terminal, Enter at the parent question takes the first valid parent.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: Enter at the parent question, then Ctrl+C at the
#      interrupt-parent question.
#   3. Check it succeeds and the workfile has a fragment targeting spi0.
# bats test_tags=req:ADD-07, id:L0015
@test "on a terminal, Enter takes the first valid parent" {
	with_overlay
	tty_run 'parent [a]: ' $'\r' 'interrupt-parent [a]: ' $'\x03' -- add adi,adxl345
	assert_success
	run cat "$WORKFILE"
	assert_output --partial 'target = <&spi0>;'
}

# Description: Ctrl+C at the parent question ends add with nothing added.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 on a terminal and press Ctrl+C at the parent question.
#   3. Check it exits 130 and says no parent was chosen and nothing was added.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-07, req:GEN-06, id:L0016
@test "stopping the parent question adds nothing" {
	with_overlay
	snapshot
	tty_run 'parent [a]: ' $'\x03' -- add adi,adxl345
	assert_failure 130
	assert_output --partial 'No parent chosen; nothing added.'
	assert_unchanged
}

# Description: --label gives the new node that label.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent i2c1 --label myaccel, with --json.
#   3. Check it succeeds and the message gives the label myaccel.
#   4. Check the workfile has the node with the label myaccel.
# bats test_tags=req:ADD-08, id:L0017
@test "--label sets the new node's label" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --label myaccel
	assert_success
	assert_json '.message' 'Added adi,adxl345@0 (label: myaccel)'
	run cat "$WORKFILE"
	assert_output --partial 'myaccel: adi,adxl345@0 {'
}

# Description: without --label, the label is made from the compatible, with a suffix when it
# is taken.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,ad7124-8 --parent spi0, with --json; check the label is ad7124_8.
#   3. Add it again, with --json; check the label is ad7124_8_1.
# bats test_tags=req:ADD-08, id:L0018
@test "without --label a label is made from the compatible, one not taken" {
	with_overlay
	run_json add adi,ad7124-8 --parent spi0
	assert_json '.message' 'Added adi,ad7124-8@2 (label: ad7124_8)'
	run_json add adi,ad7124-8 --parent spi0
	assert_json '.message' 'Added adi,ad7124-8@3 (label: ad7124_8_1)'
}

# Description: a label that is not valid, or that the base or the overlay already uses, is
# refused, and nothing is written.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --parent i2c1 --label 1bad, with --json; check it is refused (.ok false)
#      as an invalid label, giving the pattern a label must match.
#   3. Add it with --label spi0, with --json; check it is refused (.ok false), saying
#      /soc/spi@7e204000 uses the label.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-08, id:L0019
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

# Description: --template example:N starts the node from that example of the binding, on a bus
# of the example's kind.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --template example:1.
#   3. Check it succeeds, adds accelerometer@2a and notes it copied example 1, an I2C one.
#   4. Check the workfile has the example's reg and interrupts, in a fragment targeting the
#      first I2C bus, i2c0if.
# bats test_tags=req:ADD-09, id:L0020
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

# Description: --template overlay:<name> starts the node from that overlay of the Linux tree.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --template overlay:rpi-adxl345, with --json.
#   3. Check it succeeds with that template and the key adxl345@0.
#   4. Check the workfile has the overlay's target spi0, spi-max-frequency and interrupts.
# bats test_tags=req:ADD-09, id:L0021
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

# Description: an example number the binding does not have is refused, naming the examples it
# has, and nothing is written.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --template example:9, with --json.
#   3. Check it is refused (exit 0, .ok false), saying the binding has 2 examples, example:1
#      (I2C) and example:2 (SPI).
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-09, id:L0022
@test "an example the binding does not have is refused, naming those it has" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --template example:9
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'There is no example 9: adi,adxl345.yaml has 2 examples; use example:1 (I2C), example:2 (SPI)'
	assert_unchanged
}

# Description: a --template value of an unknown form is a usage error.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --template bogus.
#   3. Check it fails with a usage error (exit 2) and standard error lists the forms --template
#      takes.
# bats test_tags=req:ADD-09, id:L0023
@test "an unknown template is a usage error" {
	with_overlay
	run --separate-stderr aa add adi,adxl345 --template bogus
	assert_failure 2
	[[ "$stderr" == *'Unknown --template bogus (use required, example:<N> or overlay:<name>)'* ]] ||
		fail "stderr: $stderr"
}

# Description: on a terminal, add asks for each missing required property, offering values,
# and writes the answers.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: pick i2c1, gpio (b) for interrupt-parent, 17 for the first
#      cell of interrupts and the default for the second.
#   3. Check it succeeds, says 2 required properties are to set, shows the questions with their
#      options, and ends saying all required properties are set.
#   4. Check the workfile has interrupt-parent &gpio and interrupts <17 0>.
# bats test_tags=req:ADD-11, id:L0024
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

# Description: on a terminal, each answer is written at once, so stopping the questions keeps
# the answers given.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: pick i2c1, gpio for interrupt-parent, then Ctrl+C at the
#      first interrupts question.
#   3. Check it succeeds and says interrupts is still missing.
#   4. Check the workfile has interrupt-parent &gpio and no interrupts.
# bats test_tags=req:ADD-11, req:GEN-06, id:L0025
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

# Description: on a terminal, add sets values from the binding's example for the chosen bus
# without asking.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 on a terminal: pick i2c1, then Ctrl+C at the interrupt-parent question.
#   3. Check it succeeds and says reg was set from example 1 and the node renamed to
#      adi,adxl345@2a.
#   4. Check the workfile has reg <0x2a>.
# bats test_tags=req:ADD-11, id:L0026
@test "on a terminal, add fills from the binding's example for the bus without asking" {
	with_overlay
	tty_run 'parent [a]: ' $'i\r' 'interrupt-parent [a]: ' $'\x03' -- add adi,adxl345
	assert_success
	# The I2C example's address; the SPI example's frequency on SPI.
	assert_output --partial 'Set reg = <0x2a> (from example 1); renamed to adi,adxl345@2a'
	run cat "$WORKFILE"
	assert_output --partial 'reg = <0x2a>;'
}

# Description: with --quiet, add on a terminal asks nothing and lists what is missing.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --quiet on a terminal.
#   3. Check it succeeds and shows neither the parent nor the property questions.
#   4. Check it lists interrupt-parent and interrupts as missing and says how to set them with
#      update.
# bats test_tags=req:ADD-12, id:L0027
@test "with --quiet, add on a terminal asks nothing and lists what is missing" {
	with_overlay
	tty_run -- add adi,adxl345 --quiet
	assert_success
	refute_output --partial 'Where does adi,adxl345 go?'
	refute_output --partial 'required properties to set'
	assert_output --partial 'Missing required: interrupt-parent, interrupts'
	assert_output --partial 'Set them with: update adxl345 <property> <value>'
}

# Description: with --json, add lists the missing required properties with suggested values.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --parent i2c1 --quiet, with --json.
#   3. Check it succeeds and missing_required lists interrupt-parent and interrupts.
#   4. Check gpio is among the suggestions for interrupt-parent.
# bats test_tags=req:ADD-12, id:L0028
@test "with --json, add lists the missing values with their suggestions" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --quiet
	assert_success
	assert_json '[.missing_required[].property] | join(",")' 'interrupt-parent,interrupts'
	assert_json '[.missing_required[0].suggestions[].value] | index("gpio") != null' true
}

# Description: completion of add offers the compatibles that start with the word.
# Steps:
#   1. Create the overlay with init.
#   2. Complete add adi,adxl34.
#   3. Check it succeeds and offers adi,adxl345 and adi,adxl346.
# bats test_tags=req:ADD-13, id:L0029
@test "add completes the compatibles" {
	with_overlay
	run aa __complete -- add adi,adxl34
	assert_success
	assert_line adi,adxl345
	assert_line adi,adxl346
}

# Description: completion of add offers its flags.
# Steps:
#   1. Create the overlay with init.
#   2. Complete add adi,adxl345 --.
#   3. Check it succeeds and offers --parent, --label, --template, --name and --quiet.
# bats test_tags=req:ADD-13, id:L0030
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

# Description: completion of --parent offers the valid parents, then their children one path
# segment at a time.
# Steps:
#   1. Create the overlay with init.
#   2. Complete an empty --parent of add adi,adxl345.
#   3. Check it succeeds and offers spi1/ and i2c1/ with their paths.
#   4. Complete --parent spi0/ and check it succeeds and offers spi0/spidev@0.
# bats test_tags=req:ADD-13, id:L0031
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

# Description: completion of --template offers required, the binding's examples and the
# overlays that have the device.
# Steps:
#   1. Create the overlay with init.
#   2. Complete an empty --template of add adi,adxl345.
#   3. Check it succeeds and offers required, example:1 (I2C), example:2 (SPI) and
#      overlay:rpi-adxl345-overlay.dts.
# bats test_tags=req:ADD-13, id:L0032
@test "add completes the values of --template" {
	with_overlay
	run aa __complete -- add adi,adxl345 --template ""
	assert_success
	assert_line --regexp $'^required\t'
	assert_line --regexp $'^example:1\tI2C$'
	assert_line --regexp $'^example:2\tSPI$'
	assert_line --regexp $'^overlay:rpi-adxl345-overlay.dts\t'
}
