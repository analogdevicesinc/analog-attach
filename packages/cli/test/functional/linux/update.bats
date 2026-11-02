# update where the backend is linux: an AD7124-8 (channel child nodes) on spi0 of the RPi 4.

# bats file_tags=eco:linux

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

# bats test_tags=req:UPDATE-01
@test "update sets a property to the value given" {
	with_adc
	run_json update ad7124_8 spi-max-frequency 1000000
	assert_success
	assert_json '.ok' true
	assert_json '.message' 'Set spi-max-frequency on ad7124_8'
	run cat "$WORKFILE"
	assert_output --partial 'spi-max-frequency = <1000000>;'
}

# bats test_tags=req:UPDATE-01
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

# bats test_tags=req:UPDATE-01
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

# bats test_tags=req:UPDATE-02
@test "update refuses a word that is not a number, a macro or a label" {
	with_adc
	snapshot
	run_json update ad7124_8 interrupts foo
	assert_success
	assert_json '.ok' false
	assert_json '.message' "'foo' is not a number, a known macro, or a label in the base tree/overlay"
	assert_unchanged
}

# bats test_tags=req:UPDATE-02
@test "update refuses a value for a flag" {
	with_channel
	snapshot
	run_json update ad7124_8/channel@0 bipolar 1
	assert_success
	assert_json '.ok' false
	assert_json '.message | startswith("bipolar is a flag")' true
	assert_unchanged
}

# Gap: a property the binding doesn't define is written, with only a diagnostic on standard error
# (`Property nosuch-prop not defined by adi,ad7124-8 binding; written without schema validation`).
# bats test_tags=req:UPDATE-02, gap
@test "update refuses a property the binding does not have" {
	with_adc
	snapshot
	run_json update ad7124_8 nosuch-prop 5
	assert_success
	assert_json '.ok' false
	assert_unchanged
}

# Gap: the binding gives only a shape hint: a value outside the enum (adi,reference-select is one
# of 0, 1, 3) is written.
# bats test_tags=req:UPDATE-02, gap
@test "update refuses a value that is not one of an enum's options" {
	with_channel
	snapshot
	run_json update ad7124_8/channel@0 adi,reference-select 2
	assert_success
	assert_json '.ok' false
	assert_unchanged
}

# Gap: a channel's reg above the binding's maximum (15) is written, and the node renamed channel@20.
# bats test_tags=req:UPDATE-02, gap
@test "update refuses a number above the maximum" {
	with_channel
	snapshot
	run_json update ad7124_8/channel@0 reg 20
	assert_success
	assert_json '.ok' false
	assert_unchanged
}

# Gap: an array longer than the binding allows is written, with `warning: diff-channels takes 2
# values, got 3` on standard error.
# bats test_tags=req:UPDATE-02, gap
@test "update refuses an array longer than its size" {
	with_channel
	snapshot
	run_json update ad7124_8/channel@0 diff-channels 1 2 3
	assert_success
	assert_json '.ok' false
	assert_unchanged
}

# bats test_tags=req:UPDATE-03
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

# bats test_tags=req:UPDATE-03
@test "update without a value changes nothing when it reads" {
	with_adc
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null
	snapshot
	run aa update ad7124_8 spi-max-frequency
	assert_success
	assert_unchanged
}

# bats test_tags=req:UPDATE-03-LNX
@test "update without a value sets a flag the binding defines" {
	with_channel
	run aa update ad7124_8/channel@0 bipolar
	assert_success
	assert_output 'Set flag bipolar on ad7124_8/channel@0'
	run grep -x $'\t*bipolar;' "$WORKFILE"
	assert_success
}

# bats test_tags=req:UPDATE-03-LNX
@test "update without a value sets a property the node does not have as a flag" {
	with_adc
	run_json update ad7124_8 adi,some-flag
	assert_success
	assert_json '.message' 'Set flag adi,some-flag on ad7124_8'
	run grep -x $'\t*adi,some-flag;' "$WORKFILE"
	assert_success
}

# Gap: --suggest is a flag of the noos backend only: `No flag registered for --suggest`, exit 2.
# bats test_tags=req:UPDATE-04, gap
@test "update --suggest lists the values instead of setting the property" {
	with_adc
	snapshot
	run_json update ad7124_8 interrupt-parent --suggest
	assert_success
	assert_json '[.suggestions.values[].value] | index("gpio") != null' true
	assert_unchanged
}

# bats test_tags=req:UPDATE-05
@test "update --quiet without a value prints only the value" {
	with_adc
	aa update ad7124_8 spi-max-frequency 1000000 >/dev/null
	run aa update --quiet ad7124_8 spi-max-frequency
	assert_success
	assert_output 'spi-max-frequency = <1000000>;'
}

# bats test_tags=req:UPDATE-05
@test "update --quiet that creates a child on a terminal asks nothing and lists what is missing" {
	with_adc
	tty_run -- update --quiet ad7124_8 channel@0
	assert_success
	refute_output --partial 'required property to set'
	assert_output --partial 'Added channel@0 to ad7124_8'
	assert_output --partial 'Missing required: diff-channels'
	assert_output --partial 'Set them with: update ad7124_8/channel@0 <property> <value>'
}

# bats test_tags=req:UPDATE-07
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

# bats test_tags=req:UPDATE-07
@test "update takes a reference as a label, with or without &" {
	with_adc
	aa update ad7124_8 interrupt-parent gpio >/dev/null
	aa update ad7124_8 rdy-gpios '&gpio' 25 0 >/dev/null
	run cat "$WORKFILE"
	assert_output --partial 'interrupt-parent = <&gpio>;'
	assert_output --partial 'rdy-gpios = <&gpio 25 0>;'
}

# bats test_tags=req:UPDATE-07
@test "update takes strings, several words giving a string list" {
	with_adc
	aa update ad7124_8 clock-names mclk >/dev/null
	aa update ad7124_8 adi,names one two >/dev/null 2>&1
	run cat "$WORKFILE"
	assert_output --partial 'clock-names = "mclk";'
	assert_output --partial 'adi,names = "one", "two";'
}

# bats test_tags=req:UPDATE-07
@test "update takes an array as several tokens and a matrix with rows separated by commas" {
	with_channel
	aa update ad7124_8/channel@0 diff-channels 0 1 >/dev/null
	aa update ad7124_8 rdy-gpios gpio 25 GPIO_ACTIVE_LOW, gpio 26 0 >/dev/null
	run cat "$WORKFILE"
	assert_output --partial 'diff-channels = <0 1>;'
	assert_output --partial 'rdy-gpios = <&gpio 25 1>, <&gpio 26 0>;'
}

# bats test_tags=req:UPDATE-08
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

# bats test_tags=req:UPDATE-08
@test "a new child's missing required properties are listed in JSON" {
	with_adc
	run_json update ad7124_8 channel@2
	assert_success
	assert_json '.message' 'Added channel@2 to ad7124_8'
	assert_json '.path | join("/")' 'soc/spi@7e204000/adi,ad7124-8@2/channel@2'
	assert_json '[.missing_required[].property] | join(",")' diff-channels
}

# bats test_tags=req:UPDATE-08
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

# bats test_tags=req:UPDATE-08
@test "a value given for a child node is refused" {
	with_channel
	snapshot
	run_json update ad7124_8 channel@0 5
	assert_success
	assert_json '.ok' false
	assert_json '.message' 'channel@0 is a child node; set its properties with `update ad7124_8/channel@0 <prop> <value>`'
	assert_unchanged
}

# bats test_tags=req:UPDATE-09
@test "changing reg changes the node's unit address, in hexadecimal" {
	with_adc
	run aa update ad7124_8 reg 10
	assert_success
	assert_output --partial 'Set reg on ad7124_8; renamed to adi,ad7124-8@a'
	run cat "$WORKFILE"
	assert_output --partial 'ad7124_8: adi,ad7124-8@a {'
	assert_output --partial 'reg = <10>;'
}

# bats test_tags=req:UPDATE-09
@test "a channel's unit address follows reg in decimal, as its binding names it" {
	with_channel
	run aa update ad7124_8/channel@0 reg 12
	assert_success
	assert_output 'Set reg on ad7124_8/channel@0; renamed to channel@12'
	run cat "$WORKFILE"
	assert_output --partial 'channel@12 {'
	refute_output --partial 'channel@0 {'
}

# bats test_tags=req:UPDATE-09
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
