import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attach_eval_board, bootstrap, referenced_nodes } from '../../src/bootstrap/bootstrap';
import { load_resolved_ruleset, load_resolved_ruleset_for_board, resolve_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { validate_workfile } from '../../src/validator/validator';
import {
    add_symbol,
    create_workfile,
    export_minimal,
    import_minimal,
    materialize_hidden,
    clear_value,
    mark_auto,
    set_value,
    suggest_for_property,
} from '../../src/workfile_handler/workfile_handler';
import { build_extern_index } from '../../src/registry/hidden';
import type { Workfile } from '../../src/workfile_handler/types';
import type { RulesetStruct } from '../../src/ruleset_parser/types';
import {
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_BOARD,
    FIXTURE_SOC,
} from '../test_utilities';

// Bootstrap fills a workfile wherever there is no room for choice: a property with one
// sensible value takes it, and a required reference with exactly one option gets it. The
// fixture chain mirrors ADXL355-on-max32655fthr: a generic sensor handle, whose config
// names only the interface, a driver behind it, its bus device, the controller, and the
// board's own SPI config at the bottom.

// `null` for no board: passing `undefined` would just select the default parameter.
function workfile_with(root: string, board: string | null = FIXTURE_BOARD, soc: string = FIXTURE_SOC): Workfile {
    const created = create_workfile(soc);
    expectOk(created);
    if (board !== null) {
        created.value.board = board;
    }
    const ruleset = load_resolved_ruleset(root);
    expectOk(ruleset);
    expectOk(add_symbol(created.value, root, ruleset.value));
    // The part sits on its eval board, so its pinout wires it (a bare part would not be).
    if (root === 'test_sensor') {
        expectOk(attach_eval_board(created.value, 'eval-testpart', root));
    }
    return created.value;
}

function add(workfile: Workfile, name: string, symbol: string): void {
    const ruleset = load_resolved_ruleset_for_board(symbol, workfile.board);
    expectOk(ruleset);
    expectOk(add_symbol(workfile, name, ruleset.value));
}

function stored(workfile: Workfile): Record<string, Record<string, unknown>> {
    const exported = export_minimal(workfile);
    expectOk(exported);
    return exported.value.symbols as Record<string, Record<string, unknown>>;
}

describe('an include keeps its own default', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test("the part's default wins over the enum type's", () => {
        // testpart_comm_type defaults to TESTPART_NONE; testpart_init_param says TESTPART_SPI.
        const resolved = load_resolved_ruleset('testpart_init_param');
        expectOk(resolved);
        const comm_type = (resolved.value as RulesetStruct).properties.find(property => property.name === 'comm_type');
        expect(comm_type?._t).toBe('EnumProperty');
        expect(comm_type?._t === 'EnumProperty' && comm_type.default).toBe('TESTPART_SPI');
    });

    test('a default outside the enum is reported, not carried', () => {
        const parsed = parse_ruleset(`$type: struct\n$symbol: t\nmode: {include: test_spi_mode, default: NOPE}\n`);
        expectOk(parsed);
        expectErrorContains(resolve_ruleset(parsed.value), "Default 'NOPE' of 'mode' is not a value of test_spi_mode");
    });

    test('a default on an include of a struct is refused', () => {
        const parsed = parse_ruleset(`$type: struct\n$symbol: t\ndev: {include: test_spi_config, default: x}\n`);
        expectOk(parsed);
        expectErrorContains(resolve_ruleset(parsed.value), 'which is not an enum, so it cannot have a default');
    });
});

describe('bootstrap from one node', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('builds the whole chain down to the board', () => {
        const workfile = workfile_with('test_sensor');
        const report = bootstrap(workfile);
        expectOk(report);

        expect(report.value.linked.map(link => `${link.node}.${link.property}${link.member === undefined ? '' : `.${link.member}`} -> ${link.target}${link.hidden ? ' [hidden]' : ''}`)).toEqual([
            'test_sensor.$init_param -> test_sensor_config',
            'test_sensor_config.extra -> testpart_init_param',
            // The driver's ops table is an extern: hidden, named by its own symbol.
            'test_sensor_config.ops -> testpart_ops [hidden]',
            'testpart_init_param.comm_init.spi_dev -> test_spi_device',
            // The handle wrapping the board's own SPI config, not a fresh controller.
            'test_spi_device.controller -> bsp_test_spi_cfg_handle [hidden]',
        ]);
    });

    test('fills defaults, override defaults and only-values', () => {
        const workfile = workfile_with('test_sensor');
        const report = bootstrap(workfile);
        expectOk(report);

        // In the order the steps happened: filling comm_type pins the union member, which
        // creates the bus device, whose values come before the part's remaining dev_ready.
        expect(report.value.filled.map(fill => `${fill.node}.${fill.property} = ${String(fill.value)} [${fill.from}]`)).toEqual([
            'testpart_init_param.comm_type = TESTPART_SPI [default]',
            // From the part's override on its bus device, not from the device's own schema.
            'test_spi_device.max_speed_hz = 1000000 [default]',
            // The part's override leaves exactly one mode.
            'test_spi_device.mode = TEST_SPI_MODE_0 [only value]',
            'testpart_init_param.dev_ready = true [default]',
            // Last: the chip-select, once nothing else applies. PMOD pin 1 is native line 0.
            'test_spi_device.native_cs = 1 [only value]',
        ]);
    });

    test('the result is a valid workfile', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        const result = validate_workfile(workfile);
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
    });

    test('bootstrapped nodes and values are stored', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));

        const symbols = stored(workfile);
        // Every value bootstrap wrote is listed as its own.
        expect(symbols['test_spi_device']).toEqual({
            $compatible: 'test_spi_device',
            $auto: ['controller', 'max_speed_hz', 'mode', 'native_cs'],
            controller: 'bsp_test_spi_cfg_handle',
            max_speed_hz: 1000000,
            mode: 'TEST_SPI_MODE_0',
            native_cs: 1,
        });
        expect(symbols['testpart_init_param']?.comm_init).toEqual({ spi_dev: 'test_spi_device' });
    });

    test('running it again changes nothing', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        const before = stored(workfile);

        const again = bootstrap(workfile);
        expectOk(again);
        expect(again.value).toEqual({ revised: [], filled: [], linked: [], chip_selects: [], wiring: [], choices: [], deleted: [], dangling: [] });
        expect(stored(workfile)).toEqual(before);
    });
});

describe('bootstrap leaves choices alone', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('a value the user set is never overwritten', () => {
        const workfile = workfile_with('test_spi_device');
        expectOk(set_value(workfile, 'test_spi_device', 'max_speed_hz', 2000000));
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device']?.max_speed_hz).toBe(2000000);
    });

    test('an unused struct is reused, whoever left it there', () => {
        const workfile = workfile_with('testpart_init_param');
        add(workfile, 'spare_dev', 'test_spi_device');
        expectOk(bootstrap(workfile));

        expect(stored(workfile)['testpart_init_param']?.comm_init).toEqual({ spi_dev: 'spare_dev' });
        expect(Object.keys(workfile.symbols)).not.toContain('test_spi_device');
    });

    test('a struct already in use is someone else\'s, so a new one is made', () => {
        const workfile = workfile_with('testpart_init_param');
        add(workfile, 'other_part', 'testpart_init_param');
        add(workfile, 'used_dev', 'test_spi_device');
        expectOk(set_value(workfile, 'other_part', 'comm_init', { spi_dev: 'used_dev' }));
        expectOk(bootstrap(workfile));

        expect(stored(workfile)['testpart_init_param']?.comm_init).toEqual({ spi_dev: 'test_spi_device' });
    });

    test('two unused structs that fit are a choice, and are listed', () => {
        const workfile = workfile_with('testpart_init_param');
        add(workfile, 'spare_a', 'test_spi_device');
        add(workfile, 'spare_b', 'test_spi_device');
        const report = bootstrap(workfile);
        expectOk(report);

        expect(stored(workfile)['testpart_init_param']?.comm_init).toBeUndefined();
        expect(report.value.choices).toContainEqual({
            node: 'testpart_init_param', property: 'comm_init', member: 'spi_dev', options: ['spare_a', 'spare_b'],
        });
    });

    test('a stored handle is shared: a second device on the bus uses the same controller', () => {
        // With no board the controller is a stored node, not a hidden one - still one bus.
        const workfile = workfile_with('test_sensor', null);
        expectOk(bootstrap(workfile));
        add(workfile, 'second', 'test_sensor');
        expectOk(bootstrap(workfile));

        const symbols = stored(workfile);
        expect(symbols['test_spi_device_1']?.controller).toBe(symbols['test_spi_device']?.controller);
    });

    test('a second device builds a chain of its own', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        add(workfile, 'second', 'test_sensor');
        expectOk(bootstrap(workfile));

        const symbols = stored(workfile);
        expect(symbols['second']?.$init_param).toBe('test_sensor_config_1');
        expect(symbols['test_sensor_config_1']?.extra).toBe('testpart_init_param_1');
        expect(symbols['testpart_init_param_1']?.comm_init).toEqual({ spi_dev: 'test_spi_device_1' });
        // The bus controller is one board resource, shared by both.
        expect(symbols['test_spi_device_1']?.controller).toBe('bsp_test_spi_cfg_handle');
    });

    test('an extern already in the workfile is linked to - it is one C global, not a choice', () => {
        const workfile = workfile_with('test_spi_controller');
        add(workfile, 'board_spi', 'bsp_test_spi_cfg');
        const report = bootstrap(workfile);
        expectOk(report);

        // The same global under the user's name is the board's config, not a second option.
        expect(report.value.linked).toEqual([{
            node: 'test_spi_controller', property: '$init_param', target: 'board_spi', symbol: 'bsp_test_spi_cfg', created: false, hidden: false,
        }]);
    });

    test('the board LED is never taken as the chip-select', () => {
        // testboard has exactly ONE gpio_pin extern - an LED - and $any_of makes cs_gpio
        // required. Without the guard, bootstrap would make the LED the chip-select; the
        // chip-select comes from the wiring instead (here, the native line).
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device']?.cs_gpio).toBeUndefined();
        expect(Object.keys(stored(workfile))).not.toContain('bsp_test_led');
    });

    test('with no board there is no board config, so the struct is created instead', () => {
        const workfile = workfile_with('test_spi_controller', null);
        const report = bootstrap(workfile);
        expectOk(report);
        expect(report.value.linked).toEqual([{
            node: 'test_spi_controller', property: '$init_param', target: 'test_spi_config', symbol: 'test_spi_config', created: true, hidden: false,
        }]);
    });

    test('a board with two candidates for a reference leaves it unset', () => {
        // otherboard declares a second SPI bus, so its controller config has two options.
        const workfile = workfile_with('test_spi_controller', 'otherboard');
        const report = bootstrap(workfile);
        expectOk(report);
        expect(report.value.linked).toEqual([]);
    });
});

describe('who owns a value', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('the user editing a value takes it out of bootstrap\'s hands', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device']?.$auto).toContain('max_speed_hz');

        expectOk(set_value(workfile, 'test_spi_device', 'max_speed_hz', 2000000));
        expect(stored(workfile)['test_spi_device']?.$auto).not.toContain('max_speed_hz');
    });

    test('ownership survives a save and load', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        const before = stored(workfile);

        const exported = export_minimal(workfile);
        expectOk(exported);
        const reloaded = import_minimal(JSON.parse(JSON.stringify(exported.value)));
        expectOk(reloaded);
        expect(stored(reloaded.value)).toEqual(before);
    });

    test('a value the user cleared is not filled back in', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expectOk(clear_value(workfile, 'test_spi_device', 'max_speed_hz'));

        const again = bootstrap(workfile);
        expectOk(again);
        expect(again.value.filled).toEqual([]);
        expect(stored(workfile)['test_spi_device']?.max_speed_hz).toBeNull();
    });

    test('switching the bus: owned values follow the rules, the new bus is built', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'testpart_init_param', 'comm_type', 'TESTPART_I2C'));

        const report = bootstrap(workfile);
        expectOk(report);
        const symbols = stored(workfile);

        // The SPI member no longer fits the I2C case, so it went, and the I2C one was built.
        expect(symbols['testpart_init_param']?.comm_init).toEqual({ i2c_dev: 'test_i2c_device' });
        expect(symbols['test_i2c_device']).toEqual({ $compatible: 'test_i2c_device', $auto: ['address'], address: 0x1D });
        expect(report.value.revised).toContainEqual({
            node: 'testpart_init_param', property: 'comm_init', previous: { spi_dev: 'test_spi_device' },
        });

        // The SPI device lost its last reference, and every value on it was bootstrap's, so
        // it went - and the controller handle it alone used went with it.
        expect(symbols['test_spi_device']).toBeUndefined();
        expect(Object.keys(workfile.symbols)).not.toContain('bsp_test_spi_cfg_handle');
        expect(report.value.deleted).toEqual(['test_spi_device']);
        expect(report.value.dangling).toEqual([]);
    });

    test('switching the bus on a jumper-wired board drops the chip-select pin too', () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_gpio_pin']).toBeDefined();
        expectOk(set_value(workfile, 'testpart_init_param', 'comm_type', 'TESTPART_I2C'));

        const report = bootstrap(workfile);
        expectOk(report);
        expect(report.value.deleted).toEqual(['test_spi_device', 'test_gpio_pin']);
    });

    test('a node the user edited is left dangling, and reported, not deleted', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'test_spi_device', 'max_speed_hz', 2000000));
        expectOk(set_value(workfile, 'testpart_init_param', 'comm_type', 'TESTPART_I2C'));

        const report = bootstrap(workfile);
        expectOk(report);
        expect(stored(workfile)['test_spi_device']?.max_speed_hz).toBe(2000000);
        expect(report.value.deleted).toEqual([]);
        expect(report.value.dangling).toEqual(['test_spi_device']);
    });

    test('a reference the user removed counts too, given what was referenced before', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        const before = referenced_nodes(workfile);
        add(workfile, 'my_dev', 'test_spi_device');
        expectOk(set_value(workfile, 'testpart_init_param', 'comm_init', { spi_dev: 'my_dev' }));

        const report = bootstrap(workfile, { referenced_before: before });
        expectOk(report);
        expect(report.value.deleted).toEqual(['test_spi_device']);
    });

    test('a root, never referenced, is never deleted', () => {
        const workfile = workfile_with('test_sensor');
        const report = bootstrap(workfile);
        expectOk(report);
        expect(Object.keys(workfile.symbols)).toContain('test_sensor');
        expect(report.value.deleted).toEqual([]);
    });

    test('a value the user wrote is never revised, whatever the rules say now', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'test_spi_device', 'max_speed_hz', 2000000));
        expectOk(set_value(workfile, 'testpart_init_param', 'comm_type', 'TESTPART_I2C'));

        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device']?.max_speed_hz).toBe(2000000);
    });

    test('a revised value is reported with what it was and what it is now', () => {
        // An owned value that differs from what the rule gives now is set to the rule's value.
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'test_spi_device', 'max_speed_hz', 5000000));
        expectOk(mark_auto(workfile, 'test_spi_device', 'max_speed_hz'));

        const report = bootstrap(workfile);
        expectOk(report);
        expect(report.value.revised).toEqual([{ node: 'test_spi_device', property: 'max_speed_hz', previous: 5000000, value: 1000000 }]);
        expect(stored(workfile)['test_spi_device']?.$auto).toContain('max_speed_hz');
    });

    test('a chip-select the user cleared is not settled from the wiring', () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        add(workfile, 'cfg', 'test_sensor_config');
        add(workfile, 'part', 'testpart_init_param');
        add(workfile, 'dev', 'test_spi_device');
        expectOk(set_value(workfile, 'test_sensor', '$init_param', 'cfg'));
        expectOk(set_value(workfile, 'cfg', 'extra', 'part'));
        expectOk(set_value(workfile, 'part', 'comm_init', { spi_dev: 'dev' }));
        expectOk(clear_value(workfile, 'dev', 'cs_gpio'));

        const report = bootstrap(workfile);
        expectOk(report);
        expect(report.value.chip_selects).toEqual([]);
        expect(stored(workfile)['dev']?.cs_gpio).toBeNull();
    });
});

describe('hidden nodes', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('are never written out - only nodes with fields are', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));

        expect(Object.keys(stored(workfile))).toEqual(['test_sensor', 'eval_testpart', 'test_sensor_config', 'testpart_init_param', 'test_spi_device']);
        expect([...(workfile.hidden ?? [])].sort()).toEqual(['bsp_test_spi_cfg', 'bsp_test_spi_cfg_handle', 'testpart_ops']);
    });

    test('a load rebuilds exactly the ones referenced, from the names alone', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        const saved = export_minimal(workfile);
        expectOk(saved);

        const loaded = import_minimal(saved.value);
        expectOk(loaded);
        expect([...(loaded.value.hidden ?? [])].sort()).toEqual(['bsp_test_spi_cfg', 'bsp_test_spi_cfg_handle', 'testpart_ops']);
        // The board's other peripherals are not dragged in just because they exist.
        expect(Object.keys(loaded.value.symbols)).not.toContain('bsp_test_gpio0_cfg');
        expect(validate_workfile(loaded.value).valid).toBe(true);

        const resaved = export_minimal(loaded.value);
        expectOk(resaved);
        expect(resaved.value).toEqual(saved.value);
    });

    test('two devices on one bus share one controller handle', () => {
        const workfile = workfile_with('test_spi_device');
        add(workfile, 'second_dev', 'test_spi_device');
        expectOk(bootstrap(workfile));

        const symbols = stored(workfile);
        expect(symbols['test_spi_device']?.controller).toBe('bsp_test_spi_cfg_handle');
        expect(symbols['second_dev']?.controller).toBe('bsp_test_spi_cfg_handle');
        expect(Object.keys(workfile.symbols).filter(name => name.endsWith('_handle'))).toEqual(['bsp_test_spi_cfg_handle']);
    });

    test('suggestions offer handles that do not exist yet', () => {
        // Pointing a pin at another port is the user's override; the handle for it is
        // offered by the name it would get, before anything creates it.
        const workfile = workfile_with('test_gpio_pin');
        const suggestions = suggest_for_property(workfile, 'test_gpio_pin', 'port_handle');
        expectOk(suggestions);
        expect(suggestions.value.values).toEqual(['bsp_test_gpio0_cfg_handle', 'bsp_test_gpio1_cfg_handle']);
    });

    test("a stored node holding a hidden node's name is a conflict, not the resource", () => {
        const workfile = workfile_with('test_spi_controller');
        add(workfile, 'bsp_test_spi_cfg', 'test_spi_config');
        const externs = build_extern_index(workfile.board);
        expectOk(externs);

        const built = materialize_hidden(workfile, { kind: 'extern', name: 'bsp_test_spi_cfg', symbol: 'bsp_test_spi_cfg' }, externs.value);
        expectErrorContains(built, 'a node in the workfile already has that name');
    });
});

describe('the chip-select', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('on a board the part mates with, it is the native line the connector lands on', () => {
        const workfile = workfile_with('test_sensor');
        const report = bootstrap(workfile);
        expectOk(report);

        const [decision] = report.value.chip_selects;
        expect(decision?.chip_select).toEqual({
            kind: 'native', peripheral: 'bsp_test_spi_cfg', native_cs: 0, at: { connector: 'PMOD', pin: '1' },
        });
        expect(report.value.wiring[0]?.connections.every(connection => connection.via === 'mating')).toBe(true);
        expect(decision?.pin).toBeUndefined();
    });

    test("jumper-wired, it is a GPIO pin on the board's declared line, on the right port", () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        const report = bootstrap(workfile);
        expectOk(report);
        expect(validate_workfile(workfile).valid).toBe(true);

        const symbols = stored(workfile);
        // The pin is stored - its number is a real field - and its port is a hidden handle.
        expect(symbols['test_gpio_pin']).toEqual({ $compatible: 'test_gpio_pin', $auto: ['port_handle', 'number'], port_handle: 'bsp_other_gpio1_cfg_handle', number: 4 });
        expect(symbols['test_spi_device']?.cs_gpio).toBe('test_gpio_pin');
        expect(symbols['test_spi_device']?.cs_gpio_num).toBe(1);

        // And the wiring to make it true on the bench.
        expect(report.value.wiring[0]?.connections.map(connection => `${connection.from.pin}->${connection.to.connector}.${connection.to.pin}`))
            .toEqual(['2->H1.2', '3->H1.3', '4->H1.1', '1->H1.4']);
    });

    test('on a board with two SPI buses, the wiring decides which controller', () => {
        // otherboard has bsp_test_spi_cfg and bsp_test_spi2_cfg: two handles, so the
        // controller is a choice the board alone cannot make. The part's lines land on the
        // first bus, and that settles it.
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));

        expect(stored(workfile)['test_spi_device']?.controller).toBe('bsp_test_spi_cfg_handle');
        expect(Object.keys(workfile.symbols)).not.toContain('bsp_test_spi2_cfg_handle');
    });

    test('on a board with two wired SPI buses, it stops at the controller and says so', () => {
        // twobusboard declares pins and a chip-select line for both buses, and the part is
        // jumper-wired, so it could go on either: that is the user's choice.
        const workfile = workfile_with('test_sensor', 'twobusboard', 'othersoc');
        const report = bootstrap(workfile);
        expectOk(report);

        const symbols = stored(workfile);
        expect(symbols['test_spi_device']?.controller).toBeUndefined();
        expect(symbols['test_spi_device']?.cs_gpio).toBeUndefined();
        expect(report.value.chip_selects).toEqual([]);

        // The stop is reported with the options, by the names `update` takes, in the
        // board's own order...
        expect(report.value.choices).toEqual([{
            node: 'test_spi_device',
            property: 'controller',
            options: ['bsp_test_spi_cfg_handle', 'bsp_test_spi2_cfg_handle'],
        }]);
        // ...and so is why the wiring could not decide it.
        const [wiring] = report.value.wiring;
        expect(wiring?.device).toBe('test_spi_device');
        expect(wiring?.problems.join('\n')).toContain('2 spi sck pins');
    });

    test('on a board with two wired SPI buses, the controller the user picks settles the chip-select', () => {
        const workfile = workfile_with('test_sensor', 'twobusboard', 'othersoc');
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'test_spi_device', 'controller', 'bsp_test_spi2_cfg_handle'));

        const report = bootstrap(workfile);
        expectOk(report);
        const symbols = stored(workfile);
        expect(symbols['test_spi_device']?.controller).toBe('bsp_test_spi2_cfg_handle');
        expect(symbols['test_spi_device']?.cs_gpio).toBe('test_gpio_pin');
        expect(symbols['test_gpio_pin']?.number).toBe(8);

        // The wiring is read from the picked bus only, so it no longer asks.
        const [wiring] = report.value.wiring;
        expect(wiring?.problems).toEqual([]);
        expect(wiring?.connections.map(connection => `${connection.from.pin}->${connection.to.connector}.${connection.to.pin}`))
            .toEqual(['2->H1.6', '3->H1.7', '4->H1.5', '1->H1.8']);
    });

    test('a workfile with nothing left open reports no choices', () => {
        const workfile = workfile_with('test_sensor');
        const report = bootstrap(workfile);
        expectOk(report);
        expect(report.value.choices).toEqual([]);
    });

    test('a filled number carries its format, so it can be shown as the schema writes it', () => {
        const workfile = workfile_with('test_sensor');
        const report = bootstrap(workfile);
        expectOk(report);
        const mask = report.value.filled.find(fill => fill.property === 'native_cs');
        expect(mask?.format).toBe('hex');
    });

    test('a part on a bus its eval board has no pins for is reported, not left silent', () => {
        // The user picked I2C before bootstrap reached the bus, so the chain is built by hand
        // down to the part; eval-testpart is a SPI-only board, like the real ADXL355 Pmod.
        const workfile = workfile_with('test_sensor');
        add(workfile, 'cfg', 'test_sensor_config');
        add(workfile, 'part', 'testpart_init_param');
        expectOk(set_value(workfile, 'test_sensor', '$init_param', 'cfg'));
        expectOk(set_value(workfile, 'cfg', 'extra', 'part'));
        expectOk(set_value(workfile, 'part', 'comm_type', 'TESTPART_I2C'));

        const report = bootstrap(workfile);
        expectOk(report);
        expect(stored(workfile)['part']?.comm_init).toEqual({ i2c_dev: 'test_i2c_device' });
        expect(report.value.wiring).toEqual([{
            device: 'test_i2c_device',
            part: 'eval-testpart',
            interface: 'i2c',
            connections: [],
            problems: ['eval-testpart declares no i2c pins, so it cannot be wired over i2c'],
        }]);
    });

    test('a second device does not get a GPIO chip-select line the first already uses', () => {
        // otherboard declares one chip-select line, H1 pin 4; the first device takes it.
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));
        add(workfile, 'second', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'second'));
        const report = bootstrap(workfile);
        expectOk(report);

        const symbols = stored(workfile);
        expect(symbols['test_spi_device_1']?.cs_gpio).toBeUndefined();
        expect(report.value.chip_selects).toEqual([]);
        const wiring = report.value.wiring.find(entry => entry.device === 'test_spi_device_1');
        expect(wiring?.problems.join('\n')).toContain('already used by another device');
        // The free pins it could use instead: not H1.4 (taken), not H1.1-3 (they carry SPI).
        expect(wiring?.chip_select_options).toEqual([{ at: { connector: 'H1', pin: '5' }, gpio: { port: 'OTHER_GPIO1', number: 5 } }]);
    });

    test('a second device does not get a native chip-select line the first already uses', () => {
        // On testboard the part plugs into the PMOD, whose CS pin is native line 0 - fixed by
        // mating, so the second device would land on the very same line.
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        add(workfile, 'second', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'second'));
        const report = bootstrap(workfile);
        expectOk(report);

        expect(stored(workfile)['test_spi_device_1']?.native_cs).toBeUndefined();
        const problems = report.value.wiring.find(wiring => wiring.device === 'test_spi_device_1')?.problems ?? [];
        expect(problems.join('\n')).toContain('already used by another device');
    });

    test('the first device still keeps its own chip-select on a rerun', () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));
        add(workfile, 'second', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'second'));
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device']?.cs_gpio).toBe('test_gpio_pin');
    });

    test('a list\'s count follows its list: clearing the pins removes the count', () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device']?.cs_gpio_num).toBe(1);

        const before = referenced_nodes(workfile);
        expectOk(clear_value(workfile, 'test_spi_device', 'cs_gpio'));
        const report = bootstrap(workfile, { referenced_before: before });
        expectOk(report);

        const symbols = stored(workfile);
        expect(symbols['test_spi_device']?.cs_gpio).toBeNull();
        expect(symbols['test_spi_device']?.cs_gpio_num).toBeUndefined();
        expect(report.value.deleted).toEqual(['test_gpio_pin']);
    });

    test('a list the user set gets its count filled in', () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));
        add(workfile, 'second', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'second'));
        expectOk(bootstrap(workfile));
        add(workfile, 'my_pin', 'test_gpio_pin');
        expectOk(set_value(workfile, 'test_spi_device_1', 'cs_gpio', 'my_pin'));

        expectOk(bootstrap(workfile));
        expect(stored(workfile)['test_spi_device_1']?.cs_gpio_num).toBe(1);
    });

    test('a device that already has a chip-select is left alone', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'test_spi_device', 'native_cs', 2));

        const again = bootstrap(workfile);
        expectOk(again);
        expect(again.value.chip_selects).toEqual([]);
        expect(stored(workfile)['test_spi_device']?.native_cs).toBe(2);
    });

    test('running it again on a GPIO chip-select changes nothing', () => {
        const workfile = workfile_with('test_sensor', 'otherboard', 'othersoc');
        expectOk(bootstrap(workfile));
        const before = stored(workfile);

        const again = bootstrap(workfile);
        expectOk(again);
        expect(again.value).toEqual({ revised: [], filled: [], linked: [], chip_selects: [], wiring: [], choices: [], deleted: [], dangling: [] });
        expect(stored(workfile)).toEqual(before);
    });
});
