import { describe, test, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { import_minimal } from '../../src/workfile_handler/workfile_handler';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk, setup_test_config, teardown_test_config } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const NOOS_ROOT = path.join(__dirname, '../bindings');
const SCHEMAS_ROOT = path.join(NOOS_ROOT, 'schemas');
const NOOS_PROJECTS = "/home/andrei-fabian/adi/no-OS/projects";

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
            "$compatible": "devices/adxl355/adxl355.yaml",
            "comm_type": "ADXL355_SPI_COMM",
            "dev_type": "ID_ADXL355",
            "comm_init": { "spi_init": "no_os_spi_ip" }
        }
    }
};

describe('generate real project', () => {
    beforeEach(() => {
        setup_test_config(NOOS_ROOT);
    });

    afterEach(() => {
        teardown_test_config();
    });

    test('generate adxl355 project to no-OS/projects', () => {
        const import_result = import_minimal(workfile_data);
        expectOk(import_result);

        const workfile = import_result.value;

        const result = generate_project({
            workfile,
            platform_name: "max32690",
            platform_vendor: "maxim",
            project_name: "adxl355_test",
            output_path: NOOS_PROJECTS,
            noos_path: "../..",  // Relative path to no-OS root
        });

        expectOk(result);

        console.log("Project generated successfully!");
        console.log("Files created:");
        for (const file of result.value.files_created) {
            console.log("  ", file);
        }
    });
});
