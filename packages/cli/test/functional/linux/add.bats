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
#   2. Check it is refused (exit 0, .ok false) with an error naming the workfile field.
#   3. Check its hint points to init.
#   4. Check no workfile was created.
# bats test_tags=req:ADD-01, id:L0003
@test "add needs a workfile, and creates none" {
	run_json add adi,adxl345 --parent i2c1
	assert_success
	assert_json '.ok' false
	assert_json '.errors[0].field' workfile
	assert_json '.hints[0] | contains("Run '"'"'analog-attach init'"'"' to create it")' true
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
#   4. Check the workfile has the node accel@53 with reg <0x53>, in hex as the unit address.
# bats test_tags=req:ADD-03, id:L0005
@test "--name names the new node, its unit address giving reg" {
	with_overlay
	run_json add adi,adxl345 --parent i2c1 --name accel@53
	assert_success
	assert_json '.key' accel@53
	run cat "$WORKFILE"
	assert_output --partial 'adxl345: accel@53 {'
	assert_output --partial 'reg = <0x53>;'
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

# Description: without --name, a node that gets no unit address to tell it apart (regulator-fixed's
# binding has no reg) and whose name is taken is numbered, the first free <name>-<n>, with a note;
# an explicit --name that is taken is still refused.
# Steps:
#   1. Create the overlay with init and add regulator-fixed.
#   2. Add regulator-fixed again, standard error kept apart; check it is added as
#      regulator-fixed-1 (label regulator_fixed_1) with the note Name regulator-fixed is taken;
#      named regulator-fixed-1 instead.
#   3. Add regulator-fixed with --json; check the key and path are regulator-fixed-2.
#   4. Check the workfile has the three nodes.
#   5. Snapshot the workfile; add regulator-fixed --name regulator-fixed, with --json; check it is
#      refused, / already having a child of that name (name-taken), and the workfile is unchanged.
# bats test_tags=req:ADD-03, req:ADD-03-LNX, id:L0470
@test "without --name, a taken name with no unit address is numbered; a taken --name is refused" {
	with_overlay
	aa add regulator-fixed >/dev/null 2>&1 || fail "first add failed"
	run --separate-stderr aa add regulator-fixed
	assert_success
	assert_output --partial "Added regulator-fixed-1 (label: regulator_fixed_1) to $WORKFILE"
	[[ "$stderr" == *"Name regulator-fixed is taken; named regulator-fixed-1 instead"* ]] ||
		fail "no note on the numbered name: $stderr"
	run_json add regulator-fixed
	assert_success
	assert_json '.key' regulator-fixed-2
	assert_json '.path | tojson' '["regulator-fixed-2"]'
	run cat "$WORKFILE"
	assert_output --partial 'regulator_fixed: regulator-fixed {'
	assert_output --partial 'regulator_fixed_1: regulator-fixed-1 {'
	assert_output --partial 'regulator_fixed_2: regulator-fixed-2 {'
	snapshot
	run_json add regulator-fixed --name regulator-fixed
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' name-taken
	assert_json '.message' '/ already has a child named regulator-fixed'
	assert_unchanged
}

# Description: a copy template whose node has no unit address is numbered the same way when its
# name is taken and no --name is given; with --name it is refused.
# Steps:
#   1. Create the overlay with init and add regulator-fixed --template example:1 (the node
#      regulator-1v8, label reg_1v8).
#   2. Add it again, standard error kept apart; check it is added as regulator-1v8-1 (label
#      reg_1v8_1), with the notes Name regulator-1v8 is taken; named regulator-1v8-1 instead and
#      Label reg_1v8 is taken; labelled reg_1v8_1 instead.
#   3. Snapshot the workfile; add it with --name regulator-1v8, with --json; check it is refused
#      (name-taken) and the workfile is unchanged.
# bats test_tags=req:ADD-09, req:ADD-03-LNX, id:L0471
@test "a copied node without a unit address whose name is taken is numbered; with --name it is refused" {
	with_overlay
	aa add regulator-fixed --template example:1 >/dev/null 2>&1 || fail "first add failed"
	run --separate-stderr aa add regulator-fixed --template example:1
	assert_success
	assert_output --partial "Added regulator-1v8-1 (label: reg_1v8_1) to $WORKFILE"
	[[ "$stderr" == *"Name regulator-1v8 is taken; named regulator-1v8-1 instead"* ]] ||
		fail "no note on the numbered name: $stderr"
	[[ "$stderr" == *"Label reg_1v8 is taken; labelled reg_1v8_1 instead"* ]] ||
		fail "no note on the label: $stderr"
	snapshot
	run_json add regulator-fixed --template example:1 --name regulator-1v8
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' name-taken
	assert_json '.message' '/ already has a child named regulator-1v8'
	assert_unchanged
}

# Description: a reg the CLI derives from a unit address is written in hex, as the unit address:
# the chip select it picks; a reg the user sets with update stays as typed.
# Steps:
#   1. Create the overlay with init and add adi,ad7124-8 under spi0 (chip select 2 picked).
#   2. Check the workfile has reg = <0x2>.
#   3. Update reg of ad7124_8 to 3; check the node is renamed to adi,ad7124-8@3 and the workfile
#      has reg = <3>, as typed.
# bats test_tags=req:ADD-03-LNX, req:UPDATE-09, id:L0472
@test "a reg derived from the unit address is in hex; one set with update stays as typed" {
	with_overlay
	aa add adi,ad7124-8 --parent spi0 >/dev/null 2>&1 || fail "add failed"
	run cat "$WORKFILE"
	assert_output --partial 'ad7124_8: adi,ad7124-8@2 {'
	assert_output --partial 'reg = <0x2>;'
	aa update ad7124_8 reg 3 >/dev/null 2>&1 || fail "update reg failed"
	run cat "$WORKFILE"
	assert_output --partial 'ad7124_8: adi,ad7124-8@3 {'
	assert_output --partial 'reg = <3>;'
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

# Description: a device whose binding's reg is an enum (adp5055: 0x70 or 0x71) gets the lowest free
# address the enum allows, which validate accepts.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adp5055 --parent i2c1, with --json; check the key is adi,adp5055@70.
#   3. Add it again in human mode; check it adds adi,adp5055@71 and notes 0x70 was taken.
#   4. Run validate, with --json; check no error concerns reg.
# bats test_tags=req:ADD-03-LNX, id:L0374
@test "the default address is the lowest free one the binding's reg allows" {
	with_overlay
	run_json add adi,adp5055 --parent i2c1
	assert_success
	assert_json '.key' 'adi,adp5055@70'
	run --separate-stderr aa add adi,adp5055 --parent i2c1 --label second
	assert_success
	assert_output --partial 'Added adi,adp5055@71'
	[[ "$stderr" == *'Picked address 0x71 (taken: 0x70 by adi,adp5055@70).'* ]] ||
		fail "no note on the picked address: $stderr"
	run_json validate
	assert_json '[.errors[] | select(tostring | test("reg"))] | length' 0
}

# Description: a device whose binding's reg is a range (adm1266: 0x40 to 0x4f) gets the lowest
# free address in it, which validate accepts.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adm1266 --parent i2c1, with --json; check the key is adi,adm1266@40.
#   3. Run validate, with --json; check no error concerns reg.
# bats test_tags=req:ADD-03-LNX, id:L0377
@test "the default address is the lowest free one in the binding's reg range" {
	with_overlay
	run_json add adi,adm1266 --parent i2c1
	assert_success
	assert_json '.key' 'adi,adm1266@40'
	run_json validate
	assert_json '[.errors[] | select(tostring | test("reg"))] | length' 0
}

# Description: when every address the binding's reg allows is taken, the device gets the lowest
# one anyway, with a note naming the nodes at them; under the same name it is a taken name.
# Steps:
#   1. Create the overlay with init and add adi,adp5055 --parent i2c1 twice (@70 and @71).
#   2. Add adi,adp5055 --parent i2c1 --name pmic; check it adds pmic@70, notes that every
#      allowed address is taken, naming both nodes, and warns that 0x70 is used.
#   3. Snapshot the workfile; add adi,adp5055 --parent i2c1 again, with --json; check it is refused
#      (exit 0, .ok false), the name adi,adp5055@70 being taken, and the workfile is unchanged.
# bats test_tags=req:ADD-03-LNX, id:L0375
@test "with every allowed address taken, the lowest allowed one is picked, with a note" {
	with_overlay
	aa add adi,adp5055 --parent i2c1 >/dev/null 2>&1 || fail "first add failed"
	aa add adi,adp5055 --parent i2c1 --label second >/dev/null 2>&1 || fail "second add failed"
	run --separate-stderr aa add adi,adp5055 --parent i2c1 --name pmic --label third
	assert_success
	assert_output --partial 'Added pmic@70'
	[[ "$stderr" == *'Picked address 0x70 although every one the binding allows is taken (0x70 by adi,adp5055@70, 0x71 by adi,adp5055@71)'* ]] ||
		fail "no note on the taken address: $stderr"
	[[ "$stderr" == *'address 0x70 is already used by adi,adp5055@70'* ]] ||
		fail "no warning on the clash: $stderr"
	snapshot
	run_json add adi,adp5055 --parent i2c1 --label fourth
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'i2c1 already has a child named adi,adp5055@70'
	assert_unchanged
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

# Description: with a copy template, --name renames the copied node; a name without a unit
# address keeps the node's own unit address and reg.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --template example:1 --name accel.
#   3. Check it succeeds and adds accel@2a, the example's unit address.
#   4. Check the workfile has the node as accel@2a with the example's reg and interrupts.
# bats test_tags=req:ADD-09, req:ADD-03, id:L0430
@test "with a copy template, --name renames the node, keeping its unit address and reg" {
	with_overlay
	run --separate-stderr aa add adi,adxl345 --template example:1 --name accel
	assert_success
	assert_output --partial 'Added accel@2a (label: adxl345)'
	run cat "$WORKFILE"
	assert_output --partial 'adxl345: accel@2a {'
	assert_output --partial 'reg = <0x2a>;'
	assert_output --partial 'interrupts = <0 4>;'
}

# Description: with a copy template, a --name with another unit address sets it, and reg follows
# as for a node added by hand; one that isn't hex leaves no reg, with a note.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,adxl345 --template example:1 --name accel@1d, with --json.
#   3. Check it succeeds with the key accel@1d, and the workfile has reg <0x1d> in place of
#      the example's <0x2a>, and the example's interrupts.
#   4. Add adi,adxl345 --template overlay:rpi-adxl345 --name acc@zz.
#   5. Check standard error has the note Non-hex unit address "zz"; no reg created, and the node
#      in the workfile has no reg.
# bats test_tags=req:ADD-09, req:ADD-03, id:L0431
@test "with a copy template, --name with another unit address sets it, and reg follows" {
	with_overlay
	run_json add adi,adxl345 --template example:1 --name accel@1d
	assert_success
	assert_json '.ok' true
	assert_json '.key' accel@1d
	run cat "$WORKFILE"
	assert_output --partial 'accel@1d {'
	assert_output --partial 'reg = <0x1d>;'
	refute_output --partial 'reg = <0x2a>;'
	assert_output --partial 'interrupts = <0 4>;'

	run --separate-stderr aa add adi,adxl345 --template overlay:rpi-adxl345 --name acc@zz
	assert_success
	[[ "$stderr" == *'Non-hex unit address "zz"; no reg created'* ]] || fail "no non-hex note: $stderr"
	run awk '/acc@zz \{/,/};/' "$WORKFILE"
	assert_output --partial 'spi-max-frequency = <1000000>;'
	refute_output --partial 'reg ='
}

# Description: with a copy template, --name is checked as add checks it, and a taken key is
# refused; nothing is written.
# Steps:
#   1. Create the overlay with init and add adi,adxl345 --template example:1.
#   2. Snapshot the workfile.
#   3. Add adi,adxl345 --template example:1 --name 'bad name', with --json: refused
#      (invalid-name).
#   4. Add adi,adxl345 --template example:1 --name accelerometer, with --json: refused, the
#      parent already having accelerometer@2a (name-taken).
#   5. Check the workfile is unchanged.
# bats test_tags=req:ADD-09, req:ADD-03, id:L0432
@test "with a copy template, an invalid or taken --name is refused" {
	with_overlay
	aa add adi,adxl345 --template example:1 >/dev/null 2>&1
	snapshot
	run_json add adi,adxl345 --template example:1 --name 'bad name'
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' invalid-name
	run_json add adi,adxl345 --template example:1 --name accelerometer
	assert_success
	assert_json '.ok' false
	assert_json '.error_type' name-taken
	assert_json '.message | endswith("already has a child named accelerometer@2a")' true
	assert_unchanged
}

# Description: --dry-run writes nothing and shows the node add would add, after the same notes.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --parent spi0 --template example:2 --dry-run.
#   3. Check it succeeds, says it would add accelerometer@0 (label: adxl345) to the workfile, and
#      shows the node with the example's reg and interrupts, one tab per level.
#   4. Check the copy note is on standard error and the workfile is unchanged.
# bats test_tags=req:ADD-14, id:L0400
@test "--dry-run writes nothing and shows the node add would add" {
	with_overlay
	snapshot
	run --separate-stderr aa add adi,adxl345 --parent spi0 --template example:2 --dry-run
	assert_success
	assert_line --index 0 "Would add accelerometer@0 (label: adxl345) to $WORKFILE"
	assert_line --index 1 'adxl345: accelerometer@0 {'
	assert_line --index 2 $'\tcompatible = "adi,adxl345";'
	assert_line $'\treg = <0>;'
	assert_line $'\tinterrupts = <0 4>;'
	assert_line '};'
	refute_output --partial 'Missing required'
	[[ "$stderr" == *'Copied example 2 of adi,adxl345.yaml (spi)'* ]] || fail "no copy note: $stderr"
	assert_unchanged
}

# Description: with --json, --dry-run answers as add does, with the node's text in node.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --template overlay:rpi-adxl345 --dry-run, with --json.
#   3. Check it succeeds with .dry_run true, the message Would add adxl345@0 (label: adxl345),
#      the label adxl345, its key and path, and a node that starts with its label and name and has the overlay's
#      interrupts.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-14, id:L0401
@test "--dry-run with --json gives the node it would add in node" {
	with_overlay
	snapshot
	run_json add adi,adxl345 --template overlay:rpi-adxl345 --dry-run
	assert_success
	assert_json '.ok' true
	assert_json '.dry_run' true
	assert_json '.message' 'Would add adxl345@0 (label: adxl345)'
	assert_json '.label' adxl345
	assert_json '.path | join("/")' 'soc/spi@7e204000/adxl345@0'
	assert_json '.node | startswith("adxl345: adxl345@0 {\n")' true
	assert_json '.node | contains("\tinterrupts = <19 4>;\n")' true
	assert_unchanged
}

# Description: on a terminal, --dry-run asks nothing: the parent is the first valid one, with its
# note, and no required property is asked for.
# Steps:
#   1. Create the overlay with init and snapshot the workfile.
#   2. Add adi,adxl345 --dry-run on a terminal, typing nothing (a 30 s limit).
#   3. Check it succeeds without the parent question or the interview, notes the parent spi and
#      says it would add adi,adxl345@2.
#   4. Check the workfile is unchanged.
# bats test_tags=req:ADD-14, id:L0402
@test "on a terminal, --dry-run asks nothing" {
	with_overlay
	snapshot
	TTY_TIMEOUT=30 tty_run -- add adi,adxl345 --dry-run
	assert_success
	refute_output --partial 'Where does adi,adxl345 go?'
	refute_output --partial 'required propert'
	assert_output --partial 'Parent: spi (use --parent to choose another)'
	assert_output --partial 'Would add adi,adxl345@2 (label: adxl345)'
	assert_unchanged
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

# Description: on a terminal, a required clocks is asked in two steps: the clock provider, then
# one number per cell its #clock-cells asks for; the fixed clocks, whole entries, come first.
# Steps:
#   1. Create the overlay with init.
#   2. Add adi,ad7768-1 on a terminal: Enter at the parent, clocks (e, the RPi 4's cprman) at
#      the provider question, 20 at the cell question, then Ctrl+C at vref-supply.
#   3. Check it succeeds, offers clk_osc as a and clocks as e with #clock-cells = <1>, asks
#      clocks cell 1 after the provider, and says vref-supply is still missing.
#   4. Check the workfile has clocks = <&clocks 20>.
# bats test_tags=req:ADD-11, id:L0489
@test "on a terminal, clocks are asked provider first, then its #clock-cells" {
	with_overlay
	tty_run 'parent [a]: ' $'\r' 'clocks provider [a]: ' $'e\r' 'clocks cell 1: ' $'20\r' \
		'vref-supply [a]: ' $'\x03' -- add adi,ad7768-1
	assert_success
	assert_output --partial '  a) clk_osc — fixed-clock "osc" 54 MHz'
	assert_output --partial '  e) clocks — clock provider "brcm,bcm2711-cprman", #clock-cells = <1>'
	assert_output --partial 'Missing required: vref-supply'
	run cat "$WORKFILE"
	assert_output --partial 'clocks = <&clocks 20>;'
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
#   3. Check it succeeds and offers --parent, --label, --template, --dry-run, --name and --quiet.
# bats test_tags=req:ADD-13, id:L0030
@test "add completes its flags" {
	with_overlay
	run aa __complete -- add adi,adxl345 --
	assert_success
	assert_line --regexp $'^--parent\t'
	assert_line --regexp $'^--label\t'
	assert_line --regexp $'^--template\t'
	assert_line --regexp $'^--dry-run\t'
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

# Description: completion of --template names the compatible an example was written for when it
# is another one of the binding than the one asked, and says nothing more when it is the same.
# Steps:
#   1. Create the overlay with init.
#   2. Complete an empty --template of add adi,ad7124-8 (whose binding's example is for
#      adi,ad7124-4).
#   3. Check it offers example:1 described SPI, written for adi,ad7124-4.
#   4. Complete an empty --template of add adi,ad7124-4, and check example:1 is described SPI.
# bats test_tags=req:ADD-13, req:ADD-09, id:L0433
@test "add's --template completion names the compatible an example was written for" {
	with_overlay
	run aa __complete -- add adi,ad7124-8 --template ""
	assert_success
	assert_line --regexp $'^example:1\tSPI, written for adi,ad7124-4$'
	run aa __complete -- add adi,ad7124-4 --template ""
	assert_success
	assert_line --regexp $'^example:1\tSPI$'
}
