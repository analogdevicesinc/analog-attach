import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { bootstrap } from '../../src/bootstrap/bootstrap';
import { load_devices } from '../../src/codegen/device_loader';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { add_symbol, create_workfile } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// The devices main.c brings up, from a bootstrapped workfile: the sensor handle, and the
// board handles it reaches (the SPI controller, the chip-select's GPIO port).

function sensor_on_otherboard(): Workfile {
    const created = create_workfile('othersoc');
    expectOk(created);
    created.value.board = 'otherboard';
    const ruleset = load_resolved_ruleset('test_sensor');
    expectOk(ruleset);
    expectOk(add_symbol(created.value, 'sensor', ruleset.value));
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
        expect(sensor).toMatchObject({ symbol_name: 'test_sensor_config', init_param_type: 'test_sensor_config', init_function: 'test_sensor_init' });
    });
});
