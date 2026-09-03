import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, expectError, setup_test_config, teardown_test_config, TEST_BOARD } from '../test_utilities';
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

/* Every generated file, recursively, as [relative path, contents]. */
function generated_files(root: string): [string, string][] {
    const found: [string, string][] = [];

    const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else {
                found.push([path.relative(root, full), fs.readFileSync(full, 'utf8')]);
            }
        }
    };

    walk(root);
    return found;
}

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
            board: TEST_BOARD,
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

        // Print the build files for visual inspection
        const cmakelists = fs.readFileSync(
            path.join(temporary_directory, "test-project/CMakeLists.txt"),
            "utf8"
        );
        console.log("\n=== CMakeLists.txt ===");
        console.log(cmakelists);

        const project_conf = fs.readFileSync(
            path.join(temporary_directory, "test-project/project.conf"),
            "utf8"
        );
        console.log("\n=== project.conf ===");
        console.log(project_conf);

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
            board: TEST_BOARD,
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
            board: TEST_BOARD,
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

    test('unset pointer include is emitted as NULL', () => {
        // `parent` on no_os_spi_init_param is a `pointer: true` include. When left
        // unset it must be explicitly null-initialized, not omitted from the struct.
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
                    "chip_select": 2,
                    "platform_ops": "spi_ops",
                    "extra": "max_spi_ip"
                }
            }
        };

        const import_result = import_minimal(minimal);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            board: TEST_BOARD,
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });

        expectOk(result);

        const common_data_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.c"),
            "utf8"
        );

        expect(common_data_c).toContain(".parent = NULL");
    });

    test('unset property with a default emits the default value', () => {
        // `asynchronous_rx` on no_os_uart_init_param has `default: false`. Even
        // though it is never set in the workfile, codegen emits the default.
        const minimal: MinimalWorkfile = {
            platform: "max32690",
            symbols: {
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
                }
            }
        };

        const import_result = import_minimal(minimal);
        expectOk(import_result);

        const result = generate_project({
            workfile: import_result.value,
            platform_name: "max32690",
            platform_vendor: "maxim",
            board: TEST_BOARD,
            project_name: "test-project",
            output_path: temporary_directory,
            noos_path: "$(realpath ../../../)",
        });

        expectOk(result);

        const common_data_c = fs.readFileSync(
            path.join(temporary_directory, "test-project/src/common/common_data.c"),
            "utf8"
        );

        expect(common_data_c).toContain(".asynchronous_rx = false");
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
            board: TEST_BOARD,
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
        // A schema with init.eta but no remove.eta is a half-configured
        // device. It must surface an error, not be silently dropped from main.c.
        const broken_schemas = fs.mkdtempSync(path.join(os.tmpdir(), 'broken-schemas-'));
        try {
            // NOOS_ROOT/schemas is a symlink to the real schema tree; dereference so we
            // copy real files into the temp dir and never mutate the source via the link.
            fs.cpSync(path.join(NOOS_ROOT, 'schemas'), path.join(broken_schemas, 'schemas'), { recursive: true, dereference: true });
            fs.rmSync(path.join(broken_schemas, 'schemas/devices/adxl355/remove.eta'));

            teardown_test_config();
            setup_test_config(broken_schemas);

            const import_result = import_minimal(test_workfile);
            expectOk(import_result);

            const result = generate_project({
                workfile: import_result.value,
                platform_name: "max32690",
                platform_vendor: "maxim",
                board: TEST_BOARD,
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
            board: TEST_BOARD,
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

        // UART's full-block init template registers the stdio backend after a
        // successful init; the call must appear after no_os_uart_init.
        const uart_stdio = main_c.indexOf("no_os_uart_stdio(desc.");
        expect(uart_stdio).toBeGreaterThan(uart_init);

        // Teardown is reverse init order: UART inits first, so it is removed last.
        const uart_remove = main_c.indexOf("no_os_uart_remove");
        const adxl_remove = main_c.indexOf("adxl355_remove");
        expect(uart_remove).toBeGreaterThanOrEqual(0);
        expect(adxl_remove).toBeGreaterThanOrEqual(0);
        expect(adxl_remove).toBeLessThan(uart_remove);
    });

    describe('CMake build files', () => {
        function generate() {
            const import_result = import_minimal(test_workfile);
            expectOk(import_result);

            const result = generate_project({
                workfile: import_result.value,
                platform_name: "max32690",
                platform_vendor: "maxim",
                board: TEST_BOARD,
                project_name: "test-project",
                output_path: temporary_directory,
                noos_path: "/opt/no-OS",
            });
            expectOk(result);

            return path.join(temporary_directory, "test-project");
        }

        test('CMakeLists.txt names the project and links no-os', () => {
            const cmakelists = fs.readFileSync(path.join(generate(), "CMakeLists.txt"), "utf8");

            expect(cmakelists).toContain("add_executable(test-project)");
            expect(cmakelists).toContain("target_link_libraries(test-project no-os)");

            // The in-tree/out-of-tree guard, and the toolchain set inside it: without
            // both, one of the two build contexts breaks.
            expect(cmakelists).toContain("if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)");
            expect(cmakelists).toContain('set(NO_OS_PATH "/opt/no-OS"');
            expect(cmakelists).toContain("set(CMAKE_TOOLCHAIN_FILE");

            // Sources come from the manifest, so every generated .c must appear once.
            expect(cmakelists).toContain("${CMAKE_CURRENT_SOURCE_DIR}/src/main.c");
            expect(cmakelists).toContain("${CMAKE_CURRENT_SOURCE_DIR}/src/common/common_data.c");
            expect(cmakelists).toContain("${CMAKE_CURRENT_SOURCE_DIR}/src/user_app.c");

            // And no header directory twice, which CMake tolerates but which means the
            // dedupe in the template has stopped working.
            const src_includes = cmakelists.match(/\$\{CMAKE_CURRENT_SOURCE_DIR}\/src$/gm) ?? [];
            expect(src_includes).toHaveLength(1);
        });

        test('project.conf lists the Kconfig symbols the workfile owns', () => {
            const project_conf = fs.readFileSync(path.join(generate(), "project.conf"), "utf8");
            const symbols = project_conf
                .split("\n")
                .filter(line => line.startsWith("CONFIG_"));

            // The adxl355 driver and its menu parent: without the parent, Kconfig caps
            // the leaf at n and the driver silently vanishes from the build.
            expect(symbols).toContain("CONFIG_ACCEL=y");
            expect(symbols).toContain("CONFIG_ACCEL_ADXL355=y");
            expect(symbols).toContain("CONFIG_SPI=y");

            // Sorted and deduped, so regenerating the same workfile is a no-op diff.
            expect(symbols).toStrictEqual([...new Set(symbols)].sort());
        });

        test('CMakePresets.json includes the no-OS presets', () => {
            const presets = JSON.parse(fs.readFileSync(path.join(generate(), "CMakePresets.json"), "utf8"));

            expect(presets.include).toStrictEqual(["/opt/no-OS/CMakePresets.json"]);
        });

        test('no generated file contains the literal "undefined"', () => {
            // Eta renders a missing context key as the string "undefined" rather than
            // failing, so a renamed key would otherwise silently corrupt output. This
            // is the cheap global guard against that.
            for (const [relative, contents] of generated_files(generate())) {
                expect(contents, `${relative} contains "undefined"`).not.toContain("undefined");
            }
        });
    });
});
