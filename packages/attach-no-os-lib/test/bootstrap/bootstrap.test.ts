import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../src/bootstrap/bootstrap';
import { load_resolved_ruleset, load_resolved_ruleset_for_board, resolve_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { validate_workfile } from '../../src/validator/validator';
import { add_symbol, create_workfile, export_minimal, set_value } from '../../src/workfile_handler/workfile_handler';
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
function workfile_with(root: string, board: string | null = FIXTURE_BOARD): Workfile {
    const created = create_workfile(FIXTURE_SOC);
    expectOk(created);
    if (board !== null) {
        created.value.board = board;
    }
    const ruleset = load_resolved_ruleset(root);
    expectOk(ruleset);
    expectOk(add_symbol(created.value, root, ruleset.value));
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

        expect(report.value.linked.map(link => `${link.node}.${link.property}${link.member === undefined ? '' : `.${link.member}`} -> ${link.target}${link.created ? ' (created)' : ''}`)).toEqual([
            'test_sensor.$init_param -> test_sensor_config (created)',
            'test_sensor_config.extra -> testpart_init_param (created)',
            'test_sensor_config.ops -> testpart_ops (created)',
            'testpart_init_param.comm_init.spi_dev -> test_spi_device (created)',
            'test_spi_device.controller -> test_spi_controller (created)',
            // The board's own config, not a fresh struct: a board extern provides the type.
            'test_spi_controller.$init_param -> bsp_test_spi_cfg (created)',
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
        ]);
    });

    test('what is left is exactly what bootstrap must not decide: the chip-select', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));

        const result = validate_workfile(workfile);
        expect(result.errors.map(error => `${error.path ?? ''}: ${error.message}`)).toEqual([
            'test_spi_device.native_cs: needs one of: cs_gpio, native_cs other than 0',
            'test_spi_device.cs_gpio: needs one of: cs_gpio, native_cs other than 0',
        ]);
    });

    test('bootstrapped nodes and values are stored', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));

        const symbols = stored(workfile);
        expect(symbols['test_spi_device']).toEqual({
            $compatible: 'test_spi_device',
            controller: 'test_spi_controller',
            max_speed_hz: 1000000,
            mode: 'TEST_SPI_MODE_0',
        });
        expect(symbols['testpart_init_param']?.comm_init).toEqual({ spi_dev: 'test_spi_device' });
    });

    test('running it again changes nothing', () => {
        const workfile = workfile_with('test_sensor');
        expectOk(bootstrap(workfile));
        const before = stored(workfile);

        const again = bootstrap(workfile);
        expectOk(again);
        expect(again.value).toEqual({ filled: [], linked: [] });
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

    test('a node the user already holds is never linked to - that is a choice', () => {
        // A second device's chain: a bus device already exists, so "use it" and "create
        // one" are two options and the union member stays unset.
        const workfile = workfile_with('testpart_init_param');
        add(workfile, 'existing_dev', 'test_spi_device');
        const report = bootstrap(workfile);
        expectOk(report);

        expect(stored(workfile)['testpart_init_param']?.comm_init).toBeUndefined();
        expect(report.value.linked.some(link => link.node === 'testpart_init_param')).toBe(false);
    });

    test('an extern already in the workfile is linked to - it is one C global, not a choice', () => {
        const workfile = workfile_with('test_spi_controller');
        add(workfile, 'board_spi', 'bsp_test_spi_cfg');
        const report = bootstrap(workfile);
        expectOk(report);

        expect(report.value.linked).toEqual([{
            node: 'test_spi_controller', property: '$init_param', target: 'board_spi', symbol: 'bsp_test_spi_cfg', created: false,
        }]);
    });

    test('a requirement from $any_of is never materialized', () => {
        // testboard has exactly ONE gpio_pin extern - an LED. Without the guard, bootstrap
        // would make the LED the chip-select.
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
            node: 'test_spi_controller', property: '$init_param', target: 'test_spi_config', symbol: 'test_spi_config', created: true,
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
