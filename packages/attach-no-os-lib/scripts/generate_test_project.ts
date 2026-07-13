import path from "node:path";
import { import_minimal } from "../src/workfile_handler/workfile_handler";
import { set_settings } from "../src/settings/settings";
import { SETTINGS_DEFAULTS } from "../src/settings/globals";
import { generate_project } from "../src/codegen/codegen";
import { MinimalWorkfile } from "../src/workfile_handler/types";

const NOOS_ROOT = path.join(__dirname, "../test/bindings");
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
            "max_speed_hz": 1000000,
            "chip_select": 0,
            "platform_ops": "spi_ops",
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

set_settings({
    ...SETTINGS_DEFAULTS,
    no_os_path: { ...SETTINGS_DEFAULTS.no_os_path, value: NOOS_ROOT }
});

const import_result = import_minimal(workfile_data);

if (!import_result.ok) {
    console.error("Failed to import workfile:", import_result.error);
    process.exit(1);
}

const workfile = import_result.value;

const result = generate_project({
    workfile,
    platform_name: "max32690",
    platform_vendor: "maxim",
    project_name: "adxl355_test",
    output_path: NOOS_PROJECTS,
    noos_path: "$(NO-OS)",
});

if (!result.ok) {
    console.error("Failed to generate project:", result.error);
    process.exit(1);
}

console.log("Project generated successfully!");
console.log("Files created:");
for (const file of result.value.files_created) {
    console.log("  ", file);
}
