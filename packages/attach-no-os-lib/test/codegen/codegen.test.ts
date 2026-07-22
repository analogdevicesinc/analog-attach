import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, expectError, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');

const test_workfile: MinimalWorkfile = {
    platform: "max32690",
    symbols: {
        "max_spi_ip": {
            "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
            "vssel": "MXC_GPIO_VSSEL_VDDIOH",
            "polarity": "SPI_SS_POL_LOW"
        },
        "no_os_spi_ip": {
            "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
            "device_id": 1,
            "max_speed_hz": 1_000_000,
            "chip_select": 2,
            "platform_ops": "spi_ops",
            "extra": "max_spi_ip"
        },
        "misp_ip": {
            "$compatible": "devices/adxl355/adxl355_init_param.yaml",
            "comm_type": "ADXL355_SPI_COMM",
            "dev_type": "ID_ADXL355",
            "comm_init": { "spi_init": "no_os_spi_ip" }
        },
        "misp": {
            "$compatible": "devices/adxl355/adxl355.yaml",
            "init_param": "misp_ip"
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
                    "$compatible": "devices/ad5592r/ad5592r_init_param.yaml",
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
                    "$compatible": "devices/ad5592r/ad5592r_init_param.yaml",
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

    test('descriptor-typed include generates devices.descriptor reference', () => {
        // A child SPI whose `parent` field points at another SPI's *descriptor* node
        // must be patched at runtime with `desc.<parent_descriptor>`.
        const minimal: MinimalWorkfile = {
            platform: "max32690",
            symbols: {
                "max_spi_ip": {
                    "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
                    "vssel": "MXC_GPIO_VSSEL_VDDIOH",
                    "polarity": "SPI_SS_POL_LOW"
                },
                "parent_spi_ip": {
                    "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
                    "device_id": 1,
                    "chip_select": 0,
                    "platform_ops": "spi_ops",
                    "extra": "max_spi_ip"
                },
                "parent_spi": {
                    "$compatible": "no-os/spi/no_os_spi.yaml",
                    "init_param": "parent_spi_ip"
                },
                "child_spi_ip": {
                    "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
                    "device_id": 2,
                    "chip_select": 1,
                    "platform_ops": "spi_ops",
                    "extra": "max_spi_ip",
                    "parent": "parent_spi"
                },
                "child_spi": {
                    "$compatible": "no-os/spi/no_os_spi.yaml",
                    "init_param": "child_spi_ip"
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

        const main_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/main.c"),
            "utf8"
        );

        // The parent field should reference the descriptor via desc struct
        expect(main_c).toContain("child_spi_ip.parent = desc.parent_spi");
    });

    test('errors when a device has an init template but no remove template', () => {
        // A schema with init.mustache but no remove.mustache is a half-configured
        // device. It must surface an error, not be silently dropped from main.c.
        const broken_schemas = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-schemas-'));
        try {
            // NOOS_ROOT/schemas is a symlink to the real schema tree; dereference so we
            // copy real files into the temp dir and never mutate the source via the link.
            fs.cpSync(path.join(NOOS_ROOT, 'schemas'), path.join(broken_schemas, 'schemas'), { recursive: true, dereference: true });
            fs.rmSync(path.join(broken_schemas, 'schemas/devices/adxl355/remove.mustache'));

            teardown_test_config();
            setup_test_config(broken_schemas);

            const import_result = import_minimal(test_workfile);
            expectOk(import_result);

            const result = generate_project({
                workfile: import_result.value,
                platform_name: "max32690",
                platform_vendor: "maxim",
                project_name: "test-project",
                output_path: temporary_directory,
                noos_path: "$(realpath ../../../)",
            });

            expectError(result);
            expect(result.error.message).toContain("adxl355");
        } finally {
            fs.rmSync(broken_schemas, { recursive: true, force: true });
        }
    });

    test('initializes UART before other devices regardless of workfile order', () => {
        // UART is declared LAST here, but must init FIRST so logging works during the
        // rest of init. Non-prioritized devices keep their relative order.
        const minimal: MinimalWorkfile = {
            platform: "max32690",
            symbols: {
                "max_spi_ip": {
                    "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
                    "vssel": "MXC_GPIO_VSSEL_VDDIOH",
                    "polarity": "SPI_SS_POL_LOW"
                },
                "no_os_spi_ip": {
                    "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
                    "device_id": 1,
                    "max_speed_hz": 1_000_000,
                    "chip_select": 2,
                    "platform_ops": "spi_ops",
                    "extra": "max_spi_ip"
                },
                "misp_ip": {
                    "$compatible": "devices/adxl355/adxl355_init_param.yaml",
                    "comm_type": "ADXL355_SPI_COMM",
                    "dev_type": "ID_ADXL355",
                    "comm_init": { "spi_init": "no_os_spi_ip" }
                },
                "misp": {
                    "$compatible": "devices/adxl355/adxl355.yaml",
                    "init_param": "misp_ip"
                },
                "max_uart_ip": {
                    "$compatible": "platforms/maxim/max32690/max_uart_init_param.yaml",
                    "vssel": "MXC_GPIO_VSSEL_VDDIOH"
                },
                "my_uart_ip": {
                    "$compatible": "no-os/uart/no_os_uart_init_param.yaml",
                    "device_id": 0,
                    "baud_rate": 115200,
                    "platform_ops": "uart_ops",
                    "extra": "max_uart_ip"
                },
                "my_uart": {
                    "$compatible": "no-os/uart/no_os_uart.yaml",
                    "init_param": "my_uart_ip"
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

        const main_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/main.c"),
            "utf8"
        );

        const uart_init = main_c.indexOf("no_os_uart_init");
        const adxl_init = main_c.indexOf("adxl355_init");
        expect(uart_init).toBeGreaterThanOrEqual(0);
        expect(adxl_init).toBeGreaterThanOrEqual(0);
        expect(uart_init).toBeLessThan(adxl_init);

        // Teardown is reverse init order: UART inits first, so it is removed last.
        const uart_remove = main_c.indexOf("no_os_uart_remove");
        const adxl_remove = main_c.indexOf("adxl355_remove");
        expect(uart_remove).toBeGreaterThanOrEqual(0);
        expect(adxl_remove).toBeGreaterThanOrEqual(0);
        expect(adxl_remove).toBeLessThan(uart_remove);
    });
});
