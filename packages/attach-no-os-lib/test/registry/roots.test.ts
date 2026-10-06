import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { addable_drivers, driver_root, driver_roots } from '../../src/registry/roots';
import { bootstrap_enabled, set_setting_value } from '../../src/settings/settings';
import { expectErrorContains, expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// A part is added through its root: the generic handle whose config takes a driver for an
// interface the driver provides. That is what lets `add <driver>` work with nothing else.

describe('driver roots', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test("a driver's root is the handle whose config takes a driver for its interface", () => {
        // testpart provides test_sensor; test_sensor_config has driver-backed fields for it.
        const roots = driver_roots('testpart');
        expectOk(roots);
        expect(roots.value).toEqual(['test_sensor']);

        const root = driver_root('testpart');
        expectOk(root);
        expect(root.value).toBe('test_sensor');
    });

    test('only single drivers count, not the collection or category that also provide the interface', () => {
        expectErrorContains(driver_roots('drivers-test'), "No configured driver is called 'drivers-test'");
        expectErrorContains(driver_roots('sensor'), "No configured driver is called 'sensor'");
    });

    test('drivers addable by name are listed', () => {
        const drivers = addable_drivers();
        expectOk(drivers);
        expect(drivers.value).toEqual(['testpart']);
    });
});

describe('the bootstrap setting', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('is on unless explicitly turned off', () => {
        expect(bootstrap_enabled()).toBe(true);

        for (const off of ['false', 'FALSE', ' 0 ', 'no', 'off']) {
            expectOk(set_setting_value('bootstrap', off));
            expect(bootstrap_enabled()).toBe(false);
        }

        // Anything else - including a typo - keeps the default rather than silently disabling it.
        for (const on of ['true', 'yes', '1', 'ture']) {
            expectOk(set_setting_value('bootstrap', on));
            expect(bootstrap_enabled()).toBe(true);
        }
    });
});
