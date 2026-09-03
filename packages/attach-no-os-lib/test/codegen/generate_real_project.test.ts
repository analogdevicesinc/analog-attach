import { describe, test, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, setup_test_config, teardown_test_config, TEST_BOARD } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');

/*
 * The real no-OS checkout, resolved through the `test/bindings/schemas` symlink every
 * test already depends on. The generated CMakeLists.txt bakes this into
 * `set(NO_OS_PATH ...)`, so it has to be a real absolute path - a relative one, or the
 * `$(NO-OS)` make expression this test used to pass, produces a project CMake cannot
 * configure. Deriving it beats hardcoding one developer's home directory.
 */
const REAL_NOOS_ROOT = path.dirname(fs.realpathSync(path.join(NOOS_ROOT, 'schemas')));

const workfile_data: MinimalWorkfile = {
    platform: "max32690",
    symbols: {
        "max_spi_ip": {
            "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
            "vssel": "MXC_GPIO_VSSEL_VDDIOH",
            "polarity": "SPI_SS_POL_LOW"
        },
        "no_os_spi_ip": {
            "$compatible": "no-os/spi/no_os_spi_init_param.yaml",
            "device_id": 4,
            "max_speed_hz": 1_000_000,
            "chip_select": 0,
            "platform_ops": "max_spi_ops",
            "extra": "max_spi_ip"
        },
        "adxl355_ip": {
            "$compatible": "devices/adxl355/adxl355_init_param.yaml",
            "comm_type": "ADXL355_SPI_COMM",
            "dev_type": "ID_ADXL355",
            "comm_init": { "spi_init": "no_os_spi_ip" }
        },
        "adxl355_device": {
            "$compatible": "devices/adxl355/adxl355.yaml",
            "init_param": "adxl355_ip"
        }
    }
};

describe('generate real project', () => {
    let temporary_directory: string;

    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
        temporary_directory = fs.mkdtempSync(path.join(os.tmpdir(), 'real-project-test-'));
    });

    afterEach(() => {
        teardown_test_config();
        fs.rmSync(temporary_directory, { recursive: true, force: true });
    });

    // Generates against the real schemas rather than fixtures, so it catches a schema
    // change that breaks codegen. Output goes to a temporary directory: the in-tree
    // case belongs to the e2e scripts, and a unit test must not write into a checkout.
    test('generate adxl355 project against the real schemas', () => {
        const import_result = import_minimal(workfile_data);
        expectOk(import_result);

        const workfile = import_result.value;

        const result = generate_project({
            workfile,
            platform_name: "max32690",
            platform_vendor: "maxim",
            board: TEST_BOARD,
            project_name: "adxl355_test",
            output_path: temporary_directory,
            noos_path: REAL_NOOS_ROOT,
        });

        expectOk(result);

        console.log("Project generated successfully!");
        console.log("Files created:");
        for (const file of result.value.files_created) {
            console.log("  ", file);
        }
    });
});
