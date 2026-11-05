# add where the backend is noos.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet.
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

# Description: adding a schema creates a node of that schema and reports the node's name.
# Steps:
#   1. Create the workfile with init.
#   2. Add the test_gpio_pin schema, with --json.
#   3. Check it succeeds and reports the schema and the new node's name, test_gpio0.
#   4. Check the workfile has the node test_gpio0, of that schema.
# bats test_tags=req:ADD-01, id:N0001
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

# Description: in human mode, add says what it added and where it wrote it.
# Steps:
#   1. Create the workfile with init.
#   2. Add the test_gpio_pin schema, without --json.
#   3. Check it succeeds, naming the new node and its schema, then the workfile's path.
# bats test_tags=req:ADD-01, id:N0002
@test "add in human mode writes the name and the workfile" {
	aa init >/dev/null
	run aa add test_gpio_pin
	assert_success
	assert_line --index 0 "Added 'test_gpio0' (test_gpio_pin)"
	assert_line --index 1 "  $PROJECT/workfile.json"
}

# Description: add refuses to run without a workfile, and says how to create one.
# Steps:
#   1. Add a valid schema, with --json, before any init.
#   2. Check it is refused (.ok false).
#   3. Check the message says there is no workfile and points to init or the workfile setting.
# bats test_tags=req:ADD-01, id:N0003
@test "add needs a workfile" {
	run_json add test_gpio_pin
	assert_json '.ok' false
	assert_json '.message' "No workfile at '$PROJECT/workfile.json'. Create one with 'analog-attach init', or point the 'workfile' setting elsewhere."
}

# Description: an unknown schema is refused, the workfile is left as it was, and the closest
# known keys are suggested.
# Steps:
#   1. Create the workfile with init.
#   2. Add a mistyped schema (testpar), with --json.
#   3. Check it is refused, naming the unknown schema.
#   4. Check the workfile didn't change.
#   5. Check the message suggests the closest key, testpart.
# bats test_tags=req:ADD-02, id:N0004
@test "an unknown key is refused, naming the closest keys" {
	aa init >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json add testpar
	assert_json '.ok' false
	assert_json '.message | startswith("Unknown schema '"'"'testpar'"'"'")' true
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
	assert_json '.message | contains("testpart")' true
}

# Description: --name gives the new node the name asked for.
# Steps:
#   1. Create the workfile with init.
#   2. Add test_gpio_pin --name led_pin, with --json.
#   3. Check it succeeds and reports the node led_pin.
#   4. Check the workfile has led_pin, of schema test_gpio_pin.
# bats test_tags=req:ADD-03, id:N0005
@test "--name names the new node" {
	aa init >/dev/null
	run_json add test_gpio_pin --name led_pin
	assert_success
	assert_json '.path | join(",")' led_pin
	run jq -r '.symbols.led_pin["$compatible"]' "$PROJECT/workfile.json"
	assert_output test_gpio_pin
}

# Description: without --name, add picks the next free name, for a schema and for a driver alike.
# Steps:
#   1. Create the workfile with init and add test_gpio_pin once.
#   2. Add test_gpio_pin again, with --json; check the new node is test_gpio1.
#   3. Add testpart once, then again with --json; check the second one is testpart_1.
# bats test_tags=req:ADD-03, req:ADD-03-CAPI, id:N0006
@test "without --name the name picked is one not taken" {
	aa init >/dev/null
	aa add test_gpio_pin >/dev/null
	run_json add test_gpio_pin
	assert_json '.path | join(",")' test_gpio1
	aa add testpart >/dev/null
	run_json add testpart
	assert_json '.path | join(",")' testpart_1
}

# Description: a name already in the workfile is refused, and the workfile is left as it was.
# Steps:
#   1. Create the workfile with init and add test_gpio_pin --name led.
#   2. Snapshot the workfile.
#   3. Add test_gpio_pin --name led again, with --json.
#   4. Check it is refused (.ok false), saying led exists and pointing to --name.
#   5. Check the workfile didn't change.
# bats test_tags=req:ADD-03, id:N0007
@test "a taken name is refused" {
	aa init >/dev/null
	aa add test_gpio_pin --name led >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json add test_gpio_pin --name led
	assert_json '.ok' false
	assert_json '.message' "'led' already exists. Pass --name to choose another name."
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
}

# Description: a name that is not a valid C identifier is refused, and the workfile is left as
# it was.
# Steps:
#   1. Create the workfile with init and snapshot it.
#   2. Add test_gpio_pin --name 1bad-name, with --json.
#   3. Check it is refused (.ok false), saying the name is not a valid C name.
#   4. Check the workfile didn't change.
# bats test_tags=req:ADD-03, id:N0008
@test "an invalid name is refused" {
	aa init >/dev/null
	cp "$PROJECT/workfile.json" "$BATS_TEST_TMPDIR/before.json"
	run_json add test_gpio_pin --name 1bad-name
	assert_json '.ok' false
	assert_json '.message' "Symbol '1bad-name' is not a valid C name"
	cmp "$BATS_TEST_TMPDIR/before.json" "$PROJECT/workfile.json"
}

# Description: a schema's node is named after its type, with a number after it.
# Steps:
#   1. Create the workfile with init.
#   2. Add test_gpio_pin, with --json; check the node is test_gpio0.
#   3. Add test_spi_device, with --json; check the node is test_spi_device0.
# bats test_tags=req:ADD-03-CAPI, id:N0009
@test "a schema's default name is its type, numbered" {
	aa init >/dev/null
	run_json add test_gpio_pin
	assert_json '.path | join(",")' test_gpio0
	run_json add test_spi_device
	assert_json '.path | join(",")' test_spi_device0
}

# Description: the nodes added for an eval board are named from the part and each node's role,
# and every name is a valid C identifier.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Check the workfile's nodes are, in order, testpart, testpart_cfg, testpart_ip,
#      eval_testpart, testpart_spi_dev and testpart_cs_gpio.
#   3. Check every name matches the C identifier pattern.
# bats test_tags=req:ADD-03-CAPI, id:N0010
@test "a part's default names are C identifiers made from the part and its role" {
	with_sensor
	run jq -r '.symbols | keys_unsorted | join(",")' "$PROJECT/workfile.json"
	assert_output 'testpart,testpart_cfg,testpart_ip,eval_testpart,testpart_spi_dev,testpart_cs_gpio'
	run jq -r '.symbols | keys | all(test("^[A-Za-z_][A-Za-z0-9_]*$"))' "$PROJECT/workfile.json"
	assert_output true
}

# Description: adding a driver adds the part's node, with the configuration, init_param and SPI
# device nodes it needs.
# Steps:
#   1. Create the workfile with init.
#   2. Add testpart, with --json.
#   3. Check it succeeds, reporting the node testpart, of test_sensor, for driver testpart.
#   4. Check the workfile has testpart, testpart_cfg, testpart_ip and testpart_spi_dev, each of
#      the expected schema.
# bats test_tags=req:ADD-04, id:N0011
@test "add a driver adds the part's handle with what it needs" {
	aa init >/dev/null
	run_json add testpart
	assert_success
	assert_json '.path | join(",")' testpart
	assert_json '.message | startswith("Added '"'"'testpart'"'"' (test_sensor, for driver testpart)")' true
	run jq -r '.symbols | to_entries | map(.key + "=" + .value["$compatible"]) | join(",")' "$PROJECT/workfile.json"
	assert_output 'testpart=test_sensor,testpart_cfg=test_sensor_config,testpart_ip=testpart_init_param,testpart_spi_dev=test_spi_device'
}

# Description: adding an eval board adds the part, the board's node, and wires them on the
# target, leaving a valid workfile.
# Steps:
#   1. Create the workfile with init.
#   2. Add eval-testpart, with --json.
#   3. Check it succeeds, reporting testpart, 4 nodes below it and a valid workfile, with nothing
#      required left.
#   4. Check the workfile has the eval_testpart node for the part testpart.
#   5. Check testpart_spi_dev's cs_gpio is testpart_cs_gpio.
# bats test_tags=req:ADD-04, id:N0012
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

# Description: a driver with several interfaces is refused without --as, and the message names
# the interfaces and how to pick them.
# Steps:
#   1. Add the adc-drivers fixture to module-paths and create the workfile.
#   2. Add dualpart, with --json.
#   3. Check it is refused (.ok false), naming test_adc and test_dac and the --as choices.
# bats test_tags=req:ADD-05, id:N0013
@test "a driver with several interfaces is refused without --as, naming them" {
	with_adc_drivers
	run_json add dualpart
	assert_json '.ok' false
	assert_json '.message' "Driver 'dualpart' can be added as test_adc or test_dac (test_adc, test_dac). Pass --as test_adc or --as test_dac, or --as test_adc,test_dac for all of them on one chip"
}

# Description: --as adds only the interface asked for.
# Steps:
#   1. Add the adc-drivers fixture to module-paths and create the workfile.
#   2. Add dualpart --as test_dac, with --json.
#   3. Check it succeeds, reporting the node dualpart_test_dac.
#   4. Check that node is of test_dac, and the workfile has no test_adc node.
# bats test_tags=req:ADD-05, id:N0014
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

# Description: --as with several interfaces adds one node per interface, on one chip.
# Steps:
#   1. Add the adc-drivers fixture to module-paths and create the workfile.
#   2. Add dualpart --as test_adc,test_dac --name dp, with --json.
#   3. Check it succeeds, reporting the node dp.
#   4. Check dp is of test_adc and dualpart_test_dac of test_dac.
#   5. Check both share one init_param.
# bats test_tags=req:ADD-05, id:N0015
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

# Description: --as refuses an interface the driver doesn't have, and is a usage error on a
# schema.
# Steps:
#   1. Add the adc-drivers fixture to module-paths and create the workfile.
#   2. Add dualpart --as nope, with --json.
#   3. Check it is refused (.ok false), listing the interfaces dualpart has.
#   4. Add test_gpio_pin --as test_adc.
#   5. Check it fails with a usage error (exit 2), saying --as is for drivers and test_gpio_pin
#      is a schema.
# bats test_tags=req:ADD-05, id:N0016
@test "--as refuses an interface the driver does not have, and a schema" {
	with_adc_drivers
	run_json add dualpart --as nope
	assert_json '.ok' false
	assert_json '.message' "Driver 'dualpart' cannot be added as 'nope'. It can be: test_adc, test_dac"
	run aa add test_gpio_pin --as test_adc
	assert_failure 2
	assert_output --partial "--as picks a driver's interface, and 'test_gpio_pin' is a schema, not a driver"
}

# Description: add fills in default values and values with only one option, and reports each
# with where it came from.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Check testpart_spi_dev has max_speed_hz 1000000 and mode TEST_SPI_MODE_0.
#   3. Remove the workfile, create it again with init, and add eval-testpart without --json.
#   4. Check it succeeds and lists the added testpart_spi_dev, max_speed_hz as a default, mode as
#      the only value, and says the workfile is valid.
# bats test_tags=req:ADD-10, id:N0017
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

# Description: add reports the required values it could not fill in, with suggestions where
# there are some.
# Steps:
#   1. Create the workfile with init.
#   2. Add testpart, with --json.
#   3. Check it succeeds, listing controller, native_cs and cs_gpio of testpart_spi_dev as
#      missing, and the two SPI controllers as suggestions for the first.
#   4. Remove the workfile, create it again, and add testpart without --json.
#   5. Check the output lists the choices to make, the values left to set, and 3 problems left,
#      pointing to validate.
# bats test_tags=req:ADD-10, id:N0018
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

# Description: on a terminal, add asks for the values left, offering the choices, and saves the
# answers in the workfile.
# Steps:
#   1. Make a project with interview on, and create the workfile with init.
#   2. Run add testpart on a terminal; pick the second controller, and type 2 for native_cs.
#   3. Check it succeeds, showing the interview, the offered bsp_test_spi2_cfg_handle, and both
#      answers.
#   4. Check the workfile has controller bsp_test_spi2_cfg_handle and native_cs 2.
# bats test_tags=req:ADD-11, id:N0019
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

# Description: on a terminal, an answer is saved as soon as it is given, even when the
# interview is stopped with Ctrl-C.
# Steps:
#   1. Make a project with interview on, and create the workfile with init.
#   2. Run add testpart on a terminal; pick the first controller, then press Ctrl-C at native_cs.
#   3. Check it succeeds and says it stopped.
#   4. Check the workfile has controller bsp_test_spi_cfg_handle.
# bats test_tags=req:ADD-11, id:N0020
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

# Description: with --quiet, add on a terminal asks no question and lists what is missing
# instead.
# Steps:
#   1. Make a project with interview on, and create the workfile with init.
#   2. Run add testpart --quiet on a terminal.
#   3. Check it succeeds and shows no interview and no question.
#   4. Check it lists the values left to set, native_cs among them, and 3 problems left.
# bats test_tags=req:ADD-12, id:N0021
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

# Description: with --quiet and --json, add lists the missing values in the result.
# Steps:
#   1. Make a project with interview on, and create the workfile with init.
#   2. Add testpart --quiet, with --json.
#   3. Check it succeeds, with 3 missing values, the second one native_cs.
# bats test_tags=req:ADD-12, id:N0022
@test "with --quiet, add lists the missing values in JSON" {
	new_project noos interview=true
	aa init >/dev/null
	run_json add testpart --quiet
	assert_success
	assert_json '.missing_required | length' 3
	assert_json '.missing_required[1].property' native_cs
}

# Description: completion of add offers the device keys, and narrows them to the typed prefix.
# Steps:
#   1. Create the workfile with init.
#   2. Complete add with an empty word; check it offers eval-testpart, testpart and test_gpio_pin.
#   3. Complete add eval; check it offers only eval-testpart.
# bats test_tags=req:ADD-13, id:N0023
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

# Description: completion of add offers its flags.
# Steps:
#   1. Create the workfile with init.
#   2. Complete add test_gpio_pin --.
#   3. Check it succeeds, offering --name, --quiet and --as.
# bats test_tags=req:ADD-13, id:N0024
@test "add completes its flags" {
	aa init >/dev/null
	run aa __complete -- add test_gpio_pin --
	assert_success
	assert_line --regexp $'^--name\t'
	assert_line --regexp $'^--quiet\t'
	assert_line --regexp $'^--as\t'
}

# Description: completion of add's --as offers the driver's interfaces.
# Steps:
#   1. Add the adc-drivers fixture to module-paths and create the workfile.
#   2. Complete add dualpart --as with an empty word.
#   3. Check it succeeds, offering test_adc and test_dac.
# bats test_tags=req:ADD-13, id:N0025
@test "add completes the values of --as" {
	with_adc_drivers
	run aa __complete -- add dualpart --as ""
	assert_success
	assert_output --partial test_adc
	assert_output --partial test_dac
}

# Description: add of an eval board gives its wiring in JSON too: each pin of the part to the
# board pin it goes to, and how the chip-select is driven, as human mode prints them.
# Steps:
#   1. Create the workfile with init.
#   2. Add eval-testpart, with --json.
#   3. Check wiring has one SPI bus for testpart_spi_dev on bsp_test_spi_cfg, with four
#      connections, the eval board's P1 pin 1 (spi_cs) going to the board's H1 pin 4 (O1_4).
#   4. Check chip_selects gives testpart_spi_dev's chip-select as GPIO OTHER_GPIO1 pin 4, at H1 pin
#      4, through the pin node testpart_cs_gpio.
#   5. Add a schema with nothing to wire (test_gpio_pin), with --json; check wiring and
#      chip_selects are empty.
# bats test_tags=req:ADD-04, req:GEN-07, id:N0280
@test "add gives the wiring in JSON too" {
	aa init >/dev/null
	run_json add eval-testpart
	assert_success
	assert_json '.wiring | length' 1
	assert_json '.wiring[0] | [.device, .interface, .peripheral] | join(" ")' "testpart_spi_dev spi bsp_test_spi_cfg"
	assert_json '.wiring[0].connections | length' 4
	assert_json '.wiring[0].connections[] | select(.role == "spi_cs") | "\(.from.connector) \(.from.pin) -> \(.to.connector) \(.to.pin) (\(.to.chip_pin))"' \
		"P1 1 -> H1 4 (O1_4)"
	assert_json '.chip_selects[0] | [.device, .kind, .gpio.port, .gpio.number, .at.connector, .at.pin, .pin_node] | map(tostring) | join(" ")' \
		"testpart_spi_dev gpio OTHER_GPIO1 4 H1 4 testpart_cs_gpio"
	run_json add test_gpio_pin
	assert_json '[.wiring, .chip_selects] | map(length) | join(",")' "0,0"
}
