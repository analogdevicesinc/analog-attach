/*
 * Generate one adxl355 project without going through the CLI, for poking at codegen
 * output by hand:
 *
 *   node_modules/.bin/esbuild scripts/generate_test_project.ts \
 *       --bundle --platform=node --format=cjs > /tmp/gtp.cjs && node /tmp/gtp.cjs [output_dir]
 *
 * Defaults to a temporary directory. Pass `<no-OS>/projects` to produce an in-tree
 * project instead - the generated CMakeLists.txt builds either way.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { import_minimal } from "../src/workfile_handler/workfile_handler";
import { set_settings } from "../src/settings/settings";
import { SETTINGS_DEFAULTS } from "../src/settings/globals";
import { generate_project } from "../src/codegen/codegen";
import { resolve_board } from "../src/workfile_handler/board_scanner";
import { MinimalWorkfile } from "../src/workfile_handler/types";

const NOOS_ROOT = path.join(__dirname, "../test/bindings");

// The real checkout, via the symlink the fixture tree already uses. CMake needs a real
// absolute path here: it lands in `set(NO_OS_PATH ...)` in the generated CMakeLists.
const REAL_NOOS_ROOT = path.dirname(fs.realpathSync(path.join(NOOS_ROOT, "schemas")));

const output_path = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "aa-project-"));

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

// Read from the real checkout, not the fixture tree: only the former has CMakePresets.
const board = resolve_board(REAL_NOOS_ROOT, workfile_data.platform, "ad-apard32690-sl");

if (!board.ok) {
    console.error("Failed to resolve board:", board.error);
    process.exit(1);
}

const result = generate_project({
    workfile,
    platform_name: "max32690",
    platform_vendor: "maxim",
    board: board.value,
    project_name: "adxl355_test",
    output_path: output_path,
    noos_path: REAL_NOOS_ROOT,
});

if (!result.ok) {
    console.error("Failed to generate project:", result.error);
    process.exit(1);
}

console.log(`Project generated in ${output_path}`);
console.log("Files created:");
for (const file of result.value.files_created) {
    console.log("  ", file);
}
