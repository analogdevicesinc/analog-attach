import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, setup_test_config, TEST_BOARD, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');
const REAL_NOOS_ROOT = path.dirname(fs.realpathSync(path.join(NOOS_ROOT, 'schemas')));

/*
 * The adxl355 iio_trigger project, against the real schemas: an app, one device entry
 * reached through a member reference (`accel_iio.iio_dev`), one trigger entry reached
 * through an extern (`accel_trig_desc`), and a hardware trigger that needs the irq
 * controller patched into it after that controller is initialized.
 *
 * It is the same workfile the e2e flow builds, kept here so a schema or template change
 * that breaks the iio target fails in the suite rather than at the next manual build.
 *
 * The four derived app fields (`devices`, `nb_devices`, `trigs`, `nb_trigs`) are absent on
 * purpose: they are `readonly` in the schema, so the target fills them in.
 */
const workfile_data: MinimalWorkfile = {
    platform: "max32690",
    board: "ad-apard32690-sl",
    symbols: {
        "spi_extra": { "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml" },
        "uart_extra": { "$compatible": "platforms/maxim/max32690/max_uart_init_param.yaml" },
        "spi_ip": {
            "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
            "device_id": 1,
            "chip_select": 0,
            "platform_ops": "max_spi_ops",
            "extra": "spi_extra",
        },
        "accel_ip": {
            "$compatible": "devices/adxl355/adxl355_init_param.yaml",
            "comm_type": "ADXL355_SPI_COMM",
            "dev_type": "ID_ADXL355",
            "comm_init": { "spi_init": "spi_ip" },
        },
        "accel_iio_ip": {
            "$compatible": "devices/adxl355/adxl355_iio_init_param.yaml",
            "adxl355_dev_init": "accel_ip",
        },
        "accel_iio": {
            "$compatible": "devices/adxl355/adxl355_iio.yaml",
            "$init_param": "accel_iio_ip",
        },
        "accel_buff": {
            "$compatible": "no-os/iio/iio_data_buffer.yaml",
            "size": 4000,
            "buff": "accel_buff_storage",
        },
        "irq_ip": {
            "$compatible": "no-os/irq/no_os_irq_init_param.yaml",
            "irq_ctrl_id": 0,
            "platform_ops": "max_irq_ops",
        },
        "irq_ctrl": {
            "$compatible": "no-os/irq/no_os_irq.yaml",
            "$init_param": "irq_ip",
        },
        "cb": {
            "$compatible": "no-os/iio/iio_hw_trig_cb_info.yaml",
            "event": "NO_OS_EVT_GPIO",
            "peripheral": "NO_OS_GPIO_IRQ",
            "handle": "MXC_TMR0",
        },
        "trig_ip": {
            "$compatible": "no-os/iio/iio_hw_trig_init_param.yaml",
            "irq_ctrl": "irq_ctrl",
            "irq_id": 4,
            "irq_trig_lvl": "NO_OS_IRQ_EDGE_FALLING",
            "cb_info": "cb",
            "name": "adxl355-dev0",
        },
        "trig": {
            "$compatible": "no-os/iio/iio_hw_trig.yaml",
            "$init_param": "trig_ip",
        },
        "accel_trig_desc": { "$compatible": "devices/adxl355/iio_adxl355_trig_desc.yaml" },
        "trig_entry": {
            "$compatible": "no-os/iio/iio_trigger_init.yaml",
            "name": "adxl355-dev0",
            "trig": "trig",
            "descriptor": "accel_trig_desc",
        },
        "dev_entry": {
            "$compatible": "no-os/iio/iio_app_device.yaml",
            "name": "adxl355",
            "dev": "accel_iio",
            "dev_descriptor": "accel_iio.iio_dev",
            "read_buff": "accel_buff",
            "default_trigger_id": "adxl355-dev0",
        },
        "ctx_attr": {
            "$compatible": "no-os/iio/iio_ctx_attr.yaml",
            "name": "hw_model",
            "value": "ADXL355",
        },
        "app_uart_ip": {
            "$compatible": "no-os/uart/no_os_uart_init_param.yaml",
            "device_id": 0,
            "baud_rate": 115_200,
            "platform_ops": "max_uart_ops",
            "extra": "uart_extra",
        },
        "app_ip": {
            "$compatible": "no-os/iio/iio_app_init_param.yaml",
            "uart_init_params": "app_uart_ip",
            "irq_desc": "irq_ctrl",
        },
        "app": {
            "$compatible": "no-os/iio/iio_app.yaml",
            "$init_param": "app_ip",
        },
    },
};

describe('no-os-iio target', () => {
    let temporary_directory: string;
    let main_c: string;
    let common_data_c: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iio-app-test-'));

        const import_result = import_minimal(workfile_data);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            board: TEST_BOARD,
            project_name: "iio_demo",
            output_path: temporary_directory,
            noos_path: REAL_NOOS_ROOT,
            template_set: "no-os-iio",
        });
        expectOk(result);

        const source = path.join(temporary_directory, 'iio_demo', 'src');
        main_c = fs.readFileSync(path.join(source, 'main.c'), 'utf8');
        common_data_c = fs.readFileSync(path.join(source, 'common', 'common_data.c'), 'utf8');
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    // The array names and the fields they are assigned to come from the schema, not from a
    // list in the template: `devices` is the one field including iio_app_device, and
    // `nb_devices` is the `count` declared beside it.
    test('builds the two lists and hands them to the app', () => {
        expect(main_c).toContain('struct iio_app_device iio_devices[] = {');
        expect(main_c).toContain('struct iio_trigger_init iio_trigs[] = {');
        expect(main_c).toContain('app_ip.devices = iio_devices;');
        expect(main_c).toContain('app_ip.nb_devices = NO_OS_ARRAY_SIZE(iio_devices);');
        expect(main_c).toContain('app_ip.trigs = iio_trigs;');
        expect(main_c).toContain('app_ip.nb_trigs = NO_OS_ARRAY_SIZE(iio_trigs);');
    });

    // Those four fields are `readonly`, so nothing tries to initialize them at file scope
    // where the arrays do not exist yet.
    test('the derived app fields stay out of the file-scope initializer', () => {
        const initializer = common_data_c.slice(common_data_c.indexOf('app_init_param app_ip'));
        expect(initializer).toContain('.uart_init_params = app_uart_ip');
        for (const field of ['.devices', '.nb_devices', '.trigs', '.nb_trigs']) {
            expect(initializer.slice(0, initializer.indexOf('};'))).not.toContain(field);
        }
    });

    // The extern emits the library symbol it names, not the workfile node name, because it
    // is a global no-OS already compiles.
    test('reaches a device through a member and a trigger through an extern', () => {
        expect(main_c).toContain('.dev_descriptor = desc.accel_iio->iio_dev,');
        expect(main_c).toContain('.descriptor = &adxl355_iio_trig_desc,');
    });

    // The patch reads a descriptor the irq init fills in, so emitting it before that init
    // would copy NULL. See patch_schedule.ts.
    test('patches the trigger init_param after the irq controller is initialized', () => {
        const irq_init = main_c.indexOf('no_os_irq_ctrl_init(&desc.irq_ctrl');
        const patch = main_c.indexOf('trig_ip.irq_ctrl = desc.irq_ctrl;');
        const trig_init = main_c.indexOf('iio_hw_trig_init(&desc.trig');

        expect(irq_init).toBeGreaterThan(-1);
        expect(trig_init).toBeGreaterThan(-1);
        expect(patch).toBeGreaterThan(irq_init);
        expect(patch).toBeLessThan(trig_init);
    });

    // The trigger is built before the app, so the iio_desc it needs does not exist yet.
    test('backpatches the trigger with the iio_desc the app creates', () => {
        const app_init = main_c.indexOf('iio_app_init(&desc.app');
        const backpatch = main_c.indexOf('desc.trig->iio_desc = desc.app->iio_desc;');

        expect(app_init).toBeGreaterThan(-1);
        expect(backpatch).toBeGreaterThan(app_init);
        expect(main_c.indexOf('iio_app_run(desc.app)')).toBeGreaterThan(backpatch);
    });

    // The buffer storage is an array no schema can describe, so the target emits it.
    test('emits the data buffer storage from its size', () => {
        expect(common_data_c).toContain('uint8_t accel_buff_storage[4000];');
    });
});

/*
 * The ad7124, which exercises the extern path twice over in one project: a struct extern
 * (`iio_ad7124_device`, taken by address) and an array extern (`ad7124_regs`, which must NOT
 * be), plus arrays of struct elements for the channel map and setups.
 *
 * ad7124 has no iio wrapper descriptor, so `dev` points at the plain device descriptor and
 * `dev_descriptor` at the driver's global — the other half of the two shapes the iio target
 * has to support.
 */
const ad7124_workfile: MinimalWorkfile = {
    platform: "max32690",
    board: "ad-apard32690-sl",
    symbols: {
        "spi_extra": { "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml" },
        "uart_extra": { "$compatible": "platforms/maxim/max32690/max_uart_init_param.yaml" },
        "spi_ip": {
            "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
            "device_id": 4,
            "chip_select": 0,
            "mode": "NO_OS_SPI_MODE_3",
            "platform_ops": "max_spi_ops",
            "extra": "spi_extra",
        },
        "regs": { "$compatible": "devices/ad7124/ad7124_regs.yaml" },
        "setup0": {
            "$compatible": "devices/ad7124/structs/ad7124_channel_setup.yaml",
            "bi_unipolar": true,
            "ref_source": "INTERNAL_REF",
        },
        "ch0_ain": {
            "$compatible": "devices/ad7124/structs/ad7124_analog_inputs.yaml",
            "ainp": "AD7124_AIN0",
            "ainm": "AD7124_AIN1",
        },
        "ch0": {
            "$compatible": "devices/ad7124/structs/ad7124_channel_map.yaml",
            "channel_enable": true,
            "setup_sel": 0,
            "ain": "ch0_ain",
        },
        "adc_ip": {
            "$compatible": "devices/ad7124/ad7124_init_param.yaml",
            "spi_init": "spi_ip",
            "regs": "regs",
            "active_device": "ID_AD7124_8",
            "setups": ["setup0"],
            "chan_map": ["ch0"],
        },
        "adc": {
            "$compatible": "devices/ad7124/ad7124.yaml",
            "$init_param": "adc_ip",
        },
        "adc_iio_dev": { "$compatible": "devices/ad7124/iio_ad7124_device.yaml" },
        "adc_buff": {
            "$compatible": "no-os/iio/iio_data_buffer.yaml",
            "size": 4800,
            "buff": "adc_buff_storage",
        },
        "dev_entry": {
            "$compatible": "no-os/iio/iio_app_device.yaml",
            "name": "ad7124",
            "dev": "adc",
            "dev_descriptor": "adc_iio_dev",
            "read_buff": "adc_buff",
        },
        "app_uart_ip": {
            "$compatible": "no-os/uart/no_os_uart_init_param.yaml",
            "device_id": 0,
            "baud_rate": 115_200,
            "platform_ops": "max_uart_ops",
            "extra": "uart_extra",
        },
        "app_ip": {
            "$compatible": "no-os/iio/iio_app_init_param.yaml",
            "uart_init_params": "app_uart_ip",
        },
        "app": {
            "$compatible": "no-os/iio/iio_app.yaml",
            "$init_param": "app_ip",
        },
    },
};

describe('no-os-iio target, ad7124', () => {
    let temporary_directory: string;
    let main_c: string;
    let common_data_c: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ad7124-iio-test-'));

        const import_result = import_minimal(ad7124_workfile);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            board: TEST_BOARD,
            project_name: "ad7124_iio",
            output_path: temporary_directory,
            noos_path: REAL_NOOS_ROOT,
            template_set: "no-os-iio",
        });
        expectOk(result);

        const source = path.join(temporary_directory, 'ad7124_iio', 'src');
        main_c = fs.readFileSync(path.join(source, 'main.c'), 'utf8');
        common_data_c = fs.readFileSync(path.join(source, 'common', 'common_data.c'), 'utf8');
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    // The whole point of `$array` on an extern. `&ad7124_regs` has type
    // `struct ad7124_st_reg (*)[57]`, which is not what `.regs` takes, so the `&` the
    // pointer property would otherwise add has to be suppressed.
    test('an array extern is emitted without an address-of', () => {
        expect(common_data_c).toContain('.regs = ad7124_regs,');
        expect(common_data_c).not.toContain('&ad7124_regs');
    });

    // The other extern in the same file does take its address, so the two shapes are
    // distinguished by the schema rather than by a rule about externs in general.
    test('a struct extern in the same project still takes its address', () => {
        expect(main_c).toContain('.dev_descriptor = &iio_ad7124_device,');
    });

    // No iio wrapper exists for this part, so the device descriptor itself is what `dev` names.
    test('reaches the device through the plain descriptor', () => {
        expect(main_c).toContain('.dev = desc.adc,');
        expect(main_c).toContain('ad7124_setup(&desc.adc, &adc_ip);');
    });

    // Arrays of struct elements are emitted as brace-enclosed lists of the element symbols.
    test('emits the channel map and setup arrays', () => {
        expect(common_data_c).toContain('.setups = { setup0 },');
        expect(common_data_c).toContain('.chan_map = { ch0 },');
    });
});
