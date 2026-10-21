import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attach_eval_board, bootstrap, pin_driver } from '../../src/bootstrap/bootstrap';
import { load_devices } from '../../src/codegen/device_loader';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { add_symbol, create_workfile } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import { driver_root_for } from '../../src/registry/roots';
import {
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_ADC_DRIVERS,
    FIXTURE_BOARD,
    FIXTURE_DRIVERS,
    FIXTURE_PLATFORM,
    FIXTURE_SOC,
} from '../test_utilities';

// The devices main.c brings up, from a bootstrapped workfile: the sensor handle, and the
// board handles it reaches (the SPI controller, the chip-select's GPIO port).

function sensor_on_otherboard(): Workfile {
    const created = create_workfile('othersoc');
    expectOk(created);
    created.value.board = 'otherboard';
    const ruleset = load_resolved_ruleset('test_sensor');
    expectOk(ruleset);
    expectOk(add_symbol(created.value, 'sensor', ruleset.value));
    expectOk(attach_eval_board(created.value, 'eval-testpart', 'sensor'));
    expectOk(bootstrap(created.value));
    return created.value;
}

describe('load_devices', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('a device comes after every handle it reaches', () => {
        const names = load_devices(sensor_on_otherboard()).map(device => device.descriptor_name);
        expect(names.at(-1)).toBe('sensor');
        expect(names.slice(0, -1).sort()).toEqual(['bsp_other_gpio1_cfg_handle', 'bsp_test_spi_cfg_handle']);
    });

    test('a board handle is brought up from the board extern, typed by what it provides', () => {
        const controller = load_devices(sensor_on_otherboard()).find(device => device.descriptor_name === 'bsp_test_spi_cfg_handle');
        expect(controller).toMatchObject({ symbol_name: 'bsp_test_spi_cfg', init_param_type: 'test_spi_config' });
    });

    test('the sensor is brought up from its config struct', () => {
        const sensor = load_devices(sensor_on_otherboard()).find(device => device.descriptor_name === 'sensor');
        expect(sensor).toMatchObject({ symbol_name: 'sensor_cfg', init_param_type: 'test_sensor_config', init_function: 'test_sensor_init' });
    });
});

describe('parts before channels', () => {
    // dualpart mirrors ad74413r: its ADC and DAC sides each init the one chip, and an init may
    // reset it, so a channel set up between the two would be wiped by the second.
    beforeEach(() => { setup_test_config({ modules: [FIXTURE_PLATFORM, FIXTURE_DRIVERS, FIXTURE_ADC_DRIVERS] }); });
    afterEach(() => { teardown_test_config(); });

    function board_workfile(): Workfile {
        const created = create_workfile(FIXTURE_SOC);
        expectOk(created);
        created.value.board = FIXTURE_BOARD;
        return created.value;
    }

    function add(workfile: Workfile, name: string, symbol: string): void {
        const ruleset = load_resolved_ruleset(symbol);
        expectOk(ruleset);
        expectOk(add_symbol(workfile, name, ruleset.value));
    }

    /** `add dualpart --as <interface>`, on the chip already there when there is one. */
    function add_side(workfile: Workfile, interface_: string, chip?: string): void {
        const root = driver_root_for('dualpart', interface_);
        expectOk(root);
        add(workfile, interface_, root.value);
        expectOk(pin_driver(workfile, interface_, 'dualpart', chip));
    }

    function order(workfile: Workfile): string[] {
        expectOk(bootstrap(workfile));
        return load_devices(workfile).map(device => device.descriptor_name);
    }

    test('the DAC side comes before the ADC channel added ahead of it', () => {
        const workfile = board_workfile();
        add_side(workfile, 'test_adc');
        expectOk(bootstrap(workfile));
        add(workfile, 'ch0', 'test_adc_chan');
        add_side(workfile, 'test_dac', 'test_adc_ip');
        expect(order(workfile)).toEqual(['test_adc', 'test_dac', 'ch0']);
    });

    test('a channel still waits for its own ADC, wherever it sits in the workfile', () => {
        const workfile = board_workfile();
        add(workfile, 'ch0', 'test_adc_chan');
        add_side(workfile, 'test_adc');
        expect(order(workfile)).toEqual(['test_adc', 'ch0']);
    });

    test('a part on a board bus is not a channel: it reaches only board handles', () => {
        const workfile = board_workfile();
        add_side(workfile, 'test_adc');
        expectOk(bootstrap(workfile));
        add(workfile, 'ch0', 'test_adc_chan');
        add(workfile, 'sensor', 'test_sensor');
        expectOk(attach_eval_board(workfile, 'eval-testpart', 'sensor'));
        const names = order(workfile);
        // The sensor waits for its bus, and the channel for every part.
        expect(names.indexOf('sensor')).toBeGreaterThan(names.indexOf('bsp_test_spi_cfg_handle'));
        expect(names.at(-1)).toBe('ch0');
    });
});
