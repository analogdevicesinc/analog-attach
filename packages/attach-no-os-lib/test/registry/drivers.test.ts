import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import {
    modules_providing,
    driver_ops_candidates,
    driver_init_parameter_candidates,
    provides_interface,
} from '../../src/registry/drivers';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// A generic node is configured with the driver's own init_param and ops table, and names
// only the interface it is for. Which driver answers comes from each module's declared
// `provides.interfaces`, so nothing matches symbol names against a convention.

describe('interface to driver', () => {
    beforeEach(() => { setup_test_config(); });
    afterEach(() => { teardown_test_config(); });

    test('every module declaring the interface is a provider', () => {
        const providers = modules_providing('test_sensor');
        expectOk(providers);
        // The collection, its category and the driver all declare it; only the driver
        // ships rulesets, which is why candidates are filtered by kind as well.
        expect(providers.value.map(module => module.name).sort()).toEqual(['drivers-test', 'sensor', 'testpart']);
    });

    test('an interface nobody implements has no providers', () => {
        const providers = modules_providing('no_such_interface');
        expectOk(providers);
        expect(providers.value).toEqual([]);
    });

    test('ops candidates are the externs those modules ship', () => {
        const candidates = driver_ops_candidates('test_sensor');
        expectOk(candidates);
        expect(candidates.value.map(entry => entry.$symbol)).toEqual(['testpart_ops']);
    });

    test('init_param candidates are the structs they ship', () => {
        // Every struct, not one matched by an `_init_param` suffix: a driver's rulesets are
        // its own, so what it indexes is what an application may have to fill in.
        const candidates = driver_init_parameter_candidates('test_sensor');
        expectOk(candidates);
        expect(candidates.value.map(entry => entry.$symbol)).toEqual(['testpart_init_param']);
    });

    test('a struct from another module is not a candidate', () => {
        const provides = provides_interface('test_spi_config', 'test_sensor');
        expectOk(provides);
        expect(provides.value).toBe(false);
    });

    test('provenance is what the validator checks, and an unknown symbol provides nothing', () => {
        const known = provides_interface('testpart_init_param', 'test_sensor');
        expectOk(known);
        expect(known.value).toBe(true);

        const unknown = provides_interface('no_such_symbol', 'test_sensor');
        expectOk(unknown);
        expect(unknown.value).toBe(false);
    });
});
