import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { bootstrap, referenced_nodes } from '../../src/bootstrap/bootstrap';
import { driver_root } from '../../src/registry/roots';
import { load_resolved_ruleset_for_board } from '../../src/resolver/resolver';
import { validate_workfile } from '../../src/validator/validator';
import {
    add_symbol,
    create_workfile,
    export_minimal,
    import_minimal,
    remove_symbol,
    set_value,
} from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// Bootstrap against the real CAPI repos: the ADXL355 Pmod on the MAX32655FTHR, the pair the
// rulesets were written for. The fixtures cover the rules; this catches the repos drifting
// from what the rules assume (a renamed symbol, a board.yml losing its `pins:`).
//
// The repos are found from CAPI_PATH and CAPI_MODULE_PATHS (":"-separated), or from the
// usual checkouts next door. Without them the suite is skipped.

function find_repos(): { capi: string, modules: string[] } | undefined {
    const home = path.join(os.homedir(), 'aurel');
    const capi = process.env.CAPI_PATH ?? path.join(home, 'capi');
    const modules = process.env.CAPI_MODULE_PATHS?.split(':') ?? [path.join(home, 'capi-maxim'), path.join(home, 'capi-noos')];
    return [capi, ...modules].every(directory => fs.existsSync(directory)) ? { capi, modules } : undefined;
}

const REPOS = find_repos();
const BOARD = 'max32655fthr';

function stored(workfile: Workfile): Record<string, Record<string, unknown>> {
    const exported = export_minimal(workfile);
    expectOk(exported);
    return exported.value.symbols as Record<string, Record<string, unknown>>;
}

/** What `attach-noos add adxl355` does: the driver's root, named after the driver, then bootstrap. */
function add_adxl355(workfile: Workfile, name: string): void {
    const root = driver_root('adxl355');
    expectOk(root);
    const ruleset = load_resolved_ruleset_for_board(root.value, BOARD);
    expectOk(ruleset);
    expectOk(add_symbol(workfile, name, ruleset.value));
    expectOk(bootstrap(workfile));
}

function board_workfile(): Workfile {
    const created = create_workfile('max32655');
    expectOk(created);
    created.value.board = BOARD;
    return created.value;
}

describe.skipIf(REPOS === undefined)('adxl355 on max32655fthr, from the real repos', () => {
    beforeEach(() => { setup_test_config(REPOS); });
    afterEach(() => { teardown_test_config(); });

    test('one node becomes a valid workfile, on the board\'s SPI bus and chip-select', () => {
        const workfile = board_workfile();
        add_adxl355(workfile, 'adxl355');

        expect(validate_workfile(workfile).valid).toBe(true);
        const symbols = stored(workfile);
        expect(symbols['capi_spi_device']?.controller).toBe('bsp_spi1_cfg_handle');
        // P2_0, J9 pin 5: the chip-select line board.yml declares for this bus.
        expect(symbols['capi_gpio_pin']).toMatchObject({ port_handle: 'bsp_gpio2_cfg_handle', number: 0 });
    });

    test('a second one gets a chain of its own, but not the taken chip-select', () => {
        const workfile = board_workfile();
        add_adxl355(workfile, 'adxl355');
        add_adxl355(workfile, 'adxl355_1');

        const symbols = stored(workfile);
        expect(symbols['adxl355_init_param_1']?.comm_init).toEqual({ spi_dev: 'capi_spi_device_1' });
        expect(symbols['capi_spi_device_1']?.controller).toBe('bsp_spi1_cfg_handle');
        expect(symbols['capi_spi_device_1']?.cs_gpio).toBeUndefined();
        // validate is what tells the user: the second device has no chip-select yet.
        const errors = validate_workfile(workfile).errors.map(entry => entry.path);
        expect(errors).toContain('capi_spi_device_1.cs_gpio');
    });

    test('switching to I2C rebuilds the bus and deletes the SPI side', () => {
        const workfile = board_workfile();
        add_adxl355(workfile, 'adxl355');
        expectOk(set_value(workfile, 'adxl355_init_param', 'comm_type', 'ADXL355_I2C_COMM'));
        const report = bootstrap(workfile);
        expectOk(report);

        expect(validate_workfile(workfile).valid).toBe(true);
        const symbols = stored(workfile);
        expect(symbols['capi_i2c_device']).toMatchObject({ controller: 'bsp_i2c2_cfg_handle', address: 0x1D });
        expect(report.value.deleted.sort()).toEqual(['capi_gpio_pin', 'capi_spi_device']);
    });

    test('deleting the root takes the whole chain with it', () => {
        const workfile = board_workfile();
        add_adxl355(workfile, 'adxl355');
        const before = referenced_nodes(workfile);
        expectOk(remove_symbol(workfile, 'adxl355'));
        expectOk(bootstrap(workfile, { referenced_before: before }));

        expect(stored(workfile)).toEqual({});
    });

    test('the bootstrapped workfile survives a save and load unchanged', () => {
        const workfile = board_workfile();
        add_adxl355(workfile, 'adxl355');
        const exported = export_minimal(workfile);
        expectOk(exported);
        const reloaded = import_minimal(JSON.parse(JSON.stringify(exported.value)));
        expectOk(reloaded);

        expect(stored(reloaded.value)).toEqual(stored(workfile));
        expect(validate_workfile(reloaded.value).valid).toBe(true);
    });
});
