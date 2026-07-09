import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');
const SCHEMAS_ROOT = path.join(NOOS_ROOT, 'schemas');

const test_workfile: MinimalWorkfile = {
    platform: "max32690",
    symbols: {
        "max_spi_ip": {
            "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
            "vssel": "MXC_GPIO_VSSEL_VDDIOH",
            "polarity": "SPI_SS_POL_LOW"
        },
        "no_os_spi_ip": {
            "$compatible": "no-os/no_os_spi_init_param.yaml",
            "device_id": 1,
            "max_speed_hz": 1_000_000,
            "chip_select": 2,
            "platform_ops": "spi_ops",
            "extra": "max_spi_ip"
        },
        "misp": {
            "$compatible": "devices/adxl355/adxl355.yaml",
            "comm_type": "ADXL355_SPI_COMM",
            "dev_type": "ID_ADXL355",
            "comm_init": { "spi_init": "no_os_spi_ip" }
        }
    }
};

describe('codegen', () => {
    let temporary_directory: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-test-'));
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    test('generate project from minimal workfile', () => {
        const minimal = test_workfile;

        const import_result = import_minimal(minimal);
        expectOk(import_result);

        const workfile = import_result.value;

        const result = generate_project({
            workfile,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });

        expectOk(result);

        // Check files were created
        expect(result.value.files_created.length).toBeGreaterThan(0);

        // Print common_data.h for visual inspection
        const common_data_h = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.h"),
            "utf8"
        );
        console.log("\n=== common_data.h ===");
        console.log(common_data_h);

        // Print common_data.c for visual inspection
        const common_data_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.c"),
            "utf8"
        );
        console.log("\n=== common_data.c ===");
        console.log(common_data_c);

        // Print src.mk for visual inspection
        const source_mk = fs.readFileSync(
            path.join(temporary_directory, "test-project/src.mk"),
            "utf8"
        );
        console.log("\n=== src.mk ===");
        console.log(source_mk);

        // Print main.c for visual inspection
        const main_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/main.c"),
            "utf8"
        );
        console.log("\n=== main.c ===");
        console.log(main_c);

        // Print user_app.h for visual inspection
        const user_app_h = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/user_app.h"),
            "utf8"
        );
        console.log("\n=== user_app.h ===");
        console.log(user_app_h);
    });

    test('empty array generates { 0 }', () => {
        const minimal: MinimalWorkfile = {
            platform: "max32690",
            symbols: {
                "my_ad5592r": {
                    "$compatible": "devices/ad5592r/ad5592r.yaml",
                    "channel_modes": []
                }
            }
        };

        const import_result = import_minimal(minimal);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });

        expectOk(result);

        const common_data_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.c"),
            "utf8"
        );

        expect(common_data_c).toContain(".channel_modes = { 0 }");
    });

    test('partial array generates correct values', () => {
        const minimal: MinimalWorkfile = {
            platform: "max32690",
            symbols: {
                "my_ad5592r": {
                    "$compatible": "devices/ad5592r/ad5592r.yaml",
                    "channel_modes": ["CH_MODE_ADC", "CH_MODE_DAC"]
                }
            }
        };

        const import_result = import_minimal(minimal);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });

        expectOk(result);

        const common_data_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.c"),
            "utf8"
        );

        expect(common_data_c).toContain(".channel_modes = { CH_MODE_ADC, CH_MODE_DAC }");
    });

    test('include_descriptor generates devices.descriptor reference', () => {
        const minimal: MinimalWorkfile = {
            platform: "max32690",
            symbols: {
                "parent_spi_ip": {
                    "$compatible": "no-os/no_os_spi_init_param.yaml",
                    "$descriptor": "parent_spi",
                    "device_id": 1,
                    "chip_select": 0,
                    "platform_ops": "spi_ops",
                    "extra": "max_spi_ip"
                },
                "max_spi_ip": {
                    "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
                    "vssel": "MXC_GPIO_VSSEL_VDDIOH",
                    "polarity": "SPI_SS_POL_LOW"
                },
                "child_spi_ip": {
                    "$compatible": "no-os/no_os_spi_init_param.yaml",
                    "$descriptor": "child_spi",
                    "device_id": 2,
                    "chip_select": 1,
                    "platform_ops": "spi_ops",
                    "extra": "max_spi_ip",
                    "parent": "parent_spi"
                }
            }
        };

        const import_result = import_minimal(minimal);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });

        expectOk(result);

        const common_data_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.c"),
            "utf8"
        );

        // The parent field should reference the descriptor via desc struct
        expect(common_data_c).toContain(".parent = &desc.parent_spi");
    });
});
