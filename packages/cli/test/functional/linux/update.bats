# update where the backend is linux: an AD7124-8 (channel child nodes) on spi0 of the RPi 4.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree, no workfile
# yet. with_adc makes an overlay with an AD7124-8 on spi0 (label ad7124_8); with_channel adds
# its child channel@0.
setup() {
	load ../helpers
	new_project linux
}

# `with_adc`: the workfile with an AD7124-8 on spi0, adi,ad7124-8@2 labelled ad7124_8.
with_adc() {
	with_overlay
	aa add adi,ad7124-8 --parent spi0 >/dev/null 2>&1 || fail "add adi,ad7124-8 failed"
}

# `with_channel`: with_adc, and its child channel@0.
with_channel() {
	with_adc
	aa update ad7124_8 channel@0 >/dev/null 2>&1 || fail "update ad7124_8 channel@0 failed"
}

# Description: update with a property and a value sets that property on the node.
# Steps:
#   1. Make the overlay with the AD7124-8 (with_adc).
#   2. Run update ad7124_8 spi-max-frequency 1000000, with --json.
#   3. Check it succeeds (.ok true) and the message says spi-max-frequency was set on ad7124_8.
#   4. Check the overlay has spi-max-frequency = <1000000>.
# bats test_tags=req:UPDATE-01, id:L0307
@test "update sets a property to the value given" {
	with_adc
	run_json update ad7124_8 spi-max-frequency 1000000
	assert_success
	assert_json '.ok' true
	assert_json '.message' 'Set spi-max-frequency on ad7124_8'
	run cat "$WORKFILE"
	assert_output --partial 'spi-max-frequency = <1000000>;'
}

# Description: updating a property that is already set replaces its value where it is, keeping
# one copy of it and the order of the properties.
# Steps:
#   1. Make the overlay with the AD7124-8 and set spi-max-frequency 1000000, then rdy-gpios.
#   2. Run update ad7124_8 spi-max-frequency 2000000.
#   3. Check it succeeds.
#   4. Check the overlay has spi-max-frequency once, now <2000000>, still followed by rdy-gpios.
# bats test_tags=req:UPDATE-01, id:L0308
@test "update replaces a value in place" {
	with_adc
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null
	aa update ad7124_8 rdy-gpios gpio 25 0 >/dev/null
	run aa update ad7124_8 spi-max-frequency 2000000
	assert_success
	run grep -c spi-max-frequency "$WORKFILE"
	assert_output 1
	run grep -A1 spi-max-frequency "$WORKFILE"
	assert_output --partial 'spi-max-frequency = <2000000>;'
	assert_output --partial 'rdy-gpios'
}

# Description: updating a node of the base devicetree writes the change into the overlay, aimed
# at that node, and leaves the base file as it was.
# Steps:
#   1. Create the overlay with init and take a checksum of the base devicetree.
#   2. Run update spi0 status okay.
#   3. Check it succeeds and says status was set on spi0.
#   4. Check the overlay targets &spi0 with status = "okay".
#   5. Check the base devicetree's checksum is unchanged.
# bats test_tags=req:UPDATE-01, id:L0309
@test "update of a base node writes the value into the overlay, not the base" {
	with_overlay
	local before
	before="$(cksum <"$LINUX_BASE")"
	run aa update spi0 status okay
	assert_success
	assert_output --partial 'Set status on spi0'
	run cat "$WORKFILE"
	assert_output --partial 'target = <&spi0>;'
	assert_output --partial 'status = "okay";'
	[ "$(cksum <"$LINUX_BASE")" = "$before" ] || fail "the base changed"
}

# Description: a value word that is neither a number, a known macro nor a label is refused, and
# the workfile is left alone.
# Steps:
#   1. Make the overlay with the AD7124-8 and snapshot it.
#   2. Run update ad7124_8 interrupts foo, with --json.
#   3. Check it is refused (exit 0, .ok false), the message saying 'foo' is not a number, macro
#      or label.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:L0310
@test "update refuses a word that is not a number, a macro or a label" {
	with_adc
	snapshot
	run_json update ad7124_8 interrupts foo
	assert_success
	assert_json '.ok' false
	assert_json '.message' "'foo' is not a number, a known macro, or a label in the base tree/overlay"
	assert_unchanged
}

# Description: giving a value to a property that is a flag in the binding is refused.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0, and snapshot it.
#   2. Run update ad7124_8/channel@0 bipolar 1, with --json.
#   3. Check it is refused (exit 0, .ok false), the message saying bipolar is a flag.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-02, id:L0311
@test "update refuses a value for a flag" {
	with_channel
	snapshot
	run_json update ad7124_8/channel@0 bipolar 1
	assert_success
	assert_json '.ok' false
	assert_json '.message | startswith("bipolar is a flag")' true
	assert_unchanged
}

# `assert_warned <property>`: the last run_json accepted the edit with a warning: exit 0, ok true,
# severity warn, and the warning on standard error naming the property.
assert_warned() {
	assert_success
	assert_json '.ok' true
	assert_json '.severity' warn
	[[ "$stderr" == *"$1"* ]] || fail "no warning about $1 on standard error: $stderr"
}

# Gap: the property is written with a diagnostic on standard error (`Property nosuch-prop not
# defined by adi,ad7124-8 binding; written without schema validation`), but the result's severity
# is info, not warn.
# Description: setting a property the node's binding does not define is accepted, with a warning.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 nosuch-prop 5, with --json.
#   3. Check the overlay has nosuch-prop = <5>.
#   4. Check it succeeds (exit 0, .ok true) with severity warn, and standard error names
#      nosuch-prop.
# bats test_tags=req:UPDATE-02, gap, id:L0312
@test "update warns about a property the binding does not have, and writes it" {
	with_adc
	run_json update ad7124_8 nosuch-prop 5
	grep -q 'nosuch-prop = <5>;' "$WORKFILE" || fail "not written: $(cat "$WORKFILE")"
	# The gap: last, so the checks above hold while it is open.
	assert_warned nosuch-prop
}

# Gap: a value outside the enum (adi,reference-select is one of 0, 1, 3) is written with no
# warning: severity info, nothing on standard error.
# Description: a value outside the options of an enum property is accepted, with a warning.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0.
#   2. Run update ad7124_8/channel@0 adi,reference-select 2 (not one of 0, 1, 3), with --json.
#   3. Check the overlay has adi,reference-select = <2>.
#   4. Check it succeeds (exit 0, .ok true) with severity warn, and standard error names
#      adi,reference-select.
# bats test_tags=req:UPDATE-02, gap, id:L0313
@test "update warns about a value that is not one of an enum's options, and writes it" {
	with_channel
	run_json update ad7124_8/channel@0 adi,reference-select 2
	grep -q 'adi,reference-select = <2>;' "$WORKFILE" || fail "not written: $(cat "$WORKFILE")"
	# The gap: last, so the checks above hold while it is open.
	assert_warned adi,reference-select
}

# Gap: a channel's reg above the binding's maximum (15) is written, and the node renamed
# channel@20, with no warning: severity info, nothing on standard error.
# Description: a number above the binding's maximum is accepted, with a warning.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0.
#   2. Run update ad7124_8/channel@0 reg 20 (the maximum is 15), with --json.
#   3. Check the overlay has the channel as channel@20, with reg = <20>.
#   4. Check it succeeds (exit 0, .ok true) with severity warn, and standard error names reg.
# bats test_tags=req:UPDATE-02, gap, id:L0314
@test "update warns about a number above the maximum, and writes it" {
	with_channel
	run_json update ad7124_8/channel@0 reg 20
	grep -A1 'channel@20 {' "$WORKFILE" | grep -q 'reg = <20>;' || fail "not written: $(cat "$WORKFILE")"
	# The gap: last, so the checks above hold while it is open.
	assert_warned reg
}

# Description: an array with more values than the binding allows is accepted, with a warning.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0.
#   2. Run update ad7124_8/channel@0 diff-channels 1 2 3 (it takes 2), with --json.
#   3. Check it succeeds (exit 0, .ok true) with severity warn, and standard error names
#      diff-channels.
#   4. Check the overlay has diff-channels = <1 2 3>.
# bats test_tags=req:UPDATE-02, id:L0315
@test "update warns about an array longer than its size, and writes it" {
	with_channel
	run_json update ad7124_8/channel@0 diff-channels 1 2 3
	assert_warned diff-channels
	grep -q 'diff-channels = <1 2 3>;' "$WORKFILE" || fail "not written: $(cat "$WORKFILE")"
}

# Description: update with a property and no value shows the property exactly as read does, in
# text and in JSON.
# Steps:
#   1. Make the overlay with the AD7124-8 and set spi-max-frequency 1000000.
#   2. Run read ad7124_8 spi-max-frequency, then update ad7124_8 spi-max-frequency.
#   3. Check update succeeds with the same output as read, its first line the property's value.
#   4. Run the same read and update with --json and check their outputs are the same.
# bats test_tags=req:UPDATE-03, id:L0316
@test "update without a value shows the property as read does" {
	with_adc
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null
	run aa read ad7124_8 spi-max-frequency
	local read_text="$output"
	run aa update ad7124_8 spi-max-frequency
	assert_success
	assert_output "$read_text"
	assert_line --index 0 'spi-max-frequency = <1000000>;'
	run_json read ad7124_8 spi-max-frequency
	local read_json="$output"
	run_json update ad7124_8 spi-max-frequency
	assert_output "$read_json"
}

# Description: update with a property and no value, on a property that has a value, leaves the
# workfile as it was.
# Steps:
#   1. Make the overlay with the AD7124-8, set spi-max-frequency 1000000 and snapshot the workfile.
#   2. Run update ad7124_8 spi-max-frequency.
#   3. Check it succeeds and the workfile is unchanged.
# bats test_tags=req:UPDATE-03, id:L0317
@test "update without a value changes nothing when it reads" {
	with_adc
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null
	snapshot
	run aa update ad7124_8 spi-max-frequency
	assert_success
	assert_unchanged
}

# Description: update with no value on a property the binding defines as a flag sets the flag.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0.
#   2. Run update ad7124_8/channel@0 bipolar.
#   3. Check it succeeds and says the flag bipolar was set on ad7124_8/channel@0.
#   4. Check the overlay has a line bipolar; on its own.
# bats test_tags=req:UPDATE-03-LNX, id:L0318
@test "update without a value sets a flag the binding defines" {
	with_channel
	run aa update ad7124_8/channel@0 bipolar
	assert_success
	assert_output 'Set flag bipolar on ad7124_8/channel@0'
	run grep -x $'\t*bipolar;' "$WORKFILE"
	assert_success
}

# Description: update with no value on a property the node does not have, and the binding does
# not define, sets it as a flag.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 adi,some-flag, with --json.
#   3. Check it succeeds and the message says the flag adi,some-flag was set on ad7124_8.
#   4. Check the overlay has a line adi,some-flag; on its own.
# bats test_tags=req:UPDATE-03-LNX, id:L0319
@test "update without a value sets a property the node does not have as a flag" {
	with_adc
	run_json update ad7124_8 adi,some-flag
	assert_success
	assert_json '.message' 'Set flag adi,some-flag on ad7124_8'
	run grep -x $'\t*adi,some-flag;' "$WORKFILE"
	assert_success
}

# Description: update --suggest lists the values a property can take instead of setting it.
# Steps:
#   1. Make the overlay with the AD7124-8 and snapshot it.
#   2. Run update ad7124_8 interrupt-parent --suggest, with --json.
#   3. Check it succeeds and the suggested values include gpio.
#   4. Check it answers what list value ad7124_8 interrupt-parent answers.
#   5. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-04, id:L0320
@test "update --suggest lists the values instead of setting the property" {
	with_adc
	snapshot
	run_json update ad7124_8 interrupt-parent --suggest
	assert_success
	assert_json '[.suggestions[].value] | index("gpio") != null' true
	local suggested=$output
	run_json list value ad7124_8 interrupt-parent
	assert_output "$suggested"
	assert_unchanged
}

# Description: update --quiet with a property and no value prints the property's value alone.
# Steps:
#   1. Make the overlay with the AD7124-8 and set spi-max-frequency 1000000.
#   2. Run update --quiet ad7124_8 spi-max-frequency.
#   3. Check it succeeds and prints only spi-max-frequency = <1000000>.
# bats test_tags=req:UPDATE-05, id:L0321
@test "update --quiet without a value prints only the value" {
	with_adc
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null
	run aa update --quiet ad7124_8 spi-max-frequency
	assert_success
	assert_output 'spi-max-frequency = <1000000>;'
}

# Description: update --quiet that creates a child node on a terminal does not ask for its
# required properties; it lists the missing ones and how to set them.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update --quiet ad7124_8 channel@0 on a terminal, typing nothing.
#   3. Check it succeeds without asking for any required property.
#   4. Check it says channel@0 was added, that diff-channels is missing, and the update command
#      that sets it.
# bats test_tags=req:UPDATE-05, id:L0322
@test "update --quiet that creates a child on a terminal asks nothing and lists what is missing" {
	with_adc
	tty_run -- update --quiet ad7124_8 channel@0
	assert_success
	refute_output --partial 'required property to set'
	assert_output --partial 'Added channel@0 to ad7124_8'
	assert_output --partial 'Missing required: diff-channels'
	assert_output --partial 'Set them with: update ad7124_8/channel@0 <property> <value>'
}

# Description: update takes decimal and hexadecimal numbers and devicetree macros, writing
# macros as their numbers and keeping hexadecimal as given.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0, and set interrupt-parent gpio.
#   2. Run update ad7124_8 interrupts 25 IRQ_TYPE_EDGE_FALLING and check it succeeds.
#   3. Set rdy-gpios gpio 26 GPIO_ACTIVE_LOW, and diff-channels 0x2 3 on channel@0.
#   4. Check the overlay has interrupts = <25 2>, rdy-gpios = <&gpio 26 1> and
#      diff-channels = <0x2 3>.
# bats test_tags=req:UPDATE-07, id:L0323
@test "update takes numbers, hexadecimal numbers and macros" {
	with_channel
	aa update ad7124_8 interrupt-parent gpio >/dev/null
	run aa update ad7124_8 interrupts 25 IRQ_TYPE_EDGE_FALLING
	assert_success
	aa update ad7124_8 rdy-gpios gpio 26 GPIO_ACTIVE_LOW >/dev/null
	aa update ad7124_8/channel@0 diff-channels 0x2 3 >/dev/null
	run cat "$WORKFILE"
	assert_output --partial 'interrupts = <25 2>;'
	assert_output --partial 'rdy-gpios = <&gpio 26 1>;'
	assert_output --partial 'diff-channels = <0x2 3>;'
}

# Description: a reference to another node can be given as its label, with or without the &.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Set interrupt-parent gpio, and rdy-gpios '&gpio' 25 0.
#   3. Check the overlay has interrupt-parent = <&gpio> and rdy-gpios = <&gpio 25 0>.
# bats test_tags=req:UPDATE-07, id:L0324
@test "update takes a reference as a label, with or without &" {
	with_adc
	aa update ad7124_8 interrupt-parent gpio >/dev/null
	aa update ad7124_8 rdy-gpios '&gpio' 25 0 >/dev/null
	run cat "$WORKFILE"
	assert_output --partial 'interrupt-parent = <&gpio>;'
	assert_output --partial 'rdy-gpios = <&gpio 25 0>;'
}

# Description: a word is written as a string, and several words as a list of strings.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Set clock-names mclk, and adi,names one two.
#   3. Check the overlay has clock-names = "mclk" and adi,names = "one", "two".
# bats test_tags=req:UPDATE-07, id:L0325
@test "update takes strings, several words giving a string list" {
	with_adc
	aa update ad7124_8 clock-names mclk >/dev/null
	aa update ad7124_8 adi,names one two >/dev/null 2>&1
	run cat "$WORKFILE"
	assert_output --partial 'clock-names = "mclk";'
	assert_output --partial 'adi,names = "one", "two";'
}

# Description: several number tokens make an array, and a comma between them starts a new row of
# a matrix.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0.
#   2. Set diff-channels 0 1 on channel@0.
#   3. Set rdy-gpios gpio 25 GPIO_ACTIVE_LOW, gpio 26 0 on ad7124_8.
#   4. Check the overlay has diff-channels = <0 1> and rdy-gpios = <&gpio 25 1>, <&gpio 26 0>.
# bats test_tags=req:UPDATE-07, id:L0326
@test "update takes an array as several tokens and a matrix with rows separated by commas" {
	with_channel
	aa update ad7124_8/channel@0 diff-channels 0 1 >/dev/null
	aa update ad7124_8 rdy-gpios gpio 25 GPIO_ACTIVE_LOW, gpio 26 0 >/dev/null
	run cat "$WORKFILE"
	assert_output --partial 'diff-channels = <0 1>;'
	assert_output --partial 'rdy-gpios = <&gpio 25 1>, <&gpio 26 0>;'
}

# Description: a property whose binding gives it 64-bit cells is written with /bits/ 64, so dtc
# doesn't truncate it, and a label is refused there, as dtc only takes a reference in a 32-bit
# cell.
# Steps:
#   1. Make the overlay, add an ADF4371 on spi0 (label adf4371) and its child channel@0.
#   2. Set adi,power-up-frequency 8000000000 on channel@0 (a uint64) and check it succeeds.
#   3. Check the overlay has adi,power-up-frequency = /bits/ 64 <8000000000>.
#   4. Snapshot the workfile, run update adf4371/channel@0 adi,power-up-frequency gpio, with
#      --json, and check it is refused (exit 0, .ok false) with the 64-bit message.
#   5. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-07, id:L0354
@test "update writes a 64-bit property with /bits/ 64 and refuses a label in it" {
	with_overlay
	aa add adi,adf4371 --parent spi0 >/dev/null 2>&1 || fail "add adi,adf4371 failed"
	aa update adf4371 channel@0 >/dev/null 2>&1 || fail "update adf4371 channel@0 failed"
	run aa update adf4371/channel@0 adi,power-up-frequency 8000000000
	assert_success
	run cat "$WORKFILE"
	assert_output --partial 'adi,power-up-frequency = /bits/ 64 <8000000000>;'
	snapshot
	run_json update adf4371/channel@0 adi,power-up-frequency gpio
	assert_success
	assert_json '.ok' false
	assert_json '.message' "'gpio' is a label, and adi,power-up-frequency holds 64-bit cells: dtc only takes a reference in a 32-bit cell"
	assert_unchanged
}

# Description: update naming a child node that does not exist creates it, with its reg and
# address cells, and lists its missing required properties.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 channel@1.
#   3. Check it succeeds, says channel@1 was added to ad7124_8 and that diff-channels is missing.
#   4. Check the overlay has a channel@1 node with reg = <1>, and #address-cells = <1> and
#      #size-cells = <0>.
# bats test_tags=req:UPDATE-08, id:L0327
@test "naming a child that does not exist creates the child node" {
	with_adc
	run aa update ad7124_8 channel@1
	assert_success
	assert_output --partial 'Added channel@1 to ad7124_8'
	assert_output --partial 'Missing required: diff-channels'
	run cat "$WORKFILE"
	assert_output --partial 'channel@1 {'
	assert_output --partial 'reg = <1>;'
	assert_output --partial '#address-cells = <1>;'
	assert_output --partial '#size-cells = <0>;'
}

# Description: in JSON, creating a child node reports its path and its missing required
# properties.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 channel@2, with --json.
#   3. Check it succeeds and the message says channel@2 was added to ad7124_8.
#   4. Check .path is the full path of the new node under spi@7e204000.
#   5. Check .missing_required lists diff-channels.
# bats test_tags=req:UPDATE-08, id:L0328
@test "a new child's missing required properties are listed in JSON" {
	with_adc
	run_json update ad7124_8 channel@2
	assert_success
	assert_json '.message' 'Added channel@2 to ad7124_8'
	assert_json '.path | join("/")' 'soc/spi@7e204000/adi,ad7124-8@2/channel@2'
	assert_json '[.missing_required[].property] | join(",")' diff-channels
}

# Description: on a terminal, creating a child node asks for each of its missing required
# properties, and writes the answers.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 channel@0 on a terminal, answering 0 and 1 to the two diff-channels
#      prompts.
#   3. Check it succeeds, said 1 required property was to set, asked for diff-channels and
#      ended with all required properties set.
#   4. Check the overlay has diff-channels = <0 1>.
# bats test_tags=req:UPDATE-08, id:L0329
@test "on a terminal, a new child's missing required properties are asked for" {
	with_adc
	tty_run 'diff-channels 1/2 (number)' $'0\r' 'diff-channels 2/2 (number)' $'1\r' -- update ad7124_8 channel@0
	assert_success
	assert_output --partial '1 required property to set'
	assert_output --partial '[1/1] diff-channels'
	assert_output --partial 'All required properties are set.'
	run cat "$WORKFILE"
	assert_output --partial 'diff-channels = <0 1>;'
}

# Description: a value given for the name of a child node is refused, pointing to the path form
# that sets the child's properties.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0, and snapshot it.
#   2. Run update ad7124_8 channel@0 5, with --json.
#   3. Check it is refused (exit 0, .ok false), the message saying channel@0 is a child node and
#      giving the update ad7124_8/channel@0 command.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-08, id:L0330
@test "a value given for a child node is refused" {
	with_channel
	snapshot
	run_json update ad7124_8 channel@0 5
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'channel@0 is a child node; set its properties with `update ad7124_8/channel@0 <prop> <value>`'
	assert_unchanged
}

# Description: changing a node's reg renames the node, its unit address the new reg in
# hexadecimal.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 reg 10.
#   3. Check it succeeds and says the node was renamed to adi,ad7124-8@a.
#   4. Check the overlay has the node adi,ad7124-8@a, label kept, with reg = <10>.
# bats test_tags=req:UPDATE-09, id:L0331
@test "changing reg changes the node's unit address, in hexadecimal" {
	with_adc
	run aa update ad7124_8 reg 10
	assert_success
	assert_output --partial 'Set reg on ad7124_8; renamed to adi,ad7124-8@a'
	run cat "$WORKFILE"
	assert_output --partial 'ad7124_8: adi,ad7124-8@a {'
	assert_output --partial 'reg = <10>;'
}

# Description: changing a channel's reg renames it with the reg in decimal, as its binding
# names channels.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0.
#   2. Run update ad7124_8/channel@0 reg 12.
#   3. Check it succeeds and says the node was renamed to channel@12.
#   4. Check the overlay has channel@12 and no longer channel@0.
# bats test_tags=req:UPDATE-09, id:L0332
@test "a channel's unit address follows reg in decimal, as its binding names it" {
	with_channel
	run aa update ad7124_8/channel@0 reg 12
	assert_success
	assert_output 'Set reg on ad7124_8/channel@0; renamed to channel@12'
	run cat "$WORKFILE"
	assert_output --partial 'channel@12 {'
	refute_output --partial 'channel@0 {'
}

# Description: a reg change that would give a node the name of a sibling is refused.
# Steps:
#   1. Make the overlay with the AD7124-8 and channel@0, add channel@6, and snapshot it.
#   2. Run update ad7124_8/channel@6 reg 0, with --json.
#   3. Check it is refused (exit 0, .ok false), the message naming a naming conflict.
#   4. Check the workfile is unchanged.
# bats test_tags=req:UPDATE-09, id:L0333
@test "a reg that would give the name of a sibling is refused" {
	with_channel
	aa update ad7124_8 channel@6 >/dev/null
	snapshot
	run_json update ad7124_8/channel@6 reg 0
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'reg update would create a naming conflict; not written'
	assert_unchanged
}

# Description: setting interrupts on a node with no interrupt-parent writes the one it inherits,
# and warns when that controller's cell count differs from the value's.
# Steps:
#   1. Make the overlay with the AD7124-8.
#   2. Run update ad7124_8 interrupts 25 IRQ_TYPE_EDGE_FALLING, with --json.
#   3. Check it succeeds with severity warn, the message saying interrupt-parent = <&gicv2> was
#      set, inherited from /.
#   4. Check standard error warns that gicv2 takes 3 interrupt cells but interrupts has 2.
#   5. Check the overlay has interrupt-parent = <&gicv2>.
# bats test_tags=id:L0334
@test "setting interrupts writes the inherited interrupt-parent, warning when its cells differ" {
	with_adc
	run_json update ad7124_8 interrupts 25 IRQ_TYPE_EDGE_FALLING
	assert_success
	assert_json '.severity' warn
	assert_json '.message' 'Set interrupts on ad7124_8; Set interrupt-parent = <&gicv2> on /soc/spi@7e204000/adi,ad7124-8@2 (inherited from /)'
	[[ "$stderr" == *'gicv2 has #interrupt-cells = <3> but interrupts has 2 cells; set interrupt-parent explicitly'* ]] ||
		fail "no cell-count warning: $stderr"
	run cat "$WORKFILE"
	assert_output --partial 'interrupt-parent = <&gicv2>;'
}
