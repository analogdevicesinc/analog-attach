import { describe, test, beforeEach } from 'vitest';
import path from 'node:path';
import { WorkfileHandler } from '../../src/workfile_handler/workfile_handler';
import { set_schemas_path, reset_settings } from '../../src/settings/settings';
import { generate_project } from '../../src/codegen/codegen';
import { expectOk } from '../test_utilities';
import { MinimalWorkfile } from '../../src/workfile_handler/types';

const SCHEMAS_ROOT = path.join(__dirname, '../bindings/schemas');
const NOOS_PROJECTS = "/home/andrei-fabian/adi/no-OS/projects";

const workfile: MinimalWorkfile = {
    platform: "max32690",
    symbols: {
        "max_spi_ip": {
            "$compatible": "platforms/maxim/max32690/max_spi_init_param.yaml",
            "vssel": "MXC_GPIO_VSSEL_VDDIOH",
            "polarity": "SPI_SS_POL_LOW"
        },
        "no_os_spi_ip": {
            "$compatible": "no-os/no_os_spi_init_param.yaml",
            "device_id": 4,
            "max_speed_hz": 1_000_000,
            "chip_select": 0,
            "platform_ops": "max_spi_ops",
            "extra": "max_spi_ip"
        },
        "adxl355_device": {
            "$compatible": "devices/adi,adxl355.yaml",
            "comm_type": "ADXL355_SPI_COMM",
            "dev_type": "ID_ADXL355",
            "comm_init": { "spi_init": "no_os_spi_ip" }
        }
    }
};

describe('generate real project', () => {
    let handler: WorkfileHandler;

    beforeEach(() => {
        set_schemas_path(SCHEMAS_ROOT);
        handler = new WorkfileHandler();
    });

    test('generate adxl355 project to no-OS/projects', () => {
        const import_result = handler.import_minimal(workfile);
        expectOk(import_result);

        const expanded_workfile = handler.export_workfile();

        const result = generate_project({
            workfile: expanded_workfile,
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

        reset_settings();
    });
});
