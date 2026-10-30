# add where the backend is noos.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
}

# `with_adc_drivers`: adds attach-no-os-lib's adc-drivers fixture (driver dualpart, adc and
# dac sides) to module-paths, then creates the workfile.
with_adc_drivers() {
	local file="$PROJECT/.analog-attach/config.json"
	jq --arg adc "$NOOS_FIXTURES/adc-drivers" '.noos["module-paths"] += [$adc]' "$file" >"$file.new" &&
		mv "$file.new" "$file"
	aa init >/dev/null || fail "init failed"
}

# `on_terminal <command> [<expect> <send>]...`: runs the CLI with <command> (one string) on a
# pseudo-terminal; for each pair, waits until the screen shows <expect> (a regexp), then
# types <send> (Python escapes: \r Enter, \x1b[B down, \x03 Ctrl-C). $output is the screen,
# its escape sequences removed; the status is the CLI's.
on_terminal() {
	run python3 - "$CLI_DIR/dist/cli.js" "$@" <<'PY'
import os, pty, re, select, sys, time
cli, command, pairs = sys.argv[1], sys.argv[2], sys.argv[3:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp("sh", ["sh", "-c", f"exec node '{cli}' {command}"])
seen, start = b"", 0
def read(timeout):
    global seen
    r, _, _ = select.select([fd], [], [], timeout)
    if not r:
        return False
    try:
        chunk = os.read(fd, 4096)
    except OSError:
        raise EOFError
    if not chunk:
        raise EOFError
    seen += chunk
    return True
def plain():
    return re.sub(rb"\x1b\[[0-9;?]*[a-zA-Z]", b"", seen).decode("utf-8", "replace")
try:
    for i in range(0, len(pairs), 2):
        expect, send = pairs[i], pairs[i + 1].encode().decode("unicode_escape")
        deadline = time.time() + 20
        while not re.search(expect, plain()[start:]):
            if time.time() > deadline:
                sys.stdout.write(plain()); print(f"\n[timed out waiting for {expect!r}]"); os.kill(pid, 9); sys.exit(124)
            read(0.5)
        start = len(plain())
        time.sleep(0.2)
        os.write(fd, send.encode())
    while True:
        read(20)
except EOFError:
    pass
_, status = os.waitpid(pid, 0)
sys.stdout.write(plain())
sys.exit(os.waitstatus_to_exitcode(status))
PY
}

# bats test_tags=req:ADD-01
@test "add a schema adds a node of that schema and reports its name" {
	aa init >/dev/null
	run_json add test_gpio_pin
	assert_success
	assert_json '.ok' true
	assert_json '.key' test_gpio_pin
	assert_json '.path | join(",")' test_gpio0
	assert_json '.message | startswith("Added '"'"'test_gpio0'"'"' (test_gpio_pin)")' true
	run jq -r '.symbols.test_gpio0["$compatible"]' "$PROJECT/workfile.json"
	assert_output test_gpio_pin
}

# bats test_tags=req:ADD-01
@test "add in human mode writes the name and the workfile" {
	aa init >/dev/null
	run aa add test_gpio_pin
	assert_success
	assert_line --index 0 "Added 'test_gpio0' (test_gpio_pin)"
	assert_line --index 1 "  $PROJECT/workfile.json"
}

# bats test_tags=req:ADD-01
@test "add needs a workfile" {
	run_json add test_gpio_pin
	assert_json '.ok' false
	assert_json '.message' "No workfile at '$PROJECT/workfile.json'. Create one with 'analog-attach init', or point the 'workfile' setting elsewhere."
}

# bats test_tags=req:ADD-02, gap
@test "an unknown key is refused, naming the closest keys" {
	# Gap: the refusal is "Unknown schema 'testpar'. See: analog-attach list devices", naming no key.
	aa init >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json add testpar
	assert_json '.ok' false
	assert_json '.message | startswith("Unknown schema '"'"'testpar'"'"'")' true
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
	assert_json '.message | contains("testpart")' true
}

# bats test_tags=req:ADD-03
@test "--name names the new node" {
	aa init >/dev/null
	run_json add test_gpio_pin --name led_pin
	assert_success
	assert_json '.path | join(",")' led_pin
	run jq -r '.symbols.led_pin["$compatible"]' "$PROJECT/workfile.json"
	assert_output test_gpio_pin
}

# bats test_tags=req:ADD-03, req:ADD-03-CAPI
@test "without --name the name picked is one not taken" {
	aa init >/dev/null
	aa add test_gpio_pin >/dev/null
	run_json add test_gpio_pin
	assert_json '.path | join(",")' test_gpio1
	aa add testpart >/dev/null
	run_json add testpart
	assert_json '.path | join(",")' testpart_1
}

# bats test_tags=req:ADD-03
@test "a taken name is refused" {
	aa init >/dev/null
	aa add test_gpio_pin --name led >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json add test_gpio_pin --name led
	assert_json '.ok' false
	assert_json '.message' "'led' already exists. Pass --name to choose another name."
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
}

# bats test_tags=req:ADD-03
@test "an invalid name is refused" {
	aa init >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json add test_gpio_pin --name 1bad-name
	assert_json '.ok' false
	assert_json '.message' "Symbol '1bad-name' is not a valid C name"
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
}

# bats test_tags=req:ADD-03-CAPI
@test "a schema's default name is its type, numbered" {
	aa init >/dev/null
	run_json add test_gpio_pin
	assert_json '.path | join(",")' test_gpio0
	run_json add test_spi_device
	assert_json '.path | join(",")' test_spi_device0
}

# bats test_tags=req:ADD-03-CAPI
@test "a part's default names are C identifiers made from the part and its role" {
	with_sensor
	run jq -r '.symbols | keys_unsorted | join(",")' "$PROJECT/workfile.json"
	assert_output 'testpart,testpart_cfg,testpart_ip,eval_testpart,testpart_spi_dev,testpart_cs_gpio'
	run jq -r '.symbols | keys | all(test("^[A-Za-z_][A-Za-z0-9_]*$"))' "$PROJECT/workfile.json"
	assert_output true
}

# bats test_tags=req:ADD-04
@test "add a driver adds the part's handle with what it needs" {
	aa init >/dev/null
	run_json add testpart
	assert_success
	assert_json '.path | join(",")' testpart
	assert_json '.message | startswith("Added '"'"'testpart'"'"' (test_sensor, for driver testpart)")' true
	run jq -r '.symbols | to_entries | map(.key + "=" + .value["$compatible"]) | join(",")' "$PROJECT/workfile.json"
	assert_output 'testpart=test_sensor,testpart_cfg=test_sensor_config,testpart_ip=testpart_init_param,testpart_spi_dev=test_spi_device'
}

# bats test_tags=req:ADD-04
@test "add an eval board adds the part, the board's node, and wires it" {
	aa init >/dev/null
	run_json add eval-testpart
	assert_success
	assert_json '.path | join(",")' testpart
	assert_json '.message' "Added 'testpart' (test_sensor, for driver testpart) and 4 nodes below it; the workfile is valid"
	assert_json '.missing_required | length' 0
	run jq -r '.symbols.eval_testpart | .["$compatible"] + ":" + .part' "$PROJECT/workfile.json"
	assert_output 'eval-testpart:testpart'
	run jq -r '.symbols.testpart_spi_dev.cs_gpio' "$PROJECT/workfile.json"
	assert_output testpart_cs_gpio
}

# bats test_tags=req:ADD-05
@test "a driver with several interfaces is refused without --as, naming them" {
	with_adc_drivers
	run_json add dualpart
	assert_json '.ok' false
	assert_json '.message' "Driver 'dualpart' can be added as test_adc or test_dac (test_adc, test_dac). Pass --as test_adc or --as test_dac, or --as test_adc,test_dac for all of them on one chip"
}

# bats test_tags=req:ADD-05
@test "--as picks the interface to add" {
	with_adc_drivers
	run_json add dualpart --as test_dac
	assert_success
	assert_json '.path | join(",")' dualpart_test_dac
	run jq -r '.symbols.dualpart_test_dac["$compatible"]' "$PROJECT/workfile.json"
	assert_output test_dac
	run jq -r '[.symbols[] | select(.["$compatible"] == "test_adc")] | length' "$PROJECT/workfile.json"
	assert_output 0
}

# bats test_tags=req:ADD-05
@test "--as with several interfaces adds them all on one chip" {
	with_adc_drivers
	run_json add dualpart --as test_adc,test_dac --name dp
	assert_success
	assert_json '.path | join(",")' dp
	run jq -r '.symbols.dp["$compatible"] + "," + .symbols.dualpart_test_dac["$compatible"]' "$PROJECT/workfile.json"
	assert_output test_adc,test_dac
	# one chip: both sides' configurations share one init_param
	run jq -r '.symbols as $s | [$s.dp["$init_param"], $s.dualpart_test_dac["$init_param"]] | map($s[.].extra) | unique | length' "$PROJECT/workfile.json"
	assert_output 1
}

# bats test_tags=req:ADD-05
@test "--as refuses an interface the driver does not have, and a schema" {
	with_adc_drivers
	run_json add dualpart --as nope
	assert_json '.ok' false
	assert_json '.message' "Driver 'dualpart' cannot be added as 'nope'. It can be: test_adc, test_dac"
	run aa add test_gpio_pin --as test_adc
	assert_failure 2
	assert_output --partial "--as picks a driver's interface, and 'test_gpio_pin' is a schema, not a driver"
}

# bats test_tags=req:ADD-10
@test "add fills in defaults and only values, and reports them" {
	with_sensor
	run jq -c '.symbols.testpart_spi_dev | {max_speed_hz, mode}' "$PROJECT/workfile.json"
	assert_output '{"max_speed_hz":1000000,"mode":"TEST_SPI_MODE_0"}'
	rm "$PROJECT/workfile.json"
	aa init >/dev/null
	run aa add eval-testpart
	assert_success
	assert_line 'Bootstrap filled in defaults, values with only one option, and the nodes they need:'
	assert_line --regexp '^  \+ testpart_spi_dev +\(test_spi_device\) for testpart_ip\.comm_init\.spi_dev$'
	assert_line --regexp '^  = testpart_spi_dev\.max_speed_hz +1000000 \(default\)$'
	assert_line --regexp '^  = testpart_spi_dev\.mode +TEST_SPI_MODE_0 \(only value\)$'
	assert_line 'The workfile is valid.'
}

# bats test_tags=req:ADD-10
@test "add reports what is left for the user" {
	aa init >/dev/null
	run_json add testpart
	assert_success
	assert_json '[.missing_required[] | .node + "." + .property] | join(",")' \
		'testpart_spi_dev.controller,testpart_spi_dev.native_cs,testpart_spi_dev.cs_gpio'
	assert_json '[.missing_required[0].suggestions[].value] | join(",")' 'bsp_test_spi_cfg_handle,bsp_test_spi2_cfg_handle'
	rm "$PROJECT/workfile.json"
	aa init >/dev/null
	run aa add testpart
	assert_line 'Bootstrap stopped at what is a choice - pick one each:'
	assert_line 'Still yours to set - required, and nothing to fill them from:'
	assert_line '3 problems left. Run: analog-attach validate'
}

# bats test_tags=req:ADD-11
@test "on a terminal, add asks for what is left, offering the values, and saves the answers" {
	new_project noos interview=true
	aa init >/dev/null
	on_terminal "add testpart" \
		'testpart_spi_dev\.controller: pick one' '\x1b[B\r' \
		'testpart_spi_dev\.native_cs \(number\)' '2\r'
	assert_success
	assert_output --partial 'A few things only you can tell'
	assert_output --partial 'bsp_test_spi2_cfg_handle'
	assert_output --partial '✓ testpart_spi_dev.controller = bsp_test_spi2_cfg_handle'
	assert_output --partial '✓ testpart_spi_dev.native_cs = 2'
	run jq -c '.symbols.testpart_spi_dev | {controller, native_cs}' "$PROJECT/workfile.json"
	assert_output '{"controller":"bsp_test_spi2_cfg_handle","native_cs":2}'
}

# bats test_tags=req:ADD-11
@test "on a terminal, each answer is saved at once, even when the interview is stopped" {
	new_project noos interview=true
	aa init >/dev/null
	on_terminal "add testpart" \
		'testpart_spi_dev\.controller: pick one' '\r' \
		'testpart_spi_dev\.native_cs \(number\)' '\x03'
	assert_success
	assert_output --partial 'Stopped.'
	run jq -r '.symbols.testpart_spi_dev.controller' "$PROJECT/workfile.json"
	assert_output bsp_test_spi_cfg_handle
}

# bats test_tags=req:ADD-12
@test "with --quiet, add on a terminal asks nothing and lists what is missing" {
	new_project noos interview=true
	aa init >/dev/null
	on_terminal "add testpart --quiet"
	assert_success
	refute_output --partial 'A few things only you can tell'
	refute_output --partial ': pick one'
	assert_output --partial 'Still yours to set - required, and nothing to fill them from:'
	assert_output --regexp 'testpart_spi_dev\.native_cs +number'
	assert_output --partial '3 problems left. Run: analog-attach validate'
}

# bats test_tags=req:ADD-12
@test "with --quiet, add lists the missing values in JSON" {
	new_project noos interview=true
	aa init >/dev/null
	run_json add testpart --quiet
	assert_success
	assert_json '.missing_required | length' 3
	assert_json '.missing_required[1].property' native_cs
}

# bats test_tags=req:ADD-13
@test "add completes the device keys" {
	aa init >/dev/null
	run aa __complete -- add ""
	assert_success
	assert_line eval-testpart
	assert_line testpart
	assert_line test_gpio_pin
	run aa __complete -- add eval
	assert_success
	assert_output eval-testpart
}

# bats test_tags=req:ADD-13
@test "add completes its flags" {
	aa init >/dev/null
	run aa __complete -- add test_gpio_pin --
	assert_success
	assert_line --regexp $'^--name\t'
	assert_line --regexp $'^--quiet\t'
	assert_line --regexp $'^--as\t'
}

# bats test_tags=req:ADD-13, gap
@test "add completes the values of --as" {
	# Gap: `add dualpart --as <Tab>` offers nothing.
	with_adc_drivers
	run aa __complete -- add dualpart --as ""
	assert_success
	assert_output --partial test_adc
	assert_output --partial test_dac
}
