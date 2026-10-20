import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { bootstrap, pin_driver } from '../../src/bootstrap/bootstrap';
import { generate_project } from '../../src/codegen/codegen';
import { driver_init_parameter_candidates } from '../../src/registry/drivers';
import { find_board } from '../../src/registry/platforms';
import { driver_root } from '../../src/registry/roots';
import { unidentified_bus_connectors } from '../../src/registry/wiring';
import { load_resolved_ruleset } from '../../src/resolver/resolver';
import { validate_workfile } from '../../src/validator/validator';
import { add_symbol, create_workfile, export_minimal, set_value } from '../../src/workfile_handler/workfile_handler';
import type { ModuleInfo } from '../../src/registry/types';
import type { Workfile } from '../../src/workfile_handler/types';
import {
    expectOk,
    setup_test_config,
    teardown_test_config,
    FIXTURE_ADC_DRIVERS,
    FIXTURE_BOARD,
    FIXTURE_CAPI,
    FIXTURE_DRIVERS,
    FIXTURE_PLATFORM,
    FIXTURE_SOC,
} from '../test_utilities';

// A struct a non-pointer include names is embedded: the C member IS that struct. The fixture's
// otheradc mirrors ad7156, whose generic handle takes the adapter's ad7156_capi_init_param,
// which embeds the part's own ad7156_init_param as `device`. otheradc_capi_init_param embeds
// otheradc_init_param the same way, and two otheradc_channel structs as an array.

function otheradc_workfile(): Workfile {
    const created = create_workfile(FIXTURE_SOC);
    expectOk(created);
    created.value.board = FIXTURE_BOARD;
    const root = driver_root('otheradc');
    expectOk(root);
    const ruleset = load_resolved_ruleset(root.value);
    expectOk(ruleset);
    expectOk(add_symbol(created.value, 'adc', ruleset.value));
    expectOk(pin_driver(created.value, 'adc', 'otheradc'));
    expectOk(bootstrap(created.value));
    return created.value;
}

function stored(workfile: Workfile): Record<string, Record<string, unknown>> {
    const exported = export_minimal(workfile);
    expectOk(exported);
    return exported.value.symbols as Record<string, Record<string, unknown>>;
}

describe('a struct embedded in another is a part of it', () => {
    beforeEach(() => { setup_test_config({ modules: [FIXTURE_PLATFORM, FIXTURE_DRIVERS, FIXTURE_ADC_DRIVERS] }); });
    afterEach(() => { teardown_test_config(); });

    test('so it is not what a handle takes', () => {
        const candidates = driver_init_parameter_candidates('test_adc');
        expectOk(candidates);
        const otheradc = candidates.value.filter(entry => entry.module.name === 'otheradc').map(entry => entry.$symbol);
        expect(otheradc).toEqual(['otheradc_capi_init_param']);
    });

    test('add <driver> pins the struct that embeds it, and bootstrap fills the part in', () => {
        const symbols = stored(otheradc_workfile());
        expect(symbols['test_adc_config']?.extra).toBe('otheradc_capi_init_param');
        expect(symbols['otheradc_capi_init_param']?.device).toBe('otheradc_init_param');
        expect(symbols['otheradc_init_param']).toMatchObject({ rate: 1000, bus: 'bsp_test_spi_cfg_handle' });
    });

    test('naming the embedded one as the extra is an error, which says what the driver takes', () => {
        const workfile = otheradc_workfile();
        expectOk(set_value(workfile, 'test_adc_config', 'extra', 'otheradc_init_param'));
        const messages = validate_workfile(workfile).errors.filter(entry => entry.severity === 'error').map(entry => entry.message);
        expect(messages.join('\n')).toContain("'otheradc_init_param' (otheradc_init_param) is not a test_adc init_param: its driver takes otheradc_capi_init_param");
    });
});

describe('an embedded struct in the generated C', () => {
    let output: string;

    beforeEach(() => {
        setup_test_config({ modules: [FIXTURE_PLATFORM, FIXTURE_DRIVERS, FIXTURE_ADC_DRIVERS] });
        output = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-embedded-'));
    });
    afterEach(() => {
        teardown_test_config();
        fs.rmSync(output, { recursive: true, force: true });
    });

    function generated(workfile: Workfile): { c: string, h: string, main: string } {
        const board = find_board(FIXTURE_BOARD);
        expectOk(board);
        expectOk(generate_project({
            workfile, platform_name: FIXTURE_SOC, platform_vendor: 'testvendor', board: board.value,
            project_name: 'embedded', project_path: path.join(output, 'embedded'), capi_path: FIXTURE_CAPI, template_set: 'capi',
        }));
        const source = (file: string): string => fs.readFileSync(path.join(output, 'embedded', 'src', file), 'utf8');
        return { c: source('common/common_data.c'), h: source('common/common_data.h'), main: source('main.c') };
    }

    function with_channels(): Workfile {
        const workfile = otheradc_workfile();
        for (const name of ['ch_a', 'ch_b']) {
            const channel = load_resolved_ruleset('otheradc_channel');
            expectOk(channel);
            expectOk(add_symbol(workfile, name, channel.value));
        }
        expectOk(bootstrap(workfile));
        expectOk(set_value(workfile, 'ch_b', 'gain', 4));
        expectOk(set_value(workfile, 'otheradc_capi_init_param', 'channels', ['ch_a', 'ch_b']));
        return workfile;
    }

    test('is written inside its owner, never as a global of its own', () => {
        const { c, h } = generated(with_channels());
        expect(c).toContain('.device = { .rate = 1000 },');
        expect(c).not.toMatch(/struct otheradc_init_param \w+ = /);
        expect(h).not.toContain('otheradc_init_param otheradc_init_param');
        expect(h).toContain('extern struct otheradc_capi_init_param otheradc_capi_init_param;');
    });

    test('an array of them is an array of initializers', () => {
        const { c, h } = generated(with_channels());
        expect(c).toContain('.channels = { { .gain = 1 }, { .gain = 4 } },');
        expect(h).not.toContain('struct otheradc_channel ch_a');
    });

    test('a handle inside it is patched through the global it lives in', () => {
        const { main } = generated(with_channels());
        expect(main).toContain('otheradc_capi_init_param.device.bus = bsp_test_spi_cfg_handle;');
        // Before the ADC is brought up from it.
        expect(main.indexOf('otheradc_capi_init_param.device.bus')).toBeLessThan(main.indexOf('test_adc_init('));
    });
});

describe('a connector the wiring cannot name', () => {
    test('is one with pins for the bus but no id', () => {
        const part = {
            name: 'eval-x',
            connectors: [
                { name: 'J1 (8-pin Pmod, I2C)', pins: [{ pin: '1', roles: ['i2c_scl'] }] },
                { name: 'J2', id: 'J2', pins: [{ pin: '1', roles: ['i2c_sda'] }] },
                { name: 'J3 (power)', pins: [{ pin: '1', roles: ['power'] }] },
            ],
        } as unknown as ModuleInfo;
        expect(unidentified_bus_connectors(part, 'i2c')).toEqual(['J1 (8-pin Pmod, I2C)']);
        expect(unidentified_bus_connectors(part, 'spi')).toEqual([]);
    });
});
