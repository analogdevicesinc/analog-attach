import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { attach_eval_board, bootstrap, pin_driver, referenced_nodes } from '../../src/bootstrap/bootstrap';
import { capi_project } from '../../src/codegen/capi_project';
import { rank_driver_candidates, driver_init_parameter_candidates } from '../../src/registry/drivers';
import { find_soc } from '../../src/registry/platforms';
import { platform_ops_tables } from '../../src/registry/interfaces';
import { driver_root, driver_root_for, driver_roots, addable_drivers } from '../../src/registry/roots';
import { load_resolved_ruleset_for_board, resolve_ruleset } from '../../src/resolver/resolver';
import { parse_ruleset } from '../../src/ruleset_parser/ruleset_parser';
import { validate_workfile } from '../../src/validator/validator';
import { add_symbol, create_workfile, export_minimal, set_value, suggest_for_property } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import type { Ruleset } from '../../src/ruleset_parser/types';
import {
    expectError,
    expectErrorContains,
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_ADC_DRIVERS,
    FIXTURE_BOARD,
    FIXTURE_DRIVERS,
    FIXTURE_PLATFORM,
    FIXTURE_SOC,
} from '../test_utilities';

// The rules that deduce a workfile from what is already in it, without any YAML key saying
// so. The real repos exercise them too (test/integration), but only on the machines that
// have the checkouts; these run on the fixtures everywhere. The ADC corner of the fixtures
// mirrors ad74413r: `dualpart` has an ADC and a DAC side on one chip, `otheradc` is a rival
// ADC, and test_adc_chan hangs off a test_adc the way capi_adc_chan does.

const WITH_ADC_DRIVERS = { modules: [FIXTURE_PLATFORM, FIXTURE_DRIVERS, FIXTURE_ADC_DRIVERS] };

function board_workfile(): Workfile {
    const created = create_workfile(FIXTURE_SOC);
    expectOk(created);
    created.value.board = FIXTURE_BOARD;
    return created.value;
}

function add(workfile: Workfile, name: string, symbol: string): void {
    const ruleset = load_resolved_ruleset_for_board(symbol, workfile.board);
    expectOk(ruleset);
    expectOk(add_symbol(workfile, name, ruleset.value));
}

/** What `attach-noos add <driver> [--as <interface>]` does, before bootstrap. */
function add_driver(workfile: Workfile, driver: string, interface_: string, chip?: string): string {
    const root = driver_root_for(driver, interface_);
    expectOk(root);
    const name = `${driver}_${interface_}`;
    add(workfile, name, root.value);
    expectOk(pin_driver(workfile, name, driver, chip));
    return name;
}

function stored(workfile: Workfile): Record<string, Record<string, unknown>> {
    const exported = export_minimal(workfile);
    expectOk(exported);
    return exported.value.symbols as Record<string, Record<string, unknown>>;
}

/** The node a handle's config names in a field (`extra`, `adc_ops`). */
function config_field(workfile: Workfile, handle: string, field: string): unknown {
    const symbols = stored(workfile);
    const config = symbols[handle]?.$init_param;
    return typeof config === 'string' ? symbols[config]?.[field] : undefined;
}

function node(workfile: Workfile, name: string): Ruleset {
    const found = workfile.symbols[name];
    expect(found).toBeDefined();
    return found as Ruleset;
}

describe('which handles a driver is added through', () => {
    beforeEach(() => { setup_test_config(WITH_ADC_DRIVERS); });
    afterEach(() => { teardown_test_config(); });

    test('a driver providing two interfaces has a root for each', () => {
        const roots = driver_roots('dualpart');
        expectOk(roots);
        expect(roots.value).toEqual(['test_adc', 'test_dac']);
    });

    test('a channel handle hangs off its ADC, so it is never a root', () => {
        // test_adc_chan_config takes a driver for test_adc too, but it names the ADC it is on.
        const roots = driver_roots('otheradc');
        expectOk(roots);
        expect(roots.value).toEqual(['test_adc']);
    });

    test('with two roots, plain add asks for --as', () => {
        expectErrorContains(driver_root('dualpart'), '--as test_adc or --as test_dac');
        const dac = driver_root_for('dualpart', 'test_dac');
        expectOk(dac);
        expect(dac.value).toBe('test_dac');
        expectErrorContains(driver_root_for('otheradc', 'test_dac'), "cannot be added as 'test_dac'");
    });

    test('every driver with a root is addable by name', () => {
        const drivers = addable_drivers();
        expectOk(drivers);
        expect(drivers.value).toEqual(['dualpart', 'otheradc', 'testpart']);
    });
});

describe('ranking the drivers behind a field', () => {
    beforeEach(() => { setup_test_config(WITH_ADC_DRIVERS); });
    afterEach(() => { teardown_test_config(); });

    function ranked(workfile: Workfile, owner: string): { strong: string[], weak: string[] } {
        const candidates = driver_init_parameter_candidates('test_adc');
        expectOk(candidates);
        const { strong, weak } = rank_driver_candidates(workfile, candidates.value, node(workfile, owner));
        return { strong: strong.map(entry => entry.$symbol).sort(), weak: weak.map(entry => entry.$symbol).sort() };
    }

    test('with no part in the workfile, every driver is a weak option', () => {
        const workfile = board_workfile();
        add(workfile, 'adc', 'test_adc');
        add(workfile, 'adc_config', 'test_adc_config');
        expect(ranked(workfile, 'adc_config')).toEqual({
            strong: [],
            weak: ['dualpart_channel_config', 'dualpart_init_param', 'otheradc_init_param'],
        });
    });

    test('the part already added is strong, and the device level keeps its init_param from a channel', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'dualpart', 'test_adc');
        add(workfile, 'chan_config', 'test_adc_chan_config');
        // dualpart_init_param fills the device config's extra, so it is the device's: what is
        // left of dualpart for a channel is its channel struct.
        expect(ranked(workfile, 'chan_config')).toEqual({
            strong: ['dualpart_channel_config'],
            weak: ['otheradc_init_param'],
        });
    });

    test('between two device configs nothing is taken: the chip fills both', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'dualpart', 'test_adc');
        add(workfile, 'second_config', 'test_adc_config');
        expect(ranked(workfile, 'second_config').strong).toEqual(['dualpart_channel_config', 'dualpart_init_param']);
    });

    test('suggestions list the strong options first', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'dualpart', 'test_adc');
        add(workfile, 'chan_config', 'test_adc_chan_config');
        const suggestions = suggest_for_property(workfile, 'chan_config', 'extra');
        expectOk(suggestions);
        expect(suggestions.value.types).toEqual(['dualpart_channel_config', 'otheradc_init_param']);
    });
});

describe('a channel\'s ADC', () => {
    beforeEach(() => { setup_test_config(WITH_ADC_DRIVERS); });
    afterEach(() => { teardown_test_config(); });

    test('is offered by the ADC handle, not by the channel\'s own copy of it', () => {
        const workfile = board_workfile();
        const adc = add_driver(workfile, 'dualpart', 'test_adc');
        add(workfile, 'ch0', 'test_adc_chan');
        expectOk(bootstrap(workfile));
        const config = stored(workfile)['ch0']?.$init_param as string;

        const suggestions = suggest_for_property(workfile, config, 'adc_handle');
        expectOk(suggestions);
        // ch0.adc_handle is set by ch0's init, from this very config: offering it is a loop.
        expect(suggestions.value.values).toEqual([adc]);
    });

    test('another channel\'s copy is still offered: it does not depend on this config', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'dualpart', 'test_adc');
        add(workfile, 'ch0', 'test_adc_chan');
        add(workfile, 'ch1', 'test_adc_chan');
        expectOk(bootstrap(workfile));
        const config = stored(workfile)['ch1']?.$init_param as string;

        const suggestions = suggest_for_property(workfile, config, 'adc_handle');
        expectOk(suggestions);
        expect(suggestions.value.values).toContain('ch0.adc_handle');
        expect(suggestions.value.values).not.toContain('ch1.adc_handle');
    });
});

describe('bootstrap follows the ranking', () => {
    beforeEach(() => { setup_test_config(WITH_ADC_DRIVERS); });
    afterEach(() => { teardown_test_config(); });

    test('a pinned part fills its config by name, and its ops by interface', () => {
        const workfile = board_workfile();
        const adc = add_driver(workfile, 'dualpart', 'test_adc');
        expectOk(bootstrap(workfile));
        expect(config_field(workfile, adc, 'extra')).toBe('dualpart_init_param');
        // dualpart ships an ADC and a DAC table; the ADC field takes the test_adc_ops one.
        expect(config_field(workfile, adc, 'adc_ops')).toBe('dualpart_adc_ops');
        expect(validate_workfile(workfile).valid).toBe(true);
    });

    test('an unpinned handle with two drivers configured is left as a choice', () => {
        const workfile = board_workfile();
        add(workfile, 'adc', 'test_adc');
        const report = bootstrap(workfile);
        expectOk(report);
        expect(config_field(workfile, 'adc', 'extra')).toBeUndefined();
        const open = report.value.choices.find(choice => choice.property === 'extra');
        expect(open?.options.sort()).toEqual(['dualpart_channel_config', 'dualpart_init_param', 'otheradc_init_param']);
    });

    test('a channel finds its ADC and the part\'s channel struct, though a rival ADC is configured', () => {
        const workfile = board_workfile();
        const adc = add_driver(workfile, 'dualpart', 'test_adc');
        expectOk(bootstrap(workfile));
        add(workfile, 'ch0', 'test_adc_chan');
        expectOk(bootstrap(workfile));

        expect(config_field(workfile, 'ch0', 'adc_handle')).toBe(adc);
        expect(config_field(workfile, 'ch0', 'extra')).toBe('dualpart_channel_config');
        expect(config_field(workfile, adc, 'extra')).toBe('dualpart_init_param');
    });

    test('a second channel gets a channel struct of its own', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'dualpart', 'test_adc');
        for (const name of ['ch0', 'ch1']) {
            add(workfile, name, 'test_adc_chan');
            expectOk(bootstrap(workfile));
        }
        expect(config_field(workfile, 'ch0', 'extra')).toBe('dualpart_channel_config');
        expect(config_field(workfile, 'ch1', 'extra')).toBe('dualpart_channel_config_1');
    });
});

describe('--as: two sides on one chip', () => {
    beforeEach(() => { setup_test_config(WITH_ADC_DRIVERS); });
    afterEach(() => { teardown_test_config(); });

    test('the DAC side shares the ADC side\'s init_param, with its own ops', () => {
        const workfile = board_workfile();
        const adc = add_driver(workfile, 'dualpart', 'test_adc');
        const chip = config_field(workfile, adc, 'extra');
        expect(chip).toBe('dualpart_init_param');
        const dac = add_driver(workfile, 'dualpart', 'test_dac', chip as string);
        expectOk(bootstrap(workfile));

        expect(config_field(workfile, dac, 'extra')).toBe('dualpart_init_param');
        expect(config_field(workfile, dac, 'dac_ops')).toBe('dualpart_dac_ops');
        expect(config_field(workfile, adc, 'adc_ops')).toBe('dualpart_adc_ops');
        expect(Object.values(workfile.symbols).filter(found => found.$symbol === 'dualpart_init_param')).toHaveLength(1);
        expect(validate_workfile(workfile).valid).toBe(true);
    });

    test('without the chip, a second side describes a second part', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'dualpart', 'test_adc');
        const dac = add_driver(workfile, 'dualpart', 'test_dac');
        expect(config_field(workfile, dac, 'extra')).toBe('dualpart_init_param_1');
    });
});

describe('which part an eval board wires', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    function has_chip_select(workfile: Workfile, device: string): boolean {
        const fields = stored(workfile)[device] ?? {};
        return fields.cs_gpio !== undefined || (typeof fields.native_cs === 'number' && fields.native_cs !== 0);
    }

    /** A sensor's SPI device, followed down its chain: config, the part, its bus member. */
    function device_of(workfile: Workfile, sensor: string): string {
        const symbols = stored(workfile);
        const part = config_field(workfile, sensor, 'extra');
        const bus = typeof part === 'string' ? symbols[part]?.comm_init as Record<string, unknown> | undefined : undefined;
        expect(typeof bus?.spi_dev).toBe('string');
        return bus?.spi_dev as string;
    }

    function sensors(): Workfile {
        const workfile = board_workfile();
        add(workfile, 'on_board', 'test_sensor');
        add(workfile, 'bare', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'on_board'));
        return workfile;
    }

    test('only the part the eval board names is wired; the other is bare, and told why', () => {
        const workfile = sensors();
        const report = bootstrap(workfile);
        expectOk(report);

        // Each chain is built the same way, down to its own SPI device.
        const wired = device_of(workfile, 'on_board');
        const bare_device = device_of(workfile, 'bare');
        expect(wired).not.toBe(bare_device);
        expect(has_chip_select(workfile, wired)).toBe(true);
        expect(has_chip_select(workfile, bare_device)).toBe(false);
        const bare = report.value.wiring.find(wiring => wiring.device === bare_device);
        expect(bare?.problems.join(' ')).toContain('no eval board carries this testpart');
    });

    test('an eval board attached to a part with a chain already is wired by the next run', () => {
        // On otherboard the part is jumper-wired to the board's one declared CS line.
        const workfile = create_workfile('othersoc');
        expectOk(workfile);
        workfile.value.board = 'otherboard';
        add(workfile.value, 'sensor', 'test_sensor');
        expectOk(bootstrap(workfile.value));
        expect(has_chip_select(workfile.value, device_of(workfile.value, 'sensor'))).toBe(false);

        expectOk(attach_eval_board(workfile.value, 'eval-testpart', 'sensor'));
        expectOk(bootstrap(workfile.value));
        expect(has_chip_select(workfile.value, device_of(workfile.value, 'sensor'))).toBe(true);
    });

    test('one that cannot be wired is still reported, though its chain was built before', () => {
        // testboard: the part mates with the PMOD, whose native line 0 the first part has.
        const workfile = sensors();
        expectOk(bootstrap(workfile));
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'bare'));
        const report = bootstrap(workfile);
        expectOk(report);

        const second = device_of(workfile, 'bare');
        expect(has_chip_select(workfile, second)).toBe(false);
        const problems = report.value.wiring.find(wiring => wiring.device === second)?.problems ?? [];
        expect(problems.join('\n')).toContain('already used by another device');
        // Settled devices stay quiet: only the open problem is repeated.
        expect(report.value.wiring.map(wiring => wiring.device)).toEqual([second]);
    });

    test('the eval board naming a part is not a reference: the part stays a root', () => {
        const workfile = sensors();
        expectOk(bootstrap(workfile));
        const referenced = referenced_nodes(workfile);
        expect(referenced.has('on_board')).toBe(false);
        expect(referenced.has('test_sensor_config')).toBe(true);
    });
});

describe('platform ops from the interfaces_file', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); vi.restoreAllMocks(); });

    /** A config a user writes by hand: an ops field that takes the platform's SPI table. */
    function bus_config(): Ruleset {
        const parsed = parse_ruleset([
            '$type: struct',
            '$symbol: my_bus_config',
            'ops:',
            '  type: platform_ops',
            '  capability: [spi]',
            '  required: true',
            '  description: "The platform SPI ops table"',
        ].join('\n'));
        expectOk(parsed);
        const resolved = resolve_ruleset(parsed.value);
        expectOk(resolved);
        return resolved.value;
    }

    test('one table per interface that has one, with its headers', () => {
        const soc = find_soc(FIXTURE_SOC);
        expectOk(soc);
        const tables = platform_ops_tables(soc.value.platform);
        expectOk(tables);
        expect(tables.value.map(table => [table.$symbol, table.$capability, table.$headers])).toEqual([
            ['testvendor_spi_ops', 'spi', ['testvendor_spi.h', 'test_spi.h']],
            ['testvendor_gpio_ops', 'gpio', ['testvendor_gpio.h', 'test_gpio.h']],
        ]);
    });

    test('every new workfile carries them', () => {
        expect(Object.keys(board_workfile().platform_ops)).toEqual(['testvendor_spi_ops', 'testvendor_gpio_ops']);
    });

    test('bootstrap fills an ops field with the table of its capability', () => {
        const workfile = board_workfile();
        expectOk(add_symbol(workfile, 'my_bus', bus_config()));
        expectOk(bootstrap(workfile));
        expect(stored(workfile)['my_bus']?.ops).toBe('testvendor_spi_ops');
    });

    test('suggestions and validation go by the same capability', () => {
        const workfile = board_workfile();
        expectOk(add_symbol(workfile, 'my_bus', bus_config()));
        const suggestions = suggest_for_property(workfile, 'my_bus', 'ops');
        expectOk(suggestions);
        expect(suggestions.value.values).toEqual(['testvendor_spi_ops']);

        expectOk(set_value(workfile, 'my_bus', 'ops', 'testvendor_gpio_ops'));
        const errors = validate_workfile(workfile).errors.filter(entry => entry.severity === 'error');
        expect(errors.map(entry => entry.message).join('\n')).toContain("Capability mismatch: ops is 'gpio', expected 'spi'");
    });

    test('the generated project includes the headers of a table a node points at', () => {
        const workfile = board_workfile();
        expectOk(add_symbol(workfile, 'my_bus', bus_config()));
        expectOk(bootstrap(workfile));
        const project = capi_project(workfile);
        expectOk(project);
        expect(project.value.headers).toEqual(expect.arrayContaining(['testvendor_spi.h', 'test_spi.h']));
        expect(project.value.headers).not.toContain('testvendor_gpio.h');
    });

    test('a broken interfaces_file is a warning, and the workfile comes without ops', () => {
        const platform = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-broken-platform-'));
        fs.cpSync(FIXTURE_PLATFORM, platform, { recursive: true });
        fs.writeFileSync(path.join(platform, 'sdk', 'interfaces.yml'), 'schema_version: "1.0"\n');
        setup_test_config({ modules: [platform, FIXTURE_DRIVERS] });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const created = create_workfile(FIXTURE_SOC);
            expectOk(created);
            expect(created.value.platform_ops).toEqual({});
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('has no interfaces list'));
        } finally {
            teardown_test_config();
            fs.rmSync(platform, { recursive: true, force: true });
        }
    });

    test('a platform with no interfaces_file simply has none', () => {
        const soc = find_soc(FIXTURE_SOC);
        expectOk(soc);
        const tables = platform_ops_tables({ ...soc.value.platform, interfaces_file: undefined });
        expectOk(tables);
        expect(tables.value).toEqual([]);
        expectError(platform_ops_tables({ ...soc.value.platform, interfaces_file: 'missing.yml' }));
    });
});
