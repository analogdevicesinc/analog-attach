import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { attach_eval_board, bootstrap, pin_driver, referenced_nodes } from '../../src/bootstrap/bootstrap';
import { generate_project } from '../../src/codegen/codegen';
import { find_board } from '../../src/registry/platforms';
import { driver_root, driver_root_for } from '../../src/registry/roots';
import { load_resolved_ruleset_for_board } from '../../src/resolver/resolver';
import { validate_workfile } from '../../src/validator/validator';
import { add_symbol, create_workfile, set_value } from '../../src/workfile_handler/workfile_handler';
import type { Workfile } from '../../src/workfile_handler/types';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';

// Generated CAPI apps, built for real: each config is put together the way the CLI does it
// (a driver's root, then bootstrap), generated with the capi template set, then configured
// and built with the platform toolchain. "Builds nicely" means CMake succeeds and the
// generated sources compile without a single warning.
//
// Slow (a full firmware build per config), so only on request:
//
//   AA_BUILD_TESTS=1 MAXIM_SDK_PATH=~/MaximSDK npx vitest run test/integration/capi_build.test.ts
//
// It also needs the CAPI repos (CAPI_PATH / CAPI_MODULE_PATHS, or the checkouts next door,
// capi-util included), cmake and ninja. Anything missing skips the suite.

const BOARD = 'max32655fthr';
const BUILD_TIMEOUT = 600_000;

function find_repos(): { capi: string, modules: string[] } | undefined {
    const home = path.join(os.homedir(), 'aurel');
    const capi = process.env.CAPI_PATH ?? path.join(home, 'capi');
    const modules = process.env.CAPI_MODULE_PATHS?.split(':')
        ?? ['capi-maxim', 'capi-noos', 'capi-util'].map(name => path.join(home, name));
    return [capi, ...modules].every(directory => fs.existsSync(directory)) ? { capi, modules } : undefined;
}

function has_tool(command: string): boolean {
    return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

const REPOS = find_repos();
const ENABLED = process.env.AA_BUILD_TESTS === '1'
    && REPOS !== undefined
    && process.env.MAXIM_SDK_PATH !== undefined
    && has_tool('cmake') && has_tool('ninja');

/** The eval board each part sits on in these tests. */
const EVAL_BOARDS: Record<string, string> = {
    adxl355: 'eval-adxl355-pmdz',
    ad74413r: 'eval-ad-swio-2-click',
    adt7420: 'eval-adt7420-pmdz',
    ad7156: 'eval-pmodcdc1',
};

function board_workfile(): Workfile {
    const created = create_workfile('max32655');
    expectOk(created);
    created.value.board = BOARD;
    return created.value;
}

/** What `attach-noos add <driver>` does. */
function add_driver(workfile: Workfile, driver: string, name: string, interface_?: string): void {
    const root = interface_ === undefined ? driver_root(driver) : driver_root_for(driver, interface_);
    expectOk(root);
    const ruleset = load_resolved_ruleset_for_board(root.value, BOARD);
    expectOk(ruleset);
    expectOk(add_symbol(workfile, name, ruleset.value));
    expectOk(pin_driver(workfile, name, driver));
    // On its eval board, as `attach-noos add <eval board>` puts it, so its pinout wires it. A
    // part with none is a bare part, as `attach-noos add <driver>` adds it.
    const eval_board = EVAL_BOARDS[driver];
    if (eval_board !== undefined) {
        expectOk(attach_eval_board(workfile, eval_board, name));
    }
    expectOk(bootstrap(workfile));
}

/** What `attach-noos update` does: write the value, then let bootstrap follow. */
function update(workfile: Workfile, node: string, property: string, value: unknown): void {
    const before = referenced_nodes(workfile);
    expectOk(set_value(workfile, node, property, value));
    expectOk(bootstrap(workfile, { referenced_before: before }));
}

/** Generate the workfile into a fresh directory, configure and build it; the build output. */
function generate_and_build(workfile: Workfile, project_name: string): string {
    expect(validate_workfile(workfile).errors.filter(entry => entry.severity === 'error')).toEqual([]);

    const output_path = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-capi-build-'));
    const board = find_board(BOARD);
    expectOk(board);
    expectOk(generate_project({
        workfile,
        platform_name: 'max32655',
        platform_vendor: 'maxim',
        board: board.value,
        project_name,
        output_path,
        capi_path: REPOS?.capi ?? '',
        template_set: 'capi',
    }));

    const project = path.join(output_path, project_name);
    const environment = { ...process.env, CAPI_DIR: REPOS?.capi ?? '' };
    const run = (arguments_: string[]): string =>
        execFileSync('cmake', arguments_, { cwd: project, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    let log = '';
    try {
        log += run(['--preset', BOARD]);
        log += run(['--build', 'build']);
    } catch (failure) {
        const { stdout, stderr } = failure as { stdout?: string, stderr?: string };
        throw new Error(`${project_name} failed to build:\n${log}${stdout ?? ''}${stderr ?? ''}`.slice(-4000));
    }

    const target = `${project_name.replace(/-/g, '_')}_app`;
    expect(fs.existsSync(path.join(project, 'build', `${target}.elf`))).toBe(true);
    fs.rmSync(output_path, { recursive: true, force: true });
    return log;
}

/** Warnings the compiler raised in the generated sources (not the SDKs or drivers). */
function generated_warnings(log: string): string[] {
    return log.split('\n').filter(line => /warning:/.test(line) && /\bsrc\/(main|common|bsp)\b/.test(line));
}

describe.skipIf(!ENABLED)('generated CAPI apps build on max32655fthr', () => {
    beforeEach(() => { setup_test_config(REPOS); });
    afterEach(() => { teardown_test_config(); });

    test('adxl355 over SPI', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'adxl355', 'adxl355');
        expect(generated_warnings(generate_and_build(workfile, 'adxl355-spi'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('adxl355 switched to I2C', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'adxl355', 'adxl355');
        update(workfile, 'adxl355_init_param', 'comm_type', 'ADXL355_I2C_COMM');
        expect(Object.keys(workfile.symbols)).toContain('capi_i2c_device');
        expect(generated_warnings(generate_and_build(workfile, 'adxl355-i2c'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('ad74413r', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'ad74413r', 'ad74413r', 'adc');
        expect(generated_warnings(generate_and_build(workfile, 'ad74413r'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('ad74413r with an ADC channel', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'ad74413r', 'ad74413r', 'adc');
        const channel = load_resolved_ruleset_for_board('capi_adc_chan', BOARD);
        expectOk(channel);
        expectOk(add_symbol(workfile, 'ch0', channel.value));
        expectOk(bootstrap(workfile));
        update(workfile, 'capi_adc_chan_config', 'chan_id', 0);
        update(workfile, 'ad74413r_channel_config', 'function', 'AD74413R_VOLTAGE_IN');
        update(workfile, 'ad74413r_channel_config', 'enabled', true);
        expect(generated_warnings(generate_and_build(workfile, 'ad74413r-channel'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('ad74413r ADC and DAC on one chip, a channel on each', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'ad74413r', 'ad74413r_adc', 'adc');
        // `add ad74413r --as adc,dac`: the DAC side shares the chip's init_param.
        const dac = driver_root_for('ad74413r', 'dac');
        expectOk(dac);
        const dac_ruleset = load_resolved_ruleset_for_board(dac.value, BOARD);
        expectOk(dac_ruleset);
        expectOk(add_symbol(workfile, 'ad74413r_dac', dac_ruleset.value));
        expectOk(pin_driver(workfile, 'ad74413r_dac', 'ad74413r', 'ad74413r_init_param'));
        expectOk(bootstrap(workfile));
        for (const [schema, name] of [['capi_adc_chan', 'adc_ch0'], ['capi_dac_chan', 'dac_ch1']] as const) {
            const channel = load_resolved_ruleset_for_board(schema, BOARD);
            expectOk(channel);
            expectOk(add_symbol(workfile, name, channel.value));
            expectOk(bootstrap(workfile));
        }
        update(workfile, 'capi_adc_chan_config', 'chan_id', 0);
        update(workfile, 'capi_dac_chan_config', 'chan_id', 1);
        update(workfile, 'ad74413r_channel_config', 'function', 'AD74413R_VOLTAGE_IN');
        update(workfile, 'ad74413r_channel_config_1', 'function', 'AD74413R_VOLTAGE_OUT');

        expect(Object.keys(workfile.symbols).filter(name => workfile.symbols[name]?.$symbol === 'ad74413r_init_param')).toEqual(['ad74413r_init_param']);
        expect(generated_warnings(generate_and_build(workfile, 'ad74413r-adc-dac'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('a SPI controller the user configures by hand', () => {
        const workfile = board_workfile();
        const config = load_resolved_ruleset_for_board('capi_spi_config', BOARD);
        expectOk(config);
        expectOk(add_symbol(workfile, 'my_spi', config.value));
        expectOk(bootstrap(workfile));
        update(workfile, 'my_spi', 'identifier', 0);
        const controller = load_resolved_ruleset_for_board('capi_spi_controller', BOARD);
        expectOk(controller);
        expectOk(add_symbol(workfile, 'my_ctrl', controller.value));
        expectOk(bootstrap(workfile));
        update(workfile, 'my_ctrl', '$init_param', 'my_spi');
        expect(generated_warnings(generate_and_build(workfile, 'hand-made-spi'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('adt7420 over I2C', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'adt7420', 'adt7420');
        expect(Object.keys(workfile.symbols)).toContain('capi_i2c_device');
        expect(generated_warnings(generate_and_build(workfile, 'adt7420'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('ad7156 over I2C, its native config embedded in the adapter\'s', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'ad7156', 'ad7156');
        expect(Object.keys(workfile.symbols)).toEqual(expect.arrayContaining(['ad7156_capi_init_param', 'ad7156_init_param', 'capi_i2c_device']));
        expect(generated_warnings(generate_and_build(workfile, 'ad7156'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('max31889 over I2C, a bare part', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'max31889', 'max31889');
        expect(Object.keys(workfile.symbols)).toEqual(expect.arrayContaining(['max31889_init_param', 'capi_i2c_device']));
        expect(generated_warnings(generate_and_build(workfile, 'max31889'))).toEqual([]);
    }, BUILD_TIMEOUT);

    test('adxl355 and ad74413r on one bus, the second chip-select set by hand', () => {
        const workfile = board_workfile();
        add_driver(workfile, 'adxl355', 'adxl355');
        add_driver(workfile, 'ad74413r', 'ad74413r', 'adc');

        // The board's one declared chip-select line is taken, so the second device is left
        // without one. Set it the way a user would: a pin node on P2_1 (J9 pin 6).
        const pin = load_resolved_ruleset_for_board('capi_gpio_pin', BOARD);
        expectOk(pin);
        expectOk(add_symbol(workfile, 'ad74413r_cs', pin.value));
        update(workfile, 'ad74413r_cs', 'port_handle', 'bsp_gpio2_cfg_handle');
        update(workfile, 'ad74413r_cs', 'number', 1);
        update(workfile, 'capi_spi_device_1', 'cs_gpio', 'ad74413r_cs');

        expect(generated_warnings(generate_and_build(workfile, 'two-parts'))).toEqual([]);
    }, BUILD_TIMEOUT);
});
